import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Api } from "@/lib/api/client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MarkdownContent } from "@/components/MarkdownContent";

export const Route = createFileRoute("/report")({
  validateSearch: (search: Record<string, unknown>) => ({
    interviewId: typeof search["interviewId"] === "string" ? search["interviewId"].trim() : "",
  }),
  beforeLoad: ({ search }) => {
    if (!search.interviewId) throw redirect({ to: "/", replace: true });
  },
  head: () => ({
    meta: [
      { title: "Interview report — Interview Mirror" },
      {
        name: "description",
        content: "Scores, written feedback, stronger example answers and full transcript.",
      },
      { property: "og:title", content: "Interview report — Interview Mirror" },
      { property: "og:description", content: "Your interview feedback report." },
    ],
  }),
  component: Report,
});

function Report() {
  const [open, setOpen] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [highlightedAnswerId, setHighlightedAnswerId] = useState<string | null>(null);
  const [playingMedia, setPlayingMedia] = useState<{
    id: string;
    url: string;
    type: string;
  } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaPending, setMediaPending] = useState(false);
  const { interviewId } = Route.useSearch();
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["report", interviewId],
    queryFn: () => Api.getReport(interviewId),
    enabled: !!interviewId.trim(),
    retry: false,
  });
  const mediaQuery = useQuery({
    queryKey: ["interview-media", interviewId],
    queryFn: () => Api.listInterviewMedia(interviewId),
    enabled: !!interviewId.trim(),
    retry: false,
  });
  useEffect(
    () => () => {
      if (playingMedia) URL.revokeObjectURL(playingMedia.url);
    },
    [playingMedia],
  );
  const playMedia = async (mediaId: string) => {
    setMediaPending(true);
    setMediaError(null);
    try {
      const blob = await Api.downloadInterviewMedia(interviewId, mediaId);
      setPlayingMedia({ id: mediaId, url: URL.createObjectURL(blob), type: blob.type });
    } catch {
      setMediaError(
        "Recording playback is unavailable. Your transcript and report are still available.",
      );
    } finally {
      setMediaPending(false);
    }
  };
  const deleteMedia = async (mediaId: string) => {
    setMediaError(null);
    try {
      await Api.deleteInterviewMedia(interviewId, mediaId);
      await mediaQuery.refetch();
      if (playingMedia?.id === mediaId) setPlayingMedia(null);
    } catch {
      setMediaError("The recording could not be deleted. Please try again.");
    }
  };
  useEffect(() => {
    if (!transcriptOpen || !highlightedAnswerId) return;
    const target = document.getElementById(`transcript-${highlightedAnswerId}`);
    target?.focus({ preventScroll: true });
    if (target && "scrollIntoView" in target)
      target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [transcriptOpen, highlightedAnswerId]);
  if (isPending)
    return (
      <AppShell>
        <p role="status">Loading report…</p>
      </AppShell>
    );
  if (error || !data)
    return (
      <AppShell>
        <p role="alert">{error?.message ?? "Report unavailable."}</p>
        <button type="button" className="btn btn-ghost mt-3" onClick={() => void refetch()}>
          Retry report
        </button>
        <Link to="/setup">New interview</Link>
      </AppShell>
    );
  const { interview, feedback } = data;
  const russian = interview.setup.language === "Russian";
  const staticCodeReview =
    interview.setup.type === "Technical" &&
    [
      "Python Developer",
      "Java Developer",
      "C++ Developer",
      "Backend Developer",
      "Full Stack Developer",
    ].includes(interview.setup.role);
  const qs = feedback.questions;
  const practiceSuggestions = [
    ...new Map(
      qs.flatMap((item) => {
        const topics = item.practiceTopics?.length
          ? item.practiceTopics
          : item.practiceTopic
            ? [item.practiceTopic]
            : [];
        return topics.map((rawTopic) => {
          const topic = rawTopic.trim().replace(/\s+/g, " ");
          return [topic.toLocaleLowerCase(), [topic, item.answerId] as const] as const;
        });
      }),
    ).values(),
  ].slice(0, 3);
  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">
            {new Date(interview.startedAt).toLocaleDateString()} · {interview.answeredCount} of{" "}
            {interview.setup.questionCount} questions · {interview.status}
          </p>
          <h1 className="mt-2 text-4xl md:text-5xl">
            {interview.setup.role} · {interview.setup.type}
          </h1>
        </div>
        <div className="flex gap-3">
          <Link to="/ready" search={{ retryId: interview.id }} className="btn btn-ghost">
            Retry
          </Link>
          <Link to="/setup" className="btn btn-primary">
            Choose practice settings
          </Link>
        </div>
      </div>

      {interview.status === "incomplete" && (
        <p role="status" className="card-surface mt-4 p-4">
          Incomplete interview: {feedback.answeredQuestions} of {feedback.selectedQuestions} main
          questions answered. Feedback covers only submitted answers.
        </p>
      )}
      <section className="card-surface mt-4 space-y-3 p-5" aria-label="Saved recordings">
        <h2 className="text-xl">Saved recordings</h2>
        <p className="text-sm text-muted-foreground">
          Recordings are private to your account and expire after{" "}
          {mediaQuery.data?.retentionDays ?? 30} days. Deleting a recording does not remove your
          transcript or report.
        </p>
        {mediaQuery.isPending && <p role="status">Checking for saved recordings…</p>}
        {mediaQuery.isError && (
          <p role="status">
            Saved recordings could not be loaded; your transcript and report are unaffected.
          </p>
        )}
        {mediaQuery.data?.media.map((media) => (
          <div key={media.id} className="rounded-lg border p-3">
            <p className="text-sm">
              {media.mediaType.startsWith("video/") ? "Video" : "Audio"} · expires{" "}
              {new Date(media.expiresAt).toLocaleDateString()}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={mediaPending}
                onClick={() => void playMedia(media.id)}
              >
                {mediaPending ? "Loading…" : "Play recording"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void deleteMedia(media.id)}
              >
                Delete recording
              </button>
            </div>
            {playingMedia?.id === media.id &&
              (media.mediaType.startsWith("video/") ? (
                <video
                  className="mt-3 max-h-96 w-full rounded-lg bg-black"
                  controls
                  playsInline
                  src={playingMedia.url}
                />
              ) : (
                <audio className="mt-3 w-full" controls src={playingMedia.url} />
              ))}
          </div>
        ))}
        {!mediaQuery.isPending && mediaQuery.data?.media.length === 0 && (
          <p className="text-sm">
            No saved recordings. You can still review the complete transcript above.
          </p>
        )}
        {mediaError && (
          <p role="alert" className="text-sm">
            {mediaError}
          </p>
        )}
      </section>
      {staticCodeReview && (
        <p role="note" className="card-surface mt-4 p-4">
          {russian
            ? "Проверка кода с помощью ИИ: отправленный код анализируется без компиляции и выполнения."
            : "Static AI code review: submissions are reviewed without compiling or executing them."}
        </p>
      )}
      {interview.answeredCount === 0 ? (
        <p role="status" className="card-surface mt-4 p-4">
          No answers were submitted, so there is no coaching feedback yet.
        </p>
      ) : feedback.overall === null ? (
        <p role="status" className="card-surface mt-4 p-4">
          This interview was not scored. Unavailable scores are not shown as zero.
        </p>
      ) : null}
      <div className="mt-8 grid gap-4 md:grid-cols-5">
        <div className="card-surface flex flex-col justify-center p-6 md:col-span-1">
          <p className="eyebrow">
            {russian ? "Общая оценка · рекомендация ИИ" : "Overall · AI coaching estimate"}
          </p>
          <p className="font-display text-4xl">{feedback.overall ?? "Not scored"}</p>
          <p className="text-xs text-muted-foreground">
            Approximate coaching feedback, not a measure of hiring readiness.
          </p>
        </div>
        {Object.entries(feedback.scores ?? {}).map(([k, v]) => (
          <div key={k} className="card-surface p-6">
            <p className="eyebrow">{k}</p>
            <p className="mt-2 font-display text-3xl">{v ?? "Not scored"}</p>
            <div className="mt-3 h-1.5 rounded-full bg-muted">
              {v !== null && (
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${v * 10}%` }} />
              )}
            </div>
          </div>
        ))}
      </div>
      {feedback.scores && (
        <p className="text-sm text-muted-foreground">
          Category averages use available scored answers. Per-answer notes below explain the
          coaching rationale.
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="card-surface p-6">
          <h2 className="text-xl">{russian ? "Сильные стороны" : "Strengths"}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {feedback.strengths.map((text) => (
              <li key={text} className="flex gap-2">
                <span aria-hidden="true">✓</span>
                <MarkdownContent>{text}</MarkdownContent>
              </li>
            ))}
          </ul>
          {feedback.strengths.length === 0 && (
            <p className="mt-2 text-sm">No supported strengths to report yet.</p>
          )}
          <h2 className="mt-6 text-xl">{russian ? "Зоны роста" : "Weaknesses"}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {feedback.gaps.map((text) => (
              <li key={text} className="flex gap-2">
                <span aria-hidden="true">△</span>
                <MarkdownContent>{text}</MarkdownContent>
              </li>
            ))}
          </ul>
          {feedback.gaps.length === 0 && (
            <p className="mt-2 text-sm">No supported gaps to report yet.</p>
          )}
        </div>
        <div className="card-surface p-6 md:col-span-2">
          <h2 className="text-xl">{russian ? "Вопросы и ответы" : "Question by question"}</h2>
          <div className="mt-4 divide-y divide-border">
            {qs.map((x, i) => (
              <div key={i} className="py-3">
                <button
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => setOpen(open === i ? -1 : i)}
                >
                  <span className="font-medium">
                    {russian ? `Вопрос ${i + 1}` : `Question ${i + 1}`}
                  </span>
                  <span className="font-display text-xl">{x.score ?? "Not scored"}</span>
                </button>
                {open === i && (
                  <div className="mt-3 space-y-3 text-sm">
                    <MarkdownContent>{x.q}</MarkdownContent>
                    <div>
                      <p className="font-semibold">{russian ? "Ваш ответ" : "Your answer"}</p>
                      <pre className="mt-1 whitespace-pre-wrap font-mono">{x.answer}</pre>
                      <a
                        href={`#transcript-${x.answerId}`}
                        className="btn btn-ghost mt-2"
                        onClick={(event) => {
                          event.preventDefault();
                          setHighlightedAnswerId(x.answerId);
                          setTranscriptOpen(true);
                        }}
                      >
                        View this answer in transcript
                      </a>
                    </div>
                    {x.scores && (
                      <div>
                        <p className="font-semibold">
                          Category scores · approximate AI coaching estimates
                        </p>
                        <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {Object.entries(x.scores).map(([category, score]) => (
                            <div key={category}>
                              <dt className="capitalize text-muted-foreground">{category}</dt>
                              <dd>{score === null ? "Not scored" : `${score} / 10`}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="mt-2 text-muted-foreground">
                          Rationale: the notes below explain what the answer covered and what it
                          missed.
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="mb-1 font-semibold text-success">
                        {russian ? "Что получилось хорошо" : "Went well"}
                      </p>
                      <MarkdownContent>{x.good}</MarkdownContent>
                    </div>
                    <div>
                      <p className="mb-1 font-semibold text-destructive">
                        {russian ? "Что можно улучшить" : "Missing"}
                      </p>
                      <MarkdownContent>{x.miss}</MarkdownContent>
                    </div>
                    <div className="rounded-lg bg-secondary p-3">
                      <p className="eyebrow mb-1">
                        {russian ? "Пример более сильного ответа" : "Stronger answer"}
                      </p>
                      <MarkdownContent>{x.better}</MarkdownContent>
                    </div>
                    {x.codingJudge && (
                      <div className="rounded-lg border p-3" role="status">
                        <p className="font-semibold">
                          Automated correctness checks: {x.codingJudge.status}
                        </p>
                        <p className="mt-1">{x.codingJudge.summary}</p>
                        {(x.codingJudge.status === "passed" ||
                          x.codingJudge.status === "failed") && (
                          <p className="mt-1">
                            {x.codingJudge.passed} of {x.codingJudge.total} checks passed.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {qs.length === 0 && <p>No answered questions are available in this report.</p>}
          <button onClick={() => setTranscriptOpen(!transcriptOpen)} className="btn btn-ghost mt-4">
            {transcriptOpen ? "Hide transcript" : "View full transcript"}
          </button>
          {transcriptOpen && (
            <div className="mt-4 space-y-3">
              {interview.messages.map((message) => (
                <div
                  key={message.id}
                  id={`transcript-${message.id}`}
                  tabIndex={-1}
                  data-highlighted={message.id === highlightedAnswerId || undefined}
                  className="rounded p-2 data-[highlighted=true]:bg-primary/10"
                >
                  {message.from === "ai" && message.kind === "follow-up" && (
                    <p className="eyebrow mb-2">Follow-up</p>
                  )}
                  <p className="mb-1 font-semibold">{message.from}:</p>
                  {message.from === "you" ? (
                    <pre className="whitespace-pre-wrap font-mono text-sm">{message.text}</pre>
                  ) : (
                    <MarkdownContent>{message.text}</MarkdownContent>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {practiceSuggestions.length > 0 && (
        <section
          className="card-surface mt-4 p-6"
          aria-label="Evidence-backed practice suggestions"
        >
          <h2 className="text-xl">Practice a documented weak area</h2>
          <ul className="mt-3 flex flex-wrap gap-3">
            {practiceSuggestions.map(([topic, answerId]) => (
              <li key={answerId}>
                <Link
                  to="/ready"
                  search={{ retryId: interview.id, practiceTopic: topic }}
                  className="btn btn-ghost"
                >
                  Practice: {topic}
                </Link>
                <a
                  href={`#transcript-${answerId}`}
                  className="ml-2 underline"
                  onClick={(event) => {
                    event.preventDefault();
                    setHighlightedAnswerId(answerId);
                    setTranscriptOpen(true);
                  }}
                >
                  Evidence
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
