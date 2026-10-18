import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Api } from "@/lib/api/client";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Interview Mirror" },
      {
        name: "description",
        content: "Track your interview practice progress, scores and weak areas.",
      },
      { property: "og:title", content: "Dashboard — Interview Mirror" },
      {
        property: "og:description",
        content: "Track your interview practice progress, scores and weak areas.",
      },
    ],
  }),
  component: Dashboard,
});

const trend = [5.2, 5.8, 6.1, 5.9, 6.7, 7.0, 7.4];
const categories = [
  { name: "Accuracy", score: 7.6 },
  { name: "Completeness", score: 6.4 },
  { name: "Clarity", score: 8.1 },
  { name: "Structure", score: 5.9 },
];
function Dashboard() {
  const {
    data: history = [],
    error: historyError,
    isPending: historyPending,
  } = useQuery({ queryKey: ["history"], queryFn: () => Api.getHistory() });
  const max = 10;
  const pts = trend
    .map((v, i) => `${(i / (trend.length - 1)) * 100},${100 - (v / max) * 100}`)
    .join(" ");
  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Welcome back, Aruzhan</p>
          <h1 className="mt-2 text-4xl md:text-5xl">Your practice, reflected.</h1>
          <p className="mt-2 text-muted-foreground">Target: Middle Frontend Developer · English</p>
        </div>
        <div className="flex gap-3">
          <Link to="/setup" className="btn btn-ghost">
            Custom setup
          </Link>
          <Link to="/ready" className="btn btn-primary">
            Quick Start →
          </Link>
        </div>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-4">
        {[
          ["Interviews", "12"],
          ["Avg. score", "6.8"],
          ["This week", "3"],
          ["Best streak", "5 days"],
        ].map(([k, v]) => (
          <div key={k} className="card-surface p-5">
            <p className="eyebrow">{k}</p>
            <p className="mt-2 font-display text-3xl">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="card-surface p-6 md:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl">Score trend</h2>
            <span className="text-xs text-muted-foreground">Frontend · Technical only</span>
          </div>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="mt-6 h-44 w-full overflow-visible"
          >
            <polyline
              points={pts}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            {trend.map((v, i) => (
              <circle
                key={i}
                cx={(i / (trend.length - 1)) * 100}
                cy={100 - (v / max) * 100}
                r="1.4"
                fill="var(--color-accent)"
              />
            ))}
          </svg>
          <p className="mt-3 text-xs text-muted-foreground">
            Scores are AI coaching estimates, not measures of hiring readiness.
          </p>
        </div>
        <div className="card-surface p-6">
          <h2 className="text-xl">By category</h2>
          <div className="mt-5 space-y-4">
            {categories.map((c) => (
              <div key={c.name}>
                <div className="flex justify-between text-sm">
                  <span>{c.name}</span>
                  <span className="font-semibold">{c.score}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${c.score * 10}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-lg bg-secondary p-3 text-sm">
            <p className="font-semibold">Suggested practice</p>
            <p className="text-muted-foreground">
              Structure answers with STAR — 5 behavioral questions.
            </p>
          </div>
        </div>
      </div>

      <div className="card-surface mt-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl">Recent sessions</h2>
          <input
            placeholder="Search role, type…"
            className="rounded-full border border-input bg-background px-4 py-2 text-sm"
          />
        </div>
        <div className="mt-4 divide-y divide-border">
          {historyPending && <p role="status">Loading sessions…</p>}
          {historyError && <p role="alert">{historyError.message}</p>}
          {!historyPending && !historyError && history.length === 0 && (
            <p>No saved sessions yet.</p>
          )}
          {history.map((h) => (
            <Link
              key={h.id}
              to={h.status === "complete" ? "/report" : "/interview"}
              search={{ interviewId: h.id }}
              className="flex items-center justify-between py-3 hover:opacity-80"
            >
              <div>
                <p className="font-medium">
                  {h.setup.role} · {h.setup.type}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(h.startedAt).toLocaleDateString()} · {h.setup.mode} mode
                </p>
              </div>
              <div className="flex items-center gap-4">
                {h.status === "incomplete" && (
                  <span className="rounded-full bg-warning/30 px-2 py-0.5 text-xs">Incomplete</span>
                )}
                <span className="font-display text-xl">
                  {h.answeredCount} / {h.setup.questionCount}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
