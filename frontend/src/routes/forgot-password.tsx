import { createFileRoute } from "@tanstack/react-router";
import { RecoveryPage } from "@/components/RecoveryPage";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password — Interview Mirror" }] }),
  component: RecoveryPage,
});
