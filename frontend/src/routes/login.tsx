import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";
import { validateAuthSearch } from "@/lib/auth-redirect";

export const Route = createFileRoute("/login")({
  validateSearch: validateAuthSearch,
  head: () => ({ meta: [{ title: "Sign in — Interview Mirror" }] }),
  component: Login,
});

function Login() {
  const { redirect } = Route.useSearch();
  return <AuthPage redirect={redirect} />;
}
