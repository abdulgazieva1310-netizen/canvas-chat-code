import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const steps = [
  { to: "/", label: "Dashboard" },
  { to: "/setup", label: "Setup" },
  { to: "/ready", label: "Lobby" },
  { to: "/interview", label: "Interview" },
  { to: "/report", label: "Report" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/70 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary font-display text-primary-foreground">M</span>
            <span className="font-display text-lg">Interview Mirror</span>
          </Link>
          <nav className="hidden gap-1 md:flex">
            {steps.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                activeProps={{ className: "bg-muted text-foreground" }}
                activeOptions={{ exact: true }}
              >
                {s.label}
              </Link>
            ))}
          </nav>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-sm font-semibold">AK</div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
