import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api, ApiError } from "@/lib/api/client";

export function AuthGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [needsLogin, setNeedsLogin] = useState(false);
  const [register, setRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const session = useQuery({
    queryKey: ["history"],
    queryFn: Api.getHistory,
    retry: false,
    enabled: !needsLogin,
  });
  useEffect(() => {
    const expired = () => setNeedsLogin(true);
    window.addEventListener("api:unauthorized", expired);
    return () => window.removeEventListener("api:unauthorized", expired);
  }, []);
  const auth = useMutation({
    mutationFn: () =>
      register ? Api.register({ name, email, password }) : Api.login(email, password),
    onSuccess: async () => {
      await client.cancelQueries();
      client.clear();
      setPassword("");
      setNeedsLogin(false);
    },
  });

  if (needsLogin || (session.error instanceof ApiError && session.error.status === 401)) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-3xl">
          {register ? "Create your account" : "Sign in to Interview Mirror"}
        </h1>
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            auth.mutate();
          }}
        >
          {register && (
            <label className="block">
              Name
              <input
                className="mt-1 w-full rounded-lg border p-3"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <label className="block">
            Email
            <input
              className="mt-1 w-full rounded-lg border p-3"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block">
            Password
            <input
              className="mt-1 w-full rounded-lg border p-3"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {auth.error && <p role="alert">{auth.error.message}</p>}
          <button className="btn btn-primary w-full" disabled={auth.isPending}>
            {auth.isPending ? "Please wait…" : register ? "Create account" : "Sign in"}
          </button>
          <button
            type="button"
            className="btn btn-ghost w-full"
            disabled={auth.isPending}
            onClick={() => {
              setRegister(!register);
              auth.reset();
            }}
          >
            {register ? "Already have an account? Sign in" : "Create an account"}
          </button>
        </form>
      </main>
    );
  }
  if (session.isPending)
    return (
      <p role="status" className="p-10">
        Loading session…
      </p>
    );
  if (session.error)
    return (
      <main className="p-10">
        <p role="alert">{session.error.message}</p>
        <button className="btn btn-primary mt-4" onClick={() => void session.refetch()}>
          Retry
        </button>
      </main>
    );
  return children;
}
