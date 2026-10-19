import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "@/lib/api/client";
import type { CodeRunResult, Interview as InterviewData } from "@/lib/api/types";
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Camera, CameraOff, Mic, MicOff } from "lucide-react";
import CodeEditor, { type CodingLanguage } from "@/components/CodeEditor";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useSpokenQuestion } from "@/hooks/use-spoken-question";
import { useCameraPreview } from "@/hooks/use-camera-preview";
import { getInterviewerAvatar, type InterviewerAvatarId } from "@/lib/interviewer-avatar";

const Interviewer3D = lazy(() =>
  import("@/components/Interviewer3D").then((module) => ({ default: module.Interviewer3D })),
);

class ThreeDFallbackBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const languageLabels: Record<CodingLanguage, string> = {
  python: "Python",
  java: "Java",
  cpp: "C++",
  javascript: "JavaScript",
  typescript: "TypeScript",
};

const codeTemplates: Record<CodingLanguage, string> = {
  javascript: `function solution() {
    // Write your code here
}
`,
  typescript: `function solution(): void {
    // Write your code here
}
`,
  java: `class Solution {
    // Write your code here
}
`,
  python: `def solution():
    # Write your code here
    pass
`,
  cpp: `#include <vector>

class Solution {
public:
    // Write your code here
};
`,
};

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
    refetch,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      const saved = await Api.getInterview(interviewId);
      if (saved?.status !== "incomplete") return saved;
      const resumed = await Api.resumeInterview(interviewId);
      void client.invalidateQueries({ queryKey: ["history"] });
      return resumed;
    },
    enabled: !!interviewId,
    retry: false,
  });
  const camera = useCameraPreview();
  const cameraVideo = useRef<HTMLVideoElement>(null);
  const [text, setText] = useState("");
  const [sec, setSec] = useState(0);
  const [show3D, setShow3D] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [avatarId, setAvatarId] = useState<InterviewerAvatarId>("classic");
  const [recordingMode, setRecordingMode] = useState<"audio" | "video">("audio");
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingStarting, setRecordingStarting] = useState(false);
  const [recordingUpload, setRecordingUpload] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingUploadRef = useRef<Promise<void>>(Promise.resolve());
  const discardRecordingRef = useRef(false);
  const recordingMountedRef = useRef(false);
  useEffect(() => {
    setRecordingConsent(false);
    setRecording(false);
    setRecordingError(null);
  }, [interviewId]);
  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      const stopped = new Promise<void>((resolve) =>
        recorder.addEventListener("stop", () => resolve(), { once: true }),
      );
      recorder.stop();
      await stopped;
    }
    await recordingUploadRef.current;
  }, []);
  const startRecording = useCallback(async () => {
    if (recordingStarting) return;
    setRecordingError(null);
    if (!recordingConsent) {
      setRecordingError("Review and accept the recording notice before starting.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingError(
        "Recording is unavailable in this browser. Your interview transcript is still saved.",
      );
      return;
    }
    setRecordingStarting(true);
    try {
      await Api.setMediaConsent(interviewId, true);
      if (!recordingMountedRef.current) return;
      camera.stop();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: recordingMode === "video",
      });
      if (!recordingMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const preferredType = recordingMode === "video" ? "video/webm" : "audio/webm";
      const fallbackType = recordingMode === "video" ? "video/mp4" : "audio/mp4";
      const mimeType = MediaRecorder.isTypeSupported(preferredType)
        ? preferredType
        : MediaRecorder.isTypeSupported(fallbackType)
          ? fallbackType
          : "";
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recordingStreamRef.current = stream;
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      discardRecordingRef.current = false;
      recorder.ondataavailable = (event) => {
        if (discardRecordingRef.current) return;
        if (!event.data.size) return;
        const size = recordingChunksRef.current.reduce((total, chunk) => total + chunk.size, 0);
        if (size + event.data.size > 100 * 1024 * 1024) {
          discardRecordingRef.current = true;
          setRecording(false);
          setRecordingError(
            "The recording reached the 100 MB limit and was discarded. You can continue with your transcript.",
          );
          recorder.stop();
          return;
        }
        recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || mimeType });
        recordingChunksRef.current = [];
        if (!discardRecordingRef.current && blob.size) {
          setRecordingUpload(true);
          recordingUploadRef.current = Api.uploadInterviewMedia(interviewId, blob)
            .then(() => undefined)
            .catch(() => {
              setRecordingError(
                "The recording could not be saved. Your interview transcript and report are still available.",
              );
            })
            .finally(() => setRecordingUpload(false));
        }
        if (recordingMountedRef.current) setRecording(false);
      };
      recorder.start(1000);
      setRecording(true);
    } catch {
      if (recordingMountedRef.current) {
        setRecordingError(
          "Recording could not start or be saved. Your interview remains available through its transcript.",
        );
      }
    } finally {
      if (recordingMountedRef.current) setRecordingStarting(false);
    }
  }, [camera, interviewId, recordingConsent, recordingMode, recordingStarting]);
  useEffect(() => {
    recordingMountedRef.current = true;
    return () => {
      recordingMountedRef.current = false;
      discardRecordingRef.current = true;
      recorderRef.current?.stop();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  const fail3D = useCallback(() => {
    setRenderFailed(true);
    setShow3D(false);
  }, []);
  useEffect(() => {
    setAvatarId(getInterviewerAvatar());
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  const receive = async (updated: InterviewData) => {
    client.setQueryData(queryKey, updated);
    if (updated.status !== "active") {
      await stopRecording();
      await navigate({ to: "/report", search: { interviewId } });
    }
  };
  const answer = useMutation({
    mutationFn: (value: string) =>
      codingLanguage
        ? Api.sendMessage(interviewId, value, languageLabels[codingLanguage], latestQuestion?.id)
        : Api.sendMessage(interviewId, value, undefined, latestQuestion?.id),
    onSuccess: async (updated) => {
      setText("");
      await receive(updated);
    },
  });
  const end = useMutation({
    mutationFn: () => Api.endInterview(interviewId),
    onSuccess: async (updated) => {
      camera.stop();
      await receive(updated);
    },
  });
  const hint = useMutation({ mutationFn: () => Api.getHint(interviewId), onSuccess: receive });
  const codingLanguages: Record<string, CodingLanguage> = {
    "Python Developer": "python",
    "Java Developer": "java",
    "C++ Developer": "cpp",
    "Backend Developer": "python",
    "Full Stack Developer": "javascript",
  };
  const [selectedLanguage, setSelectedLanguage] = useState<CodingLanguage | null>(null);
  useEffect(() => {
    const video = cameraVideo.current;
    if (video) video.srcObject = camera.stream;
    return () => {
      if (video) video.srcObject = null;
    };
  }, [camera.stream]);
  const defaultLanguage =
    interview?.setup?.type === "Technical" ? codingLanguages[interview.setup.role] : undefined;
  useEffect(() => {
    setSelectedLanguage(null);
  }, [interviewId, defaultLanguage]);
  const codingLanguage = defaultLanguage ? (selectedLanguage ?? defaultLanguage) : undefined;
  const codeRun = useMutation({
    mutationFn: (code: string) => {
      if (!codingLanguage)
        throw new Error("Code execution is only available for coding questions.");
      return Api.runCode(interviewId, { language: languageLabels[codingLanguage], code });
    },
  });
  const resetCodeRun = codeRun.reset;
  const busy = answer.isPending || end.isPending || hint.isPending || codeRun.isPending;
  useEffect(() => {
    setText(codingLanguage ? codeTemplates[codingLanguage] : "");
    resetCodeRun();
  }, [interviewId, interview?.answeredCount, codingLanguage, resetCodeRun]);
  const voiceMode = interview?.setup?.input === "Voice" && !codingLanguage;
  const speech = useSpeechRecognition(
    voiceMode && interview?.status === "active" && !busy && !error,
    interviewId,
    setText,
  );
  const latestQuestion = [...(interview?.messages ?? [])]
    .reverse()
    .find((item) => item.from === "ai");
  const spoken = useSpokenQuestion(
    interview?.setup?.input === "Voice" && !codingLanguage && interview?.status === "active",
    latestQuestion?.id ?? "",
    latestQuestion?.text ?? "",
  );
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
    if (text.trim() && !busy && interview?.status === "active") {
      speech.cancel();
      spoken.stop();
      answer.mutate(codingLanguage ? text : text.trim());
    }
  };
  if (isPending) return <p role="status">Loading interview…</p>;
  if (error || !interview)
    return (
      <p role="alert">
        {error?.message ?? "Interview unavailable."}{" "}
        {error && (
          <button type="button" className="btn btn-ghost ml-2" onClick={() => void refetch()}>
            Retry loading
          </button>
        )}{" "}
        <Link to="/setup">New interview</Link>
      </p>
    );
  const setup = interview.setup;
  if (!setup) return <p role="status">Loading interview setup…</p>;
  const msgs = interview.messages;
  const questionNumber =
    latestQuestion?.kind === "follow-up"
      ? Math.max(1, interview.answeredCount)
      : Math.min(interview.answeredCount + 1, setup.questionCount);
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
            Question <b>{questionNumber}</b> / {setup.questionCount}
          </span>
          <span>
            Difficulty <b>{interview.effectiveLevel ?? setup.level}</b>
          </span>
          <span className="tabular-nums text-muted-foreground">
            {mm}:{ss}
          </span>
          <button
            disabled={busy || interview.status !== "active"}
            onClick={() => {
              camera.stop();
              speech.cancel();
              spoken.stop();
              void stopRecording().finally(() => end.mutate());
            }}
            className="btn btn-ghost py-1.5"
          >
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
      {interview.difficultyDecisions?.length ? (
        <p
          role="status"
          className="mx-auto mt-3 w-full max-w-6xl px-6 text-sm text-muted-foreground"
        >
          {interview.difficultyDecisions[interview.difficultyDecisions.length - 1].reason}
        </p>
      ) : null}

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-6 py-8 md:grid-cols-[1fr_320px]">
        <section className="flex min-w-0 flex-col">
          {(answer.error || end.error || hint.error) && (
            <p role="alert">{(answer.error || end.error || hint.error)?.message}</p>
          )}
          <div className="flex-1 space-y-4">
            {msgs.map((m, i) =>
              m.from === "hint" ? (
                <div
                  key={i}
                  role="note"
                  aria-label="Interview hint"
                  className="rounded-lg border border-dashed border-accent bg-accent/10 p-3 text-sm"
                >
                  <p className="eyebrow mb-2">Hint</p>
                  <MarkdownContent>{m.text}</MarkdownContent>
                </div>
              ) : (
                <div key={i} className={`flex ${m.from === "you" ? "justify-end" : ""}`}>
                  <div
                    className={`min-w-0 rounded-2xl px-5 py-4 ${m.from === "ai" ? "card-surface w-full" : "max-w-[85%] bg-primary text-primary-foreground"}`}
                  >
                    {m.from === "ai" ? (
                      <>
                        {m.kind === "follow-up" && <p className="eyebrow mb-2">Follow-up</p>}
                        <MarkdownContent>{m.text}</MarkdownContent>
                      </>
                    ) : codingLanguage ? (
                      <pre className="whitespace-pre-wrap font-mono text-sm">{m.text}</pre>
                    ) : (
                      <span className="whitespace-pre-wrap">{m.text}</span>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
          {voiceMode && latestQuestion && (
            <div
              className="mt-4 flex flex-wrap items-center gap-2"
              aria-label="Question playback controls"
            >
              <button type="button" className="btn btn-ghost" onClick={spoken.replay}>
                Replay question
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={spoken.stop}
                disabled={!spoken.supported}
              >
                Stop playback
              </button>
              <button type="button" className="btn btn-ghost" onClick={spoken.toggleMute}>
                {spoken.muted ? "Unmute questions" : "Mute questions"}
              </button>
            </div>
          )}
          {spoken.error && (
            <p role="alert" className="mt-2 text-sm">
              {spoken.error}
            </p>
          )}
          {interview.status === "active" ? (
            <div
              className={`card-surface mt-6 flex gap-3 p-3 ${codingLanguage ? "flex-col" : "items-center"}`}
            >
              {codingLanguage && (
                <p className="text-sm font-medium">
                  {setup.role.replace(" Developer", "")} code · AI review (code is not executed)
                </p>
              )}
              {voiceMode && (
                <button
                  type="button"
                  disabled={!speech.supported || busy || interview.status !== "active"}
                  onClick={() => {
                    spoken.stop();
                    if (speech.listening) speech.stop();
                    else speech.start(text);
                  }}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-50 ${speech.listening ? "bg-destructive text-destructive-foreground" : "bg-muted"}`}
                  aria-label={speech.listening ? "Stop microphone" : "Start microphone"}
                  aria-pressed={speech.listening}
                >
                  {speech.listening ? (
                    <MicOff aria-hidden="true" size={20} />
                  ) : (
                    <Mic aria-hidden="true" size={20} />
                  )}
                </button>
              )}
              {codingLanguage ? (
                <>
                  <label className="text-sm font-medium">
                    Language
                    <select
                      aria-label="Coding language"
                      value={codingLanguage}
                      disabled={busy || interview.status !== "active"}
                      onChange={(event) =>
                        setSelectedLanguage(event.target.value as CodingLanguage)
                      }
                      className="ml-3 rounded border border-input bg-background px-3 py-2"
                    >
                      {Object.entries(languageLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy || !text.trim() || interview.status !== "active"}
                    onClick={() => codeRun.mutate(text)}
                  >
                    {codeRun.isPending ? "Running…" : "Run code"}
                  </button>
                  <CodeEditor
                    key={`${interviewId}-${interview.answeredCount}`}
                    language={codingLanguage}
                    path={`interview-${interviewId}-question-${interview.answeredCount}.${codingLanguage === "python" ? "py" : codingLanguage}`}
                    value={text}
                    readOnly={busy || interview.status !== "active"}
                    onChange={(value) => {
                      setText(value);
                      codeRun.reset();
                    }}
                  />
                  {codeRun.data && <CodeExecutionResult result={codeRun.data} />}
                  {codeRun.error && (
                    <p className="text-sm text-destructive" role="alert">
                      Could not run code: {codeRun.error.message}
                    </p>
                  )}
                </>
              ) : (
                <input
                  disabled={busy || interview.status !== "active"}
                  value={text}
                  onChange={(e) => {
                    speech.cancel();
                    setText(e.target.value);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder={
                    speech.listening ? "Listening… or type your answer" : "Type your answer"
                  }
                  aria-label="Your answer"
                  className="flex-1 bg-transparent px-2 text-sm outline-none"
                />
              )}
              <button
                disabled={busy || !text.trim() || interview.status !== "active"}
                onClick={send}
                className="btn btn-primary"
              >
                {answer.isPending ? "Sending…" : "Send"}
              </button>
            </div>
          ) : (
            <div role="status" className="card-surface mt-6 p-4">
              <p className="font-medium">This interview has ended.</p>
              <Link
                className="btn btn-primary mt-3 inline-flex"
                to="/report"
                search={{ interviewId }}
              >
                View results
              </Link>
            </div>
          )}
          {voiceMode && !speech.supported && (
            <p className="mt-2 text-sm text-muted-foreground">
              Voice transcription is unavailable in this browser. You can type your answer instead.
            </p>
          )}
          {voiceMode && speech.listening && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              Listening… Stop the microphone to review your answer, then select Send.
            </p>
          )}
          {speech.error && (
            <p role="alert" className="mt-2 text-sm">
              {speech.error}
            </p>
          )}
        </section>
        <aside className="space-y-4">
          <section className="card-surface space-y-3 p-5" aria-label="Camera controls">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg">Camera</h2>
              <span aria-live="polite" className="text-sm">
                {camera.stream
                  ? "Camera on"
                  : camera.pending
                    ? "Waiting for permission…"
                    : "Camera off"}
              </span>
            </div>
            {camera.stream && (
              <video
                ref={cameraVideo}
                autoPlay
                muted
                playsInline
                aria-label="Your camera preview"
                className="aspect-video w-full rounded-lg bg-muted object-cover"
              />
            )}
            {camera.error && (
              <p role="alert" className="text-sm">
                {camera.error}
              </p>
            )}
            {interview.status === "active" && (
              <button
                type="button"
                className="btn btn-ghost w-full"
                aria-label={
                  camera.stream
                    ? "Stop camera"
                    : camera.pending
                      ? "Cancel camera request"
                      : "Enable camera"
                }
                aria-pressed={!!camera.stream}
                onClick={() => {
                  if (camera.stream || camera.pending) camera.stop();
                  else void camera.start();
                }}
              >
                {camera.stream ? (
                  <CameraOff aria-hidden="true" size={18} />
                ) : (
                  <Camera aria-hidden="true" size={18} />
                )}
                {camera.stream
                  ? "Stop camera"
                  : camera.pending
                    ? "Cancel camera request"
                    : "Enable camera"}
              </button>
            )}
            <p className="text-xs text-muted-foreground">
              Camera is optional. The preview stays on this device; video is not recorded, sent, or
              analyzed.
            </p>
          </section>
          {interview.status === "active" && (
            <section className="card-surface space-y-3 p-5" aria-label="Recording controls">
              <h2 className="text-lg">Save a recording</h2>
              <p className="text-sm text-muted-foreground">
                Optional. With your consent, this device records the selected audio or audio and
                video, then uploads it for private playback. Recordings are deleted after 30 days.
                Your transcript and report remain available if recording or upload fails.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={recordingConsent}
                  disabled={recording || recordingStarting || recordingUpload}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setRecordingConsent(checked);
                    if (!checked) {
                      void Api.setMediaConsent(interviewId, false).catch(() =>
                        setRecordingError(
                          "We could not remove the saved recording. Try again from the report.",
                        ),
                      );
                    }
                  }}
                />
                <span>
                  I consent to storing my recording for up to 30 days for private playback.
                </span>
              </label>
              <label className="block text-sm">
                Recording type
                <select
                  className="input mt-1 w-full"
                  value={recordingMode}
                  disabled={recording || recordingStarting || recordingUpload}
                  onChange={(event) =>
                    setRecordingMode(event.currentTarget.value as "audio" | "video")
                  }
                >
                  <option value="audio">Audio only</option>
                  <option value="video">Audio and video</option>
                </select>
              </label>
              {interview.status === "active" && (
                <button
                  type="button"
                  className="btn btn-ghost w-full"
                  disabled={
                    busy ||
                    recordingStarting ||
                    recordingUpload ||
                    (!recording && !recordingConsent)
                  }
                  onClick={() => (recording ? void stopRecording() : void startRecording())}
                >
                  {recording
                    ? "Stop and save recording"
                    : recordingStarting
                      ? "Preparing recording…"
                      : recordingUpload
                        ? "Saving recording…"
                        : "Start recording"}
                </button>
              )}
              <p className="text-xs" aria-live="polite">
                {recording
                  ? "Recording on this device. Stop to save it securely."
                  : recordingUpload
                    ? "Uploading private recording…"
                    : "Not recording"}
              </p>
              {recordingError && (
                <p role="alert" className="text-sm">
                  {recordingError}
                </p>
              )}
            </section>
          )}
          <div className="card-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow">Interviewer</p>
              <button
                type="button"
                className="btn btn-ghost text-sm"
                aria-pressed={show3D}
                onClick={() => {
                  setRenderFailed(false);
                  setShow3D((visible) => !visible);
                }}
              >
                {show3D ? "Leave 3D interviewer" : "Enable 3D interviewer"}
              </button>
            </div>
            {show3D && !renderFailed ? (
              <>
                <ThreeDFallbackBoundary onFailure={fail3D}>
                  <Suspense
                    fallback={
                      <p className="mt-3 text-sm text-muted-foreground">Loading 3D interviewer…</p>
                    }
                  >
                    <Interviewer3D
                      speaking={spoken.speaking}
                      reducedMotion={reducedMotion}
                      avatarId={avatarId}
                      onFailure={fail3D}
                    />
                  </Suspense>
                </ThreeDFallbackBoundary>
                {reducedMotion && (
                  <p className="text-xs text-muted-foreground">
                    Still avatar shown to respect your reduced-motion setting.
                  </p>
                )}
              </>
            ) : (
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
            )}
            {renderFailed && (
              <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
                3D view is unavailable in this browser. You can continue with the transcript and
                voice controls.
              </p>
            )}
          </div>
          {practice && interview.lastFeedback && (
            <div className="card-surface p-5">
              <p className="eyebrow">Last answer</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {Object.entries(interview.lastFeedback).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-secondary p-2">
                    <p className="text-xs text-muted-foreground">{k}</p>
                    <p className="font-display text-xl">{v ?? "Not scored"}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {practice && interview.lastAnswerFeedback && (
            <div className="card-surface space-y-3 p-5 text-sm">
              <div>
                <p className="mb-1 font-semibold">What went well:</p>
                <MarkdownContent>{interview.lastAnswerFeedback.went_well}</MarkdownContent>
              </div>
              <div>
                <p className="mb-1 font-semibold">What was missing:</p>
                <MarkdownContent>{interview.lastAnswerFeedback.missing}</MarkdownContent>
              </div>
              <div>
                <p className="mb-1 font-semibold">Stronger answer:</p>
                <MarkdownContent>{interview.lastAnswerFeedback.stronger_answer}</MarkdownContent>
              </div>
            </div>
          )}
          {practice && interview.lastCodingJudge && (
            <div className="card-surface p-5 text-sm" role="status">
              <p className="font-semibold">
                Automated correctness checks: {interview.lastCodingJudge.status}
              </p>
              <p className="mt-1">{interview.lastCodingJudge.summary}</p>
              {interview.lastCodingJudge.status === "passed" ||
              interview.lastCodingJudge.status === "failed" ? (
                <p className="mt-1">
                  {interview.lastCodingJudge.passed} of {interview.lastCodingJudge.total} checks
                  passed.
                </p>
              ) : null}
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

function CodeExecutionResult({ result }: { result: CodeRunResult }) {
  const label: Record<CodeRunResult["status"], string> = {
    success: "Run completed",
    "compile-error": "Compilation failed",
    "runtime-error": "Runtime error",
    timeout: "Execution timed out",
    "output-limit": "Output limit reached",
    unavailable: "Runner unavailable",
  };
  return (
    <section
      aria-label="Code run result"
      aria-live="polite"
      className="w-full rounded-lg border bg-muted/40 p-3 text-sm"
    >
      <p className="font-semibold">{label[result.status]}</p>
      {result.stdout && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{result.stdout}</pre>
      )}
      {result.stderr && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-destructive">
          {result.stderr}
        </pre>
      )}
    </section>
  );
}
