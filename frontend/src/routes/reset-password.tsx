import { createFileRoute } from "@tanstack/react-router";
import { RecoveryPage } from "@/components/RecoveryPage";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search["token"] === "string" ? { token: search["token"] } : {}),
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
  const navigate = Route.useNavigate();
  return (
    <RecoveryPage
      token={token ?? ""}
      onResetComplete={() => void navigate({ to: "/reset-password", search: {}, replace: true })}
    />
  );
}
