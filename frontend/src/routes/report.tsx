import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MockApi } from "@/lib/api/mock-api";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/report")({
  validateSearch: (search: Record<string, unknown>) => ({
    interviewId: typeof search["interviewId"] === "string" ? search["interviewId"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Interview report — Interview Mirror" },
      {
        name: "description",
        content: "Scores, written feedback, stronger example answers and full transcript.",
      },
      { property: "og:title", content: "Interview report — Interview Mirror" },
      { property: "og:description", content: "Your interview feedback report." },
    ],
  }),
  component: Report,
});

function Report() {
  const [open, setOpen] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const { interviewId } = Route.useSearch();
  const { data, error, isPending } = useQuery({
    queryKey: ["report", interviewId],
    queryFn: () => MockApi.getReport(interviewId),
    retry: false,
  });
  if (isPending)
    return (
      <AppShell>
        <p role="status">Loading report…</p>
      </AppShell>
    );
  if (error || !data)
    return (
      <AppShell>
        <p role="alert">{error?.message ?? "Report unavailable."}</p>
        <Link to="/setup">New interview</Link>
      </AppShell>
    );
  const { interview, feedback } = data;
  const qs = feedback.questions;
  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">
            {new Date(interview.startedAt).toLocaleDateString()} · {interview.answeredCount} of{" "}
            {interview.setup.questionCount} questions · {interview.status}
          </p>
          <h1 className="mt-2 text-4xl md:text-5xl">
            {interview.setup.role} · {interview.setup.type}
          </h1>
        </div>
        <div className="flex gap-3">
          <Link to="/ready" search={{ retryId: interview.id }} className="btn btn-ghost">
            Retry
          </Link>
          <Link to="/setup" className="btn btn-primary">
            Practice weak areas
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-5">
        <div className="card-surface flex flex-col justify-center p-6 md:col-span-1">
          <p className="eyebrow">Overall</p>
          <p className="font-display text-6xl">{feedback.overall ?? "—"}</p>
          <p className="text-xs text-muted-foreground">AI coaching estimate</p>
        </div>
        {Object.entries(feedback.scores ?? {}).map(([k, v]) => (
          <div key={k} className="card-surface p-6">
            <p className="eyebrow">{k}</p>
            <p className="mt-2 font-display text-3xl">{v}</p>
            <div className="mt-3 h-1.5 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${Number(v) * 10}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="card-surface p-6">
          <h2 className="text-xl">Strengths</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {feedback.strengths.map((text) => (
              <li key={text}>✓ {text}</li>
            ))}
          </ul>
          <h2 className="mt-6 text-xl">Recurring gaps</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {feedback.gaps.map((text) => (
              <li key={text}>△ {text}</li>
            ))}
          </ul>
        </div>
        <div className="card-surface p-6 md:col-span-2">
          <h2 className="text-xl">Question by question</h2>
          <div className="mt-4 divide-y divide-border">
            {qs.map((x, i) => (
              <div key={i} className="py-3">
                <button
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => setOpen(open === i ? -1 : i)}
                >
                  <span className="font-medium">
                    {i + 1}. {x.q}
                  </span>
                  <span className="font-display text-xl">{x.score}</span>
                </button>
                {open === i && (
                  <div className="mt-3 space-y-3 text-sm">
                    <p>
                      <span className="font-semibold text-success">Went well · </span>
                      {x.good}
                    </p>
                    <p>
                      <span className="font-semibold text-destructive">Missing · </span>
                      {x.miss}
                    </p>
                    <div className="rounded-lg bg-secondary p-3">
                      <p className="eyebrow mb-1">Stronger answer</p>
                      {x.better}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {qs.length === 0 && <p>No answers were submitted.</p>}
          <button onClick={() => setTranscriptOpen(!transcriptOpen)} className="btn btn-ghost mt-4">
            {transcriptOpen ? "Hide transcript" : "View full transcript"}
          </button>
          {transcriptOpen && (
            <div className="mt-4 space-y-3">
              {interview.messages.map((message) => (
                <p key={message.id}>
                  <b>{message.from}:</b> {message.text}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
