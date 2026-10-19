import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Api, ApiError } from "@/lib/api/client";

export function RecoveryPage({
  token,
  onResetComplete,
}: {
  token?: string | undefined;
  onResetComplete?: () => void;
}) {
  const resetting = token !== undefined;
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const action = useMutation({
    mutationFn: async () => {
      if (resetting) await Api.resetPassword(token, password);
      else await Api.requestPasswordReset(email);
    },
    onSuccess: async () => {
      if (resetting) {
        await client.cancelQueries();
        client.clear();
        setPassword("");
        setConfirmation("");
        onResetComplete?.();
      }
    },
  });
  const invalidLink =
    resetting && (!token || (action.error instanceof ApiError && action.error.status === 400));
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-3xl">{resetting ? "Choose a new password" : "Reset your password"}</h1>
      {action.isSuccess ? (
        <p role="status" className="mt-6">
          {resetting
            ? "Your password has been changed. Sign in with your new password."
            : "If this account exists, a reset link will be sent. Check your inbox and spam folder. If it does not arrive, try again or contact support."}
        </p>
      ) : invalidLink ? (
        <p role="alert" className="mt-6">
          This reset link is invalid or expired. Request a new link below.
        </p>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (action.isPending) return;
            setMismatch(resetting && password !== confirmation);
            if (!resetting || password === confirmation) action.mutate();
          }}
        >
          {resetting ? (
            <>
              <label className="block">
                New password
                <input
                  className="mt-1 w-full rounded-lg border bg-background p-3"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="block">
                Confirm new password
                <input
                  className="mt-1 w-full rounded-lg border bg-background p-3"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="block">
              Email
              <input
                className="mt-1 w-full rounded-lg border bg-background p-3"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          {mismatch && <p role="alert">Passwords must match.</p>}
          {action.error && (
            <p role="alert">
              {resetting
                ? "Could not change your password. Please try again."
                : "Could not request a reset link. Please try again."}
            </p>
          )}
          <button className="btn btn-primary w-full" disabled={action.isPending} type="submit">
            {action.isPending
              ? "Please wait…"
              : resetting
                ? "Save new password"
                : "Send reset link"}
          </button>
        </form>
      )}
      <div className="mt-6 space-y-2">
        {(resetting || action.isSuccess) && (
          <Link
            to="/forgot-password"
            className="btn btn-ghost w-full"
            onClick={() => action.reset()}
          >
            Request another reset link
          </Link>
        )}
        <Link to="/login" search={{ redirect: "/" }} className="btn btn-ghost w-full">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
