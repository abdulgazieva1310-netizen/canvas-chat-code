import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/report")({
  head: () => ({
    meta: [
      { title: "Interview report — Interview Mirror" },
      { name: "description", content: "Scores, written feedback, stronger example answers and full transcript." },
      { property: "og:title", content: "Interview report — Interview Mirror" },
      { property: "og:description", content: "Your interview feedback report." },
    ],
  }),
  component: Report,
});

const qs = [
  { q: "Event loop: Promise vs setTimeout(0)", score: 7.5, good: "Correctly identified microtask vs macrotask queues.", miss: "Didn't mention rendering happens between macrotasks.", better: "Promise callbacks run in the microtask queue, which fully drains after each task and before rendering; setTimeout schedules a new task, so it runs after rendering opportunities." },
  { q: "Debouncing a search input in React", score: 6.2, good: "Clear use of setTimeout and cleanup in useEffect.", miss: "No mention of cancelling stale requests (AbortController).", better: "Debounce the value with a hook, then fetch in an effect that aborts the previous request on change to avoid race conditions." },
  { q: "Tell me about a hard bug you fixed", score: 5.4, good: "Concrete example with real impact.", miss: "Result and learning were vague — weak structure.", better: "Use STAR: situation (prod memory leak), task, the profiling actions you took, and a measurable result (−40% heap)." },
];

function Report() {
  const [open, setOpen] = useState(0);
  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Oct 17 · 24 min · 10 of 10 questions</p>
          <h1 className="mt-2 text-4xl md:text-5xl">Frontend · Technical</h1>
        </div>
        <div className="flex gap-3">
          <Link to="/ready" className="btn btn-ghost">Retry</Link>
          <Link to="/setup" className="btn btn-primary">Practice weak areas</Link>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-5">
        <div className="card-surface flex flex-col justify-center p-6 md:col-span-1">
          <p className="eyebrow">Overall</p>
          <p className="font-display text-6xl">6.9</p>
          <p className="text-xs text-muted-foreground">AI coaching estimate</p>
        </div>
        {[["Accuracy", 7.6], ["Completeness", 6.1], ["Clarity", 7.8], ["Structure", 5.9]].map(([k, v]) => (
          <div key={k} className="card-surface p-6">
            <p className="eyebrow">{k}</p>
            <p className="mt-2 font-display text-3xl">{v}</p>
            <div className="mt-3 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Number(v) * 10}%` }} /></div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="card-surface p-6">
          <h2 className="text-xl">Strengths</h2>
          <ul className="mt-3 space-y-2 text-sm"><li>✓ Solid JS runtime fundamentals</li><li>✓ Clear, concise wording</li></ul>
          <h2 className="mt-6 text-xl">Recurring gaps</h2>
          <ul className="mt-3 space-y-2 text-sm"><li>△ Answers lack a closing result</li><li>△ Edge cases rarely covered</li></ul>
        </div>
        <div className="card-surface p-6 md:col-span-2">
          <h2 className="text-xl">Question by question</h2>
          <div className="mt-4 divide-y divide-border">
            {qs.map((x, i) => (
              <div key={i} className="py-3">
                <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(open === i ? -1 : i)}>
                  <span className="font-medium">{i + 1}. {x.q}</span>
                  <span className="font-display text-xl">{x.score}</span>
                </button>
                {open === i && (
                  <div className="mt-3 space-y-3 text-sm">
                    <p><span className="font-semibold text-success">Went well · </span>{x.good}</p>
                    <p><span className="font-semibold text-destructive">Missing · </span>{x.miss}</p>
                    <div className="rounded-lg bg-secondary p-3"><p className="eyebrow mb-1">Stronger answer</p>{x.better}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="btn btn-ghost mt-4">View full transcript</button>
        </div>
      </div>
    </AppShell>
  );
}
