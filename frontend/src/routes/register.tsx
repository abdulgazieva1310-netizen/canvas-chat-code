import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";
import { validateAuthSearch } from "@/lib/auth-redirect";

export const Route = createFileRoute("/register")({
  validateSearch: validateAuthSearch,
  head: () => ({ meta: [{ title: "Create account — Interview Mirror" }] }),
  component: Register,
});

function Register() {
  const { redirect } = Route.useSearch();
  return <AuthPage register redirect={redirect} />;
}
