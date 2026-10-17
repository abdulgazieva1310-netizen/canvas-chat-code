import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "@/lib/api/client";
import type { Interview as InterviewData } from "@/lib/api/types";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/interview")({
  validateSearch: (search: Record<string, unknown>) => ({
    interviewId: typeof search["interviewId"] === "string" ? search["interviewId"].trim() : "",
  }),
  beforeLoad: ({ search }) => {
    if (!search.interviewId) throw redirect({ to: "/setup", replace: true });
  },
  head: () => ({
    meta: [
      { title: "Live interview — Interview Mirror" },
      {
        name: "description",
        content: "Answer questions from your AI interviewer by voice or text.",
      },
      { property: "og:title", content: "Live interview — Interview Mirror" },
      { property: "og:description", content: "Live AI mock interview." },
    ],
  }),
  component: Interview,
});

function Interview() {
  const { interviewId } = Route.useSearch();
  const navigate = useNavigate();
  const client = useQueryClient();
  const queryKey = ["interview", interviewId];
  const {
    data: interview,
    error,
    isPending,
  } = useQuery({
    queryKey,
    queryFn: () => Api.getInterview(interviewId),
    enabled: !!interviewId,
    retry: false,
  });
  const [text, setText] = useState("");
  const [sec, setSec] = useState(0);
  const [listening, setListening] = useState(false);
  const receive = async (updated: InterviewData) => {
    client.setQueryData(queryKey, updated);
    if (updated.status !== "active") await navigate({ to: "/report", search: { interviewId } });
  };
  const answer = useMutation({
    mutationFn: (value: string) => Api.sendMessage(interviewId, value),
    onSuccess: async (updated) => {
      setText("");
      await receive(updated);
    },
  });
  const end = useMutation({
    mutationFn: () => Api.endInterview(interviewId),
    onSuccess: receive,
  });
  const hint = useMutation({ mutationFn: () => Api.getHint(interviewId), onSuccess: receive });
  const busy = answer.isPending || end.isPending || hint.isPending;
  useEffect(() => {
    const startedAt = interview?.startedAt;
    const endedAt = interview?.endedAt;
    if (!startedAt) return;
    const tick = () =>
      setSec(
        Math.max(
          0,
          Math.floor(((endedAt ? Date.parse(endedAt) : Date.now()) - Date.parse(startedAt)) / 1000),
        ),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [interview?.startedAt, interview?.endedAt]);
  const send = () => {
    if (text.trim() && !busy) answer.mutate(text);
  };
  if (isPending) return <p role="status">Loading interview…</p>;
  if (error || !interview)
    return (
      <p role="alert">
        {error?.message ?? "Interview unavailable."} <Link to="/setup">New interview</Link>
      </p>
    );
  const setup = interview.setup;
  if (!setup) return <p role="status">Loading interview setup…</p>;
  const msgs = interview.messages;
  const practice = setup.mode === "Practice";
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive pulse-dot" />
          <span className="font-display text-lg">
            {setup.role} · {setup.type}
          </span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{setup.mode}</span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <span>
            Question <b>{Math.min(interview.answeredCount + 1, setup.questionCount)}</b> /{" "}
            {setup.questionCount}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {mm}:{ss}
          </span>
          <button disabled={busy} onClick={() => end.mutate()} className="btn btn-ghost py-1.5">
            {end.isPending ? "Ending…" : "End interview"}
          </button>
        </div>
      </header>
      <div className="h-1 bg-muted">
        <div
          className="h-1 bg-accent"
          style={{ width: `${(interview.answeredCount / setup.questionCount) * 100}%` }}
        />
      </div>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-6 py-8 md:grid-cols-[1fr_320px]">
        <section className="flex flex-col">
          {(answer.error || end.error || hint.error) && (
            <p role="alert">{(answer.error || end.error || hint.error)?.message}</p>
          )}
          <div className="flex-1 space-y-4">
            {msgs.map((m, i) =>
              m.from === "hint" ? (
                <div
                  key={i}
                  className="rounded-lg border border-dashed border-accent bg-accent/10 p-3 text-sm"
                >
                  <span className="eyebrow mr-2">Coach</span>
                  {m.text}
                </div>
              ) : (
                <div key={i} className={`flex ${m.from === "you" ? "justify-end" : ""}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-5 py-3 ${m.from === "ai" ? "card-surface font-display text-lg" : "bg-primary text-primary-foreground"}`}
                  >
                    {m.text}
                  </div>
                </div>
              ),
            )}
          </div>
          <div className="card-surface mt-6 flex items-center gap-3 p-3">
            <button
              onClick={() => setListening(!listening)}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${listening ? "bg-destructive text-destructive-foreground" : "bg-muted"}`}
              aria-label="Toggle microphone"
            >
              ●
            </button>
            <input
              disabled={busy || interview.status !== "active"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={listening ? "Listening… or type your answer" : "Type your answer"}
              className="flex-1 bg-transparent px-2 text-sm outline-none"
            />
            <button
              disabled={busy || !text.trim() || interview.status !== "active"}
              onClick={send}
              className="btn btn-primary"
            >
              {answer.isPending ? "Sending…" : "Send"}
            </button>
          </div>
        </section>
        <aside className="space-y-4">
          <div className="card-surface p-5">
            <p className="eyebrow">Interviewer</p>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex h-12 items-end gap-1">
                {[40, 70, 50, 90, 60].map((h, i) => (
                  <div
                    key={i}
                    className="w-1.5 rounded-full bg-primary pulse-dot"
                    style={{ height: `${h}%`, animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {answer.isPending ? "Thinking…" : "Ready for your answer"}
              </p>
            </div>
          </div>
          {practice && interview.lastFeedback && (
            <div className="card-surface p-5">
              <p className="eyebrow">Last answer</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {Object.entries(interview.lastFeedback).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-secondary p-2">
                    <p className="text-xs text-muted-foreground">{k}</p>
                    <p className="font-display text-xl">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {practice && (
            <button
              disabled={busy || interview.status !== "active"}
              onClick={() => hint.mutate()}
              className="btn btn-accent w-full"
            >
              {hint.isPending ? "Loading hint…" : "Ask for a hint"}
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
