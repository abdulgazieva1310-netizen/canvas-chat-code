import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/ready")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { interviewId?: string; retryId?: string } => ({
    interviewId: typeof search["interviewId"] === "string" ? search["interviewId"] : "",
    retryId: typeof search["retryId"] === "string" ? search["retryId"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Get ready — Interview Mirror" },
      {
        name: "description",
        content: "Check your microphone and review the rules before your interview starts.",
      },
      { property: "og:title", content: "Get ready — Interview Mirror" },
      { property: "og:description", content: "Pre-interview lobby." },
    ],
  }),
  component: Ready,
});

function Ready() {
  const client = useQueryClient();
  const [mic, setMic] = useState(false);
  const { interviewId, retryId } = Route.useSearch();
  const navigate = useNavigate();
  const sourceId = interviewId || retryId || "";
  const {
    data: interview,
    error,
    isPending,
  } = useQuery({
    queryKey: ["interview", sourceId],
    queryFn: () => Api.getInterview(sourceId),
    enabled: !!sourceId,
    retry: false,
  });
  const setup = interview?.setup ?? defaultSetup;
  const start = useMutation({
    mutationFn: async () => {
      const result =
        interviewId && interview?.status === "active" ? interview : await Api.startInterview(setup);
      if (typeof result?.id !== "string" || !result.id.trim()) {
        throw new Error(
          "The backend did not return an interview ID. Please start a new interview from Setup.",
        );
      }
      return result;
    },
    onSuccess: (result) => {
      client.setQueryData(["interview", result.id], result);
      void client.invalidateQueries({ queryKey: ["profile"] });
      return navigate({ to: "/interview", search: { interviewId: result.id } });
    },
  });
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Lobby</p>
        <h1 className="mt-2 text-4xl md:text-5xl">Take a breath.</h1>
        <p className="mt-3 text-muted-foreground">
          {setup.role} · {setup.type} · {setup.level} · {setup.mode} mode · {setup.questionCount}{" "}
          questions
        </p>
      </div>
      <div className="mx-auto mt-10 grid max-w-3xl gap-4 md:grid-cols-2">
        <div className="card-surface p-6">
          <h2 className="text-xl">Microphone</h2>
          <div className="mt-6 flex h-16 items-end gap-1">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className={`flex-1 rounded-full ${mic ? "bg-primary" : "bg-muted"}`}
                style={{ height: mic ? `${20 + ((i * 37) % 80)}%` : "15%" }}
              />
            ))}
          </div>
          <button className="btn btn-ghost mt-6 w-full" onClick={() => setMic(!mic)}>
            {mic ? "✓ Mic working" : "Test microphone"}
          </button>
          <p className="mt-3 text-xs text-muted-foreground">
            Audio is transcribed live and never stored.
          </p>
        </div>
        <div className="card-surface p-6">
          <h2 className="text-xl">How it works</h2>
          <ul className="mt-4 space-y-3 text-sm">
            <li>• {setup.questionCount} main questions; follow-ups don't count.</li>
            <li>• Difficulty adapts to your answers.</li>
            <li>• Ask for a hint any time (Practice mode).</li>
            <li>• No time limit — elapsed time is shown.</li>
            <li>• End early anytime; partial feedback is saved.</li>
          </ul>
        </div>
      </div>
      {(error || start.error) && <p role="alert">{(error || start.error)?.message}</p>}
      <div className="mt-10 flex justify-center gap-3">
        <Link to="/setup" className="btn btn-ghost">
          Change settings
        </Link>
        <button
          disabled={start.isPending || (!!sourceId && isPending) || !!error}
          onClick={() => start.mutate()}
          className="btn btn-primary"
        >
          {start.isPending ? "Starting…" : "Start interview"}
        </button>
      </div>
    </AppShell>
  );
}
