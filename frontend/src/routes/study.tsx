import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Api } from "@/lib/api/client";
import type { Interview, StudyPlan, StudyPlanItem, StudyQuestion } from "@/lib/api/types";

export const Route = createFileRoute("/study")({ component: Study });

function groupKey(interview: Interview) {
  const { role, type, mode, level, language } = interview.setup;
  return JSON.stringify([role, type, mode, level, language]);
}

function groupLabel(interview: Interview) {
  const { role, type, mode, level, language } = interview.setup;
  return `${role} · ${type} · ${mode} · ${level} · ${language}`;
}

function Study() {
  const [page, setPage] = useState(1);
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["study", page], queryFn: () => Api.getStudyQuestions(page), retry: false });
  const history = useQuery({ queryKey: ["study-plan-history"], queryFn: Api.getHistory, retry: false });
  const plans = useQuery({ queryKey: ["study-plans"], queryFn: Api.getStudyPlans, retry: false });
  const completedReports = history.data?.filter((interview) => interview.status === "complete") ?? [];
  const grouped = new Map<string, Interview[]>();
  for (const interview of completedReports) {
    const key = groupKey(interview);
    grouped.set(key, [...(grouped.get(key) ?? []), interview]);
  }
  const groups = [...grouped.entries()].sort((a, b) => groupLabel(a[1][0]!).localeCompare(groupLabel(b[1][0]!)));
  const activeGroupKey = selectedGroupKey || groups[0]?.[0] || "";
  const activeGroup = grouped.get(activeGroupKey) ?? [];
  const create = useMutation({
    mutationFn: () => Api.createStudyPlan(selectedIds),
    onSuccess: async () => {
      setSelectedIds([]);
      await client.invalidateQueries({ queryKey: ["study-plans"] });
    },
  });

  return (
    <AppShell>
      <h1 className="text-4xl">Study</h1>
      <section className="card-surface mt-6 p-5" aria-labelledby="plan-heading">
        <h2 id="plan-heading" className="text-2xl font-semibold">AI study plans</h2>
        <p className="mt-2 max-w-3xl">
          Build coaching guidance from your scored interview reports. Plans cite their source feedback
          and are suggestions, not objective assessments.
        </p>
        {history.isPending && <p role="status" className="mt-3">Loading completed reports…</p>}
        {history.error && <div className="mt-3"><p role="alert">Could not load completed reports.</p><button className="btn btn-ghost mt-2" onClick={() => void history.refetch()}>Retry</button></div>}
        {history.data && completedReports.length === 0 && (
          <p className="mt-3">No completed reports yet. Complete and score at least two compatible interviews to build a plan.</p>
        )}
        {groups.length > 0 && (
          <div className="mt-4 space-y-4">
            <label className="block font-medium">Comparison group
              <select className="mt-2 block w-full max-w-xl rounded border bg-background p-2" value={activeGroupKey}
                onChange={(event) => { setSelectedGroupKey(event.target.value); setSelectedIds([]); }}>
                {groups.map(([key, items]) => <option key={key} value={key}>{groupLabel(items[0]!)}</option>)}
              </select>
            </label>
            <fieldset>
              <legend className="font-medium">Select 2–5 completed reports from this group</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {activeGroup.map((interview) => (
                  <label key={interview.id} className="flex items-start gap-2 rounded border p-3">
                    <input type="checkbox" className="mt-1" checked={selectedIds.includes(interview.id)}
                      disabled={!selectedIds.includes(interview.id) && selectedIds.length >= 5}
                      onChange={(event) => setSelectedIds((current) => event.target.checked
                        ? [...current, interview.id] : current.filter((id) => id !== interview.id))} />
                    <span>{new Date(interview.startedAt).toLocaleDateString()} · {interview.answeredCount} answers · {interview.id.slice(0, 8)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="btn btn-primary" disabled={selectedIds.length < 2 || create.isPending}
              onClick={() => create.mutate()}>
              {create.isPending ? "Generating plan…" : "Generate study plan"}
            </button>
            {selectedIds.length < 2 && <p className="mt-2 text-sm">Choose at least two reports. Each must contain scored, actionable feedback.</p>}
            {create.error && <p role="alert" className="mt-3">{create.error.message || "The plan could not be generated. No recommendations were saved."}</p>}
          </div>
        )}
        {plans.isPending && <p role="status" className="mt-4">Loading saved plans…</p>}
        {plans.error && <div className="mt-3"><p role="alert">Could not load saved study plans.</p><button className="btn btn-ghost mt-2" onClick={() => void plans.refetch()}>Retry</button></div>}
        {plans.data && plans.data.items.length === 0 && <p className="mt-4">Your generated plans will appear here.</p>}
        {plans.data && <div className="mt-5 space-y-4">{plans.data.items.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div>}
      </section>

      <section className="mt-10" aria-labelledby="saved-questions-heading">
        <h2 id="saved-questions-heading" className="text-2xl font-semibold">Saved questions</h2>
        {query.isPending && <p role="status">Loading saved questions…</p>}
        {query.error && <div><p role="alert">Could not load saved questions.</p><button className="btn btn-ghost" onClick={() => void query.refetch()}>Retry</button></div>}
        {query.data && <>
          {query.data.items.length === 0 && <p className="mt-3">No saved questions on this page.</p>}
          <ul className="mt-6 space-y-4">{query.data.items.map((item) => <Note key={item.id} item={item} />)}</ul>
          <div className="mt-4 flex gap-4"><button className="btn btn-ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous page</button>
            <p>Page {page} · {query.data.total} saved questions</p>
            <button className="btn btn-ghost" disabled={page * 20 >= query.data.total} onClick={() => setPage((p) => p + 1)}>Next page</button></div>
        </>}
      </section>
    </AppShell>
  );
}

function PlanCard({ plan }: { plan: StudyPlan }) {
  const client = useQueryClient();
  const regenerate = useMutation({ mutationFn: () => Api.regenerateStudyPlan(plan.id), onSuccess: () => client.invalidateQueries({ queryKey: ["study-plans"] }) });
  const remove = useMutation({ mutationFn: () => Api.deleteStudyPlan(plan.id), onSuccess: () => client.invalidateQueries({ queryKey: ["study-plans"] }) });
  const { comparisonGroup: group } = plan;
  return (
    <article className="rounded-lg border p-4" aria-label={`Study plan for ${group.role}`}>
      <h3 className="text-xl font-semibold">{group.role} · {group.type} · {group.mode} · {group.level} · {group.language}</h3>
      <p className="mt-1 text-sm">Coaching guidance based on {plan.sources.length} selected reports.</p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {plan.sources.map((source) => <li key={source.interviewId}>
          <Link to="/report" search={{ interviewId: source.interviewId }}>Source report · {new Date(source.startedAt).toLocaleDateString()} · score {source.overall}</Link>
        </li>)}
      </ul>
      <ol className="mt-4 space-y-3">
        {plan.items.map((item, index) => <PlanItemCard key={item.id} plan={plan} item={item} order={index + 1} />)}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-ghost" disabled={regenerate.isPending || remove.isPending} onClick={() => regenerate.mutate()}>
          {regenerate.isPending ? "Regenerating…" : "Regenerate plan"}
        </button>
        <button className="btn btn-ghost" disabled={remove.isPending || regenerate.isPending} onClick={() => remove.mutate()}>
          {remove.isPending ? "Deleting…" : "Delete plan"}
        </button>
      </div>
      {(regenerate.error || remove.error) && <p role="alert" className="mt-2">Could not update this plan. Your source reports are unchanged.</p>}
    </article>
  );
}

function PlanItemCard({ plan, item, order }: { plan: StudyPlan; item: StudyPlanItem; order: number }) {
  const client = useQueryClient();
  const update = useMutation({
    mutationFn: (completed: boolean) => Api.updateStudyPlanItem(plan.id, item.id, completed),
    onSuccess: () => client.invalidateQueries({ queryKey: ["study-plans"] }),
  });
  const group = plan.comparisonGroup;
  return (
    <li className="rounded border p-3">
      <label className="flex items-start gap-2 font-semibold">
        <input type="checkbox" className="mt-1" checked={item.completed} disabled={update.isPending}
          onChange={(event) => update.mutate(event.target.checked)} />
        <span>{order}. {item.topic}</span>
      </label>
      <p className="mt-2"><strong>Why this is suggested:</strong> {item.rationale}</p>
      <p className="mt-1"><strong>Practice action:</strong> {item.action}</p>
      <p className="mt-2 text-sm">Evidence: {item.sources.map((source, index) => <span key={`${source.interviewId}-${source.answerId}`}>
        {index > 0 ? ", " : ""}<Link to="/report" search={{ interviewId: source.interviewId }}>review answer in source report</Link>
      </span>)}</p>
      {update.error && <p role="alert">Could not save completion. Try again.</p>}
      <Link className="mt-3 inline-block" to="/setup" search={{ practiceTopic: item.topic, role: group.role,
        interviewType: group.type, level: group.level, language: group.language }}>Start targeted practice</Link>
    </li>
  );
}

function Note({ item }: { item: StudyQuestion }) {
  const [note, setNote] = useState(item.note);
  const client = useQueryClient();
  const save = useMutation({ mutationFn: () => Api.updateStudyQuestion(item.id, note), onSuccess: () => client.invalidateQueries({ queryKey: ["study"] }) });
  const remove = useMutation({ mutationFn: () => Api.deleteStudyQuestion(item.id), onSuccess: () => client.invalidateQueries({ queryKey: ["study"] }) });
  return <li className="card-surface p-5">
    <p className="whitespace-pre-wrap">{item.prompt}</p>
    <Link to="/report" search={{ interviewId: item.interviewId }}>Review source report</Link>
    <form className="mt-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <label className="block">Private note<textarea className="mt-2 w-full rounded border bg-background p-3" maxLength={4000} value={note}
        onChange={(event) => { save.reset(); setNote(event.target.value); }} /></label>
      <button className="btn btn-primary" disabled={save.isPending || remove.isPending}>{save.isPending ? "Saving…" : "Save note"}</button>
      <button className="btn btn-ghost" type="button" disabled={remove.isPending || save.isPending} onClick={() => remove.mutate()}>Remove saved question</button>
      {save.isSuccess && <p role="status">Note saved.</p>}
      {(save.error || remove.error) && <p role="alert">Could not update saved question. Your edits are retained; try again.</p>}
    </form>
  </li>;
}
