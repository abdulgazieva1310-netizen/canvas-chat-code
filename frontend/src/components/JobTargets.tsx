import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Api } from "@/lib/api/client";
import { targetRoles, type JobTarget, type Role } from "@/lib/api/types";

type Draft = Pick<JobTarget, "title" | "company" | "role" | "description">;
const blank: Draft = { title: "", company: null, role: "Frontend Developer", description: "" };

export function JobTargets({ onApply }: { onApply: (target: JobTarget) => void }) {
  const queryClient = useQueryClient();
  const sessionReady = queryClient.getQueryData(["history"]) !== undefined;
  const query = useQuery({ queryKey: ["job-targets"], queryFn: Api.listJobTargets, retry: false,
    enabled: sessionReady });
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => editing ? Api.updateJobTarget(editing, draft) : Api.createJobTarget(draft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["job-targets"] });
      setDraft(blank); setEditing(null); setFormOpen(false); setActionError(null);
    },
    onError: (error) => setActionError(error.message || "The target could not be saved. Your edits are still here."),
  });
  const remove = useMutation({
    mutationFn: Api.deleteJobTarget,
    onSuccess: () => { setActionError(null); void queryClient.invalidateQueries({ queryKey: ["job-targets"] }); },
    onError: () => setActionError("The target could not be deleted. Please retry."),
  });
  const edit = (target: JobTarget) => {
    setDraft({ title: target.title, company: target.company, role: target.role, description: target.description });
    setEditing(target.id); setFormOpen(true); setActionError(null);
  };
  const beginCreate = () => { setDraft(blank); setEditing(null); setFormOpen(true); setActionError(null); };
  return <section className="card-surface mt-4 space-y-3 p-5" aria-label="Saved job targets">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl">Saved job targets</h2><p className="text-sm text-muted-foreground">Private to your account. Up to 20 targets.</p></div>
      <button type="button" className="btn btn-ghost" onClick={beginCreate}>Add job target</button>
    </div>
    {sessionReady && query.isPending && <p role="status">Loading saved targets…</p>}
    {query.isError && <div role="alert"><p>Saved targets could not be loaded.</p><button type="button" className="btn btn-ghost" onClick={() => void query.refetch()}>Retry loading targets</button></div>}
    {query.data?.items?.length === 0 && <p className="text-sm">No saved targets yet. Add one to reuse a job description.</p>}
    {query.data?.items?.map((target) => <article key={target.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div><p className="font-semibold">{target.title}{target.company ? ` · ${target.company}` : ""}</p><p className="text-sm text-muted-foreground">{target.role} · {target.description.length} characters</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => onApply(target)}>Apply to Setup</button>
        <button type="button" className="btn btn-ghost" onClick={() => edit(target)}>Edit</button>
        <button type="button" className="btn btn-ghost" disabled={remove.isPending} onClick={() => remove.mutate(target.id)}>Delete</button>
      </div>
    </article>)}
    {formOpen && <form className="space-y-3 rounded-lg border p-4" onSubmit={(event) => { event.preventDefault(); setActionError(null); save.mutate(); }}>
      <h3 className="font-semibold">{editing ? "Edit job target" : "New job target"}</h3>
      <label className="block">Title
        <input className="field mt-1 w-full" required minLength={1} maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      </label>
      <label className="block">Company (optional)
        <input className="field mt-1 w-full" maxLength={120} value={draft.company ?? ""} onChange={(event) => setDraft({ ...draft, company: event.target.value || null })} />
      </label>
      <label className="block">Role
        <select aria-label="Target role" className="field mt-1 w-full" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}>{targetRoles.map((role) => <option key={role}>{role}</option>)}</select>
      </label>
      <label className="block">Job description (optional, up to 8000 characters)
        <textarea className="field mt-1 w-full" maxLength={8000} rows={5} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </label>
      {actionError && <p role="alert">{actionError}</p>}
      <div className="flex gap-2"><button className="btn btn-primary" type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : save.isError ? "Retry save" : "Save target"}</button><button className="btn btn-ghost" type="button" onClick={() => { setFormOpen(false); setActionError(null); }}>Cancel</button></div>
    </form>}
    {actionError && !formOpen && <p role="alert">{actionError}</p>}
  </section>;
}
