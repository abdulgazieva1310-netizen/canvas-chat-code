import { UserMenu } from "@/components/UserMenu";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Interview } from "@/lib/api/types";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";

const steps = [
  { to: "/", label: "Dashboard" },
  { to: "/setup", label: "Setup" },
  { to: "/ready", label: "Lobby" },
  { to: "/interview", label: "Interview" },
  { to: "/report", label: "Report" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const subscribe = useCallback(
    (changed: () => void) => client.getQueryCache().subscribe(changed),
    [client],
  );
  // AuthGate/Dashboard own fetching. Subscribe directly without creating a query
  // observer that can overwrite their query options with a missing queryFn.
  const getHistory = useCallback(
    () => client.getQueryData<Interview[]>(["history"]),
    [client],
  );
  const history = useSyncExternalStore(subscribe, getHistory, () => undefined) ?? [];
  const getActiveInterview = useCallback(
    () => client.getQueriesData<Interview>({ queryKey: ["interview"] })
      .map(([, session]) => session)
      .filter((session): session is Interview =>
        !!session && session.status === "active" && !!session.id?.trim(),
      )
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null,
    [client],
  );
  const activeInterview = useSyncExternalStore(subscribe, getActiveInterview, () => null);
  const incompleteInterview = history
    .filter((session) => (session.status === "incomplete" || session.status === "active") && session.id.trim())
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  const latestReport = history.find(
    (session) => session.status === "complete" && session.id.trim(),
  );
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/70 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary font-display text-primary-foreground">
              M
            </span>
            <span className="font-display text-lg">Interview Mirror</span>
          </Link>
          <nav className="hidden gap-1 md:flex">
            {steps.map((s) => {
              const session =
                s.to === "/interview"
                  ? activeInterview ?? incompleteInterview
                  : s.to === "/report"
                    ? latestReport
                    : undefined;
              if (s.to === "/report" && !session) {
                return (
                  <span
                    key={s.to}
                    aria-disabled="true"
                    className="cursor-not-allowed rounded-full px-3 py-1.5 text-sm text-muted-foreground opacity-50"
                    title="No completed interviews yet"
                  >
                    {s.label}
                  </span>
                );
              }
              return (
                <Link
                  key={s.to}
                  to={s.to === "/interview" && !session ? "/setup" : s.to}
                  search={session ? { interviewId: session.id } : {}}
                  className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                  activeProps={{ className: "bg-muted text-foreground" }}
                  activeOptions={{ exact: true, includeSearch: false }}
                >
                  {s.label}
                </Link>
              );
            })}
          </nav>
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
