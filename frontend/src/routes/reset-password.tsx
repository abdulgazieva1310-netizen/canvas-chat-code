import { createFileRoute } from "@tanstack/react-router";
import { RecoveryPage } from "@/components/RecoveryPage";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? search["token"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Choose a new password — Interview Mirror" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token } = Route.useSearch();
  return <RecoveryPage token={token} />;
}
