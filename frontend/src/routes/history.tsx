import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Interview History — Interview Mirror" }] }),
  component: History,
});

function History() {
  return (
    <AppShell>
      <h1 className="text-4xl">Interview History</h1>
      <p className="mt-4 text-muted-foreground">
        Your saved interviews currently appear on the Dashboard. Search and filters will be
        available here.
      </p>
      <Link to="/" className="btn btn-primary mt-6">
        View saved interviews
      </Link>
    </AppShell>
  );
}
