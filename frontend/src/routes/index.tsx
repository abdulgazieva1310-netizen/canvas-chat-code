import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Api } from "@/lib/api/client";
import type { Interview } from "@/lib/api/types";
import { AppShell } from "@/components/AppShell";
import { DashboardSummary } from "@/components/DashboardSummary";

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

function Dashboard() {
  const client = useQueryClient();
  // Account identity and target come from saved profile settings, independently of sessions.
  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: Api.getProfile,
    retry: false,
  });
  const name = profile?.name?.trim() || "User";
  const target = profile?.targetRole?.trim()
    ? [profile.level?.trim(), profile.targetRole.trim()].filter(Boolean).join(" ")
    : "Not set";
  const {
    data: history = [],
    error: historyError,
    isPending: historyPending,
  } = useQuery({ queryKey: ["history"], queryFn: () => Api.getHistory() });
  const deletion = useMutation({
    mutationFn: (id: string) => Api.deleteInterview(id),
    onSuccess: async (_, id) => {
      await client.cancelQueries({ queryKey: ["history"] });
      client.setQueryData<Interview[]>(["history"], (sessions) =>
        sessions?.filter((session) => session.id !== id),
      );
      client.removeQueries({ queryKey: ["interview", id], exact: true });
      client.removeQueries({ queryKey: ["report", id], exact: true });
      await client.invalidateQueries({ queryKey: ["history"] });
      await client.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });
  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Welcome back, {name}</p>
          <h1 className="mt-2 text-4xl md:text-5xl">Your practice, reflected.</h1>
          <p className="mt-2 text-muted-foreground">
            Target: {target} · {profile?.preferredLanguage || "English"}
          </p>
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

      <DashboardSummary />

      <div className="card-surface mt-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl">Recent sessions</h2>
          <input
            placeholder="Search role, type…"
            className="rounded-full border border-input bg-background px-4 py-2 text-sm"
          />
        </div>
        <div className="mt-4 divide-y divide-border">
          {deletion.error && <p role="alert">Could not delete session: {deletion.error.message}</p>}
          {historyPending && <p role="status">Loading sessions…</p>}
          {historyError && <p role="alert">{historyError.message}</p>}
          {!historyPending && !historyError && history.length === 0 && (
            <p>No saved sessions yet.</p>
          )}
          {history.map((h) => (
            <div key={h.id} className="flex items-center gap-3">
              <Link
                to={h.status === "complete" ? "/report" : "/interview"}
                search={{ interviewId: h.id }}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 hover:opacity-80"
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
                    <span className="rounded-full bg-warning/30 px-2 py-0.5 text-xs">
                      Incomplete
                    </span>
                  )}
                  <span className="font-display text-xl">
                    {h.answeredCount} / {h.setup.questionCount}
                  </span>
                </div>
              </Link>
              <button
                type="button"
                aria-label={`Delete ${h.setup.role} session from ${new Date(h.startedAt).toLocaleDateString()}`}
                title="Delete session"
                disabled={deletion.isPending}
                onClick={() => deletion.mutate(h.id)}
                className="rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
