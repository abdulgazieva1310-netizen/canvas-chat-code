import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Api } from "@/lib/api/client";

export function AuthPage({ register = false, redirect }: { register?: boolean; redirect: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const auth = useMutation({
    mutationFn: () =>
      register ? Api.register({ name, email, password }) : Api.login(email, password),
    onSuccess: async () => {
      await client.cancelQueries();
      client.clear();
      setPassword("");
      await navigate({ href: redirect, replace: true });
    },
  });
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Link to="/" className="font-display text-lg">
        Interview Mirror
      </Link>
      <h1 className="mt-6 text-3xl">
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
              className="mt-1 w-full rounded-lg border bg-background p-3"
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
            className="mt-1 w-full rounded-lg border bg-background p-3"
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
            className="mt-1 w-full rounded-lg border bg-background p-3"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {auth.error && <p role="alert">{auth.error.message}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={auth.isPending}>
          {auth.isPending ? "Please wait…" : register ? "Create account" : "Sign in"}
        </button>
        <Link
          to={register ? "/login" : "/register"}
          search={{ redirect }}
          className="btn btn-ghost w-full"
        >
          {register ? "Already have an account? Sign in" : "Create an account"}
        </Link>
      </form>
    </main>
  );
}
