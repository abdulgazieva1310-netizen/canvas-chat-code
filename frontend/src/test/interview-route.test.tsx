import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { Route } from "@/routes/interview";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";
import type { Interview } from "@/lib/api/types";
import type { BrowserSpeechRecognition } from "@/hooks/use-speech-recognition";

// Monaco's browser rendering is covered by the production build; exercise the
// real controlled editor wrapper and interview flow with a lightweight view.
vi.mock("@/components/MonacoEditor.client", () => ({
  default: (props: import("@/components/CodeEditor").CodeEditorProps) => (
    <textarea
      aria-label="Code answer"
      data-language={props.language}
      disabled={props.readOnly}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

vi.mock("@/components/Interviewer3D", () => ({
  Interviewer3D: ({
    speaking,
    reducedMotion,
    avatarId,
    onFailure,
  }: {
    speaking: boolean;
    reducedMotion: boolean;
    avatarId: string;
    onFailure: () => void;
  }) => {
    useEffect(() => {
      if (window.sessionStorage.getItem("mock-3d-fail") === "yes") onFailure();
    }, [onFailure]);
    return (
      <div
        data-testid="interviewer-3d"
        data-speaking={speaking}
        data-reduced-motion={reducedMotion}
        data-avatar={avatarId}
      />
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function openInterview(url = "/interview?interviewId=session-123") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });
  const interview = createRoute({
    getParentRoute: () => root,
    path: "/interview",
    validateSearch: Route.options.validateSearch!,
    component: Route.options.component!,
    beforeLoad: Route.options.beforeLoad!,
  });
  const router = createRouter({
    context: { queryClient: client },
    routeTree: root.addChildren([
      interview,
      createRoute({
        getParentRoute: () => root,
        path: "/setup",
        component: () => <p>Setup page</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}

it("renders loading while interview data is unavailable", async () => {
  vi.spyOn(Api, "getInterview").mockReturnValue(new Promise(() => {}));
  const client = openInterview();
  expect(await screen.findByRole("status")).toHaveTextContent("Loading interview…");
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  client.clear();
});

it("waits for missing setup and renders once complete data is available", async () => {
  vi.spyOn(Api, "getInterview").mockResolvedValue({ id: "session-123" } as Interview);
  const client = openInterview();
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Loading interview setup…"),
  );
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  client.setQueryData(["interview", "session-123"], {
    id: "session-123",
    setup: defaultSetup,
    status: "active",
    startedAt: new Date().toISOString(),
    endedAt: null,
    answeredCount: 0,
    messages: [],
    lastFeedback: null,
  } satisfies Interview);
  expect(await screen.findByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Ask for a hint" })).toBeInTheDocument();
  client.clear();
});

it("shows the persisted effective difficulty and transition reason", async () => {
  vi.spyOn(Api, "getInterview").mockResolvedValue({
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    effectiveLevel: "Senior",
    difficultyDecisions: [
      {
        questionId: "question-2",
        answerId: "answer-1",
        previousLevel: "Middle",
        effectiveLevel: "Senior",
        average: 8.5,
        reason: "Average 8.5 was at least 8; increased from Middle to Senior.",
      },
    ],
  });
  const client = openInterview();
  await screen.findByRole("button", { name: "Send" });
  expect(screen.getByText(/Difficulty/)).toHaveTextContent("Difficulty Senior");
  expect(screen.getByRole("status")).toHaveTextContent("increased from Middle to Senior");
  client.clear();
});

it("labels a persisted follow-up without consuming another main-question slot", async () => {
  const active: Interview = {
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    answeredCount: 1,
    messages: [
      { ...incompleteSession().messages[0], id: "main-question", kind: "main" },
      {
        id: "main-answer",
        interviewId: "session-123",
        from: "you",
        kind: "main",
        text: "My answer",
        createdAt: new Date().toISOString(),
      },
      {
        id: "follow-up-question",
        interviewId: "session-123",
        from: "ai",
        kind: "follow-up",
        mainQuestionId: "main-question",
        text: "Can you clarify one detail?",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const client = openInterview();
  await screen.findByRole("button", { name: "Send" });
  expect(screen.getByText("Follow-up")).toBeVisible();
  expect(screen.getByText("1", { selector: "b" }).parentElement).toHaveTextContent(
    "Question 1 / 10",
  );
  client.clear();
});

it("shows a recovery link when the backend returns no interview", async () => {
  vi.spyOn(Api, "getInterview").mockResolvedValue(null as unknown as Interview);
  const client = openInterview();
  expect(await screen.findByRole("alert")).toHaveTextContent("Interview unavailable.");
  expect(screen.getByRole("link", { name: "New interview" })).toHaveAttribute("href", "/setup");
  client.clear();
});

it("can retry loading after a recoverable fetch error", async () => {
  const active: Interview = { ...incompleteSession(), status: "active", endedAt: null };
  const getInterview = vi
    .spyOn(Api, "getInterview")
    .mockRejectedValueOnce(new Error("Network unavailable."))
    .mockResolvedValueOnce(active);
  const client = openInterview();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  await screen.findByText(active.messages[0]!.text);
  expect(getInterview).toHaveBeenCalledTimes(2);
  expect(await screen.findByRole("button", { name: "Send" })).toBeDisabled();
  client.clear();
});

it("shows persisted elapsed time and removes answer controls for completed sessions", async () => {
  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - 123_000).toISOString();
  vi.spyOn(Api, "getInterview").mockResolvedValue({
    ...incompleteSession(),
    status: "complete",
    startedAt,
    endedAt: endedAt.toISOString(),
    answeredCount: 10,
    setup: { ...defaultSetup, questionCount: 10 },
  });
  const client = openInterview();
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("This interview has ended."),
  );
  expect(screen.getByText("02:03")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Your answer" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  expect(screen.getByRole("link", { name: "View results" })).toHaveAttribute(
    "href",
    "/report?interviewId=session-123",
  );
  client.clear();
});

it.each(["/interview", "/interview?interviewId=", "/interview?interviewId=%20%20"])(
  "redirects %s to setup without fetching",
  async (url) => {
    const getInterview = vi.spyOn(Api, "getInterview");
    const startInterview = vi.spyOn(Api, "startInterview");
    const client = openInterview(url);
    await screen.findByText("Setup page");
    expect(getInterview).not.toHaveBeenCalled();
    expect(startInterview).not.toHaveBeenCalled();
    client.clear();
  },
);

it.each(["Practice", "Real Interview"] as const)(
  "shows written evaluation during %s only when permitted",
  async (mode) => {
    const feedback = {
      accuracy: 8,
      completeness: 7,
      clarity: 9,
      structure: 6,
      went_well: "You explained the mechanism clearly.",
      missing: "Discuss memory usage.",
      stronger_answer: "Compare time and memory trade-offs with an example.",
    };
    vi.spyOn(Api, "getInterview").mockResolvedValue({
      id: "session-123",
      setup: { ...defaultSetup, mode },
      status: "active",
      startedAt: new Date().toISOString(),
      endedAt: null,
      answeredCount: 1,
      messages: [],
      lastFeedback: { accuracy: 8, completeness: 7, clarity: 9, structure: 6 },
      lastAnswerFeedback: feedback,
    });
    const client = openInterview();
    await screen.findByRole("button", { name: "Send" });
    if (mode === "Practice") {
      expect(screen.getByText(/You explained the mechanism clearly/)).toBeInTheDocument();
      expect(screen.getByText(/Discuss memory usage/)).toBeInTheDocument();
      expect(screen.getByText(/Compare time and memory/)).toBeInTheDocument();
    } else {
      expect(screen.queryByText(/You explained the mechanism clearly/)).toBeNull();
      expect(screen.queryByText(/Discuss memory usage/)).toBeNull();
      expect(screen.queryByText(/Compare time and memory/)).toBeNull();
    }
    client.clear();
  },
);

function incompleteSession(): Interview {
  return {
    id: "session-123",
    setup: defaultSetup,
    status: "incomplete",
    startedAt: "2026-10-18T12:00:00Z",
    endedAt: "2026-10-18T12:05:00Z",
    answeredCount: 1,
    lastFeedback: null,
    messages: [
      {
        id: "question-2",
        interviewId: "session-123",
        from: "ai",
        text: "What technical trade-offs would you consider?",
        createdAt: "2026-10-18T12:04:00Z",
      },
    ],
  };
}

it.each(["click", "Enter"])(
  "resumes an incomplete interview and sends an answer with %s",
  async (trigger) => {
    const saved = incompleteSession();
    const active: Interview = { ...saved, status: "active", endedAt: null };
    vi.spyOn(Api, "getInterview").mockResolvedValue(saved);
    let finishResume!: (value: Interview) => void;
    const resume = vi.spyOn(Api, "resumeInterview").mockReturnValue(
      new Promise((resolve) => {
        finishResume = resolve;
      }),
    );
    const updated: Interview = {
      ...active,
      answeredCount: 2,
      messages: [
        ...active.messages,
        {
          id: "answer-2",
          interviewId: active.id,
          from: "you",
          text: "My resumed answer",
          createdAt: new Date().toISOString(),
        },
        {
          id: "question-3",
          interviewId: active.id,
          from: "ai",
          text: "Next question after resuming?",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    let finishSend!: (value: Interview) => void;
    const send = vi.spyOn(Api, "sendMessage").mockReturnValue(
      new Promise((resolve) => {
        finishSend = resolve;
      }),
    );
    const client = openInterview();
    await waitFor(() => expect(resume).toHaveBeenCalledExactlyOnceWith(saved.id));
    expect(screen.queryByPlaceholderText("Type your answer")).toBeNull();
    finishResume(active);
    const input = await screen.findByPlaceholderText("Type your answer");
    expect(input).toBeEnabled();
    expect(screen.getByText(saved.messages[0]!.text)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Send" });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "My resumed answer" } });
    expect(input).toHaveValue("My resumed answer");
    expect(button).toBeEnabled();
    if (trigger === "click") fireEvent.click(button);
    else fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(send).toHaveBeenCalledExactlyOnceWith(
        saved.id,
        "My resumed answer",
        undefined,
        "question-2",
      ),
    );
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sending…" }));
    expect(send).toHaveBeenCalledOnce();
    finishSend(updated);
    await screen.findByText("Next question after resuming?");
    expect(input).toHaveValue("");
    expect(input).toBeEnabled();
    expect(client.getQueryData(["interview", saved.id])).toEqual(updated);
    client.clear();
  },
);

it("shows an actionable error when an incomplete interview cannot be resumed", async () => {
  vi.spyOn(Api, "getInterview").mockResolvedValue(incompleteSession());
  vi.spyOn(Api, "resumeInterview").mockRejectedValue(new Error("Unable to resume interview."));
  const send = vi.spyOn(Api, "sendMessage");
  const client = openInterview();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to resume interview.");
  expect(screen.getByRole("link", { name: "New interview" })).toHaveAttribute("href", "/setup");
  expect(send).not.toHaveBeenCalled();
  client.clear();
});

it("preserves typed text and re-enables input after a failed send", async () => {
  const saved = incompleteSession();
  vi.spyOn(Api, "getInterview").mockResolvedValue(saved);
  vi.spyOn(Api, "resumeInterview").mockResolvedValue({ ...saved, status: "active", endedAt: null });
  vi.spyOn(Api, "sendMessage").mockRejectedValue(new Error("Could not send answer."));
  const client = openInterview();
  const input = await screen.findByPlaceholderText("Type your answer");
  fireEvent.change(input, { target: { value: "Keep my answer" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("alert");
  expect(input).toHaveValue("Keep my answer");
  expect(input).toBeEnabled();
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  client.clear();
});

class RoomRecognition implements BrowserSpeechRecognition {
  static last: RoomRecognition;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: BrowserSpeechRecognition["onresult"] = null;
  onerror: BrowserSpeechRecognition["onerror"] = null;
  onend: BrowserSpeechRecognition["onend"] = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    RoomRecognition.last = this;
  }
}

it("transcribes a Voice answer into the input and sends it through the existing API", async () => {
  vi.stubGlobal("SpeechRecognition", RoomRecognition);
  const active: Interview = {
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    setup: { ...defaultSetup, input: "Voice" },
  };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const send = vi.spyOn(Api, "sendMessage").mockResolvedValue({ ...active, answeredCount: 2 });
  const client = openInterview();
  const input = await screen.findByRole("textbox", { name: "Your answer" });
  const mic = screen.getByRole("button", { name: "Start microphone" });
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.change(input, { target: { value: "My approach:" } });
  fireEvent.click(mic);
  expect(RoomRecognition.last.start).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Stop microphone" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  act(() => RoomRecognition.last.onresult?.({ results: [[{ transcript: "use a hash map" }]] }));
  expect(input).toHaveValue("My approach: use a hash map");
  fireEvent.click(screen.getByRole("button", { name: "Stop microphone" }));
  expect(RoomRecognition.last.stop).toHaveBeenCalledOnce();
  act(() =>
    RoomRecognition.last.onresult?.({ results: [[{ transcript: "use a hash map for lookups." }]] }),
  );
  act(() => RoomRecognition.last.onend?.());
  expect(input).toHaveValue("My approach: use a hash map for lookups.");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledExactlyOnceWith(
      active.id,
      "My approach: use a hash map for lookups.",
      undefined,
      "question-2",
    ),
  );
  await waitFor(() => expect(input).toHaveValue(""));
  client.clear();
});

it("plays each voice question once and provides replay, mute, and stop controls", async () => {
  class Utterance {
    lang = "";
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  const speak = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    speak,
    cancel,
    speaking: false,
    pending: false,
    paused: false,
  });
  const active = { ...incompleteSession(), status: "active" as const, endedAt: null };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const client = openInterview();
  await screen.findByRole("button", { name: "Replay question" });
  await waitFor(() => expect(speak).toHaveBeenCalledOnce());
  expect(speak.mock.calls[0][0].text).toBe("What technical trade-offs would you consider?");
  fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
    target: { value: "draft" },
  });
  expect(speak).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Replay question" }));
  expect(cancel).toHaveBeenCalled();
  expect(speak).toHaveBeenCalledTimes(2);
  const next = {
    ...active,
    answeredCount: 2,
    messages: [
      ...active.messages,
      {
        id: "question-next",
        interviewId: active.id,
        from: "ai" as const,
        text: "Next?",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  act(() => client.setQueryData(["interview", active.id], next));
  await screen.findByText("Next?");
  await waitFor(() => expect(speak).toHaveBeenCalledTimes(3));
  fireEvent.click(screen.getByRole("button", { name: "Mute questions" }));
  const mutedUpdate = {
    ...next,
    answeredCount: 3,
    messages: [
      ...next.messages,
      {
        id: "question-next",
        interviewId: active.id,
        from: "ai" as const,
        text: "Another next?",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  act(() => client.setQueryData(["interview", active.id], mutedUpdate));
  await screen.findByText("Another next?");
  expect(speak).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("button", { name: "Unmute questions" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Stop playback" }));
  expect(cancel).toHaveBeenCalled();
  const cancellationsBeforeUnmount = cancel.mock.calls.length;
  cleanup();
  expect(cancel.mock.calls.length).toBeGreaterThan(cancellationsBeforeUnmount);
  client.clear();
});

it("keeps interview progress and syncs the opt-in 3D view to question playback", async () => {
  class Utterance {
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  const speak = vi.fn();
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
  window.localStorage.setItem("interview-mirror-avatar", "sage");
  const active = { ...incompleteSession(), status: "active" as const, endedAt: null };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const client = openInterview();
  await screen.findByRole("button", { name: "Replay question" });
  const answer = screen.getByRole("textbox", { name: "Your answer" });
  fireEvent.change(answer, { target: { value: "Draft answer" } });
  fireEvent.click(screen.getByRole("button", { name: "Enable 3D interviewer" }));
  const avatar = await screen.findByTestId("interviewer-3d");
  expect(avatar).toHaveAttribute("data-speaking", "false");
  expect(avatar).toHaveAttribute("data-avatar", "sage");
  act(() => speak.mock.calls[0][0].onstart());
  expect(avatar).toHaveAttribute("data-speaking", "true");
  fireEvent.click(screen.getByRole("button", { name: "Stop playback" }));
  await waitFor(() => expect(avatar).toHaveAttribute("data-speaking", "false"));
  fireEvent.click(screen.getByRole("button", { name: "Leave 3D interviewer" }));
  expect(screen.queryByTestId("interviewer-3d")).toBeNull();
  expect(answer).toHaveValue("Draft answer");
  expect(client.getQueryData(["interview", active.id])).toEqual(active);
  client.clear();
});

it("falls back to the existing interview when the 3D renderer fails", async () => {
  window.sessionStorage.setItem("mock-3d-fail", "yes");
  const active = { ...incompleteSession(), status: "active" as const, endedAt: null };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const client = openInterview();
  await screen.findByRole("button", { name: "Replay question" });
  fireEvent.click(screen.getByRole("button", { name: "Enable 3D interviewer" }));
  expect(await screen.findByText(/3D view is unavailable in this browser/)).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Your answer" })).toBeVisible();
  expect(client.getQueryData(["interview", active.id])).toEqual(active);
  client.clear();
  window.sessionStorage.removeItem("mock-3d-fail");
});

it("passes the reduced-motion preference to the static 3D presentation", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList);
  vi.spyOn(Api, "getInterview").mockResolvedValue({
    ...incompleteSession(),
    status: "active",
    endedAt: null,
  });
  const client = openInterview();
  await screen.findByRole("button", { name: "Replay question" });
  fireEvent.click(screen.getByRole("button", { name: "Enable 3D interviewer" }));
  expect(await screen.findByTestId("interviewer-3d")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  expect(
    screen.getByText(/Still avatar shown to respect your reduced-motion setting/),
  ).toBeVisible();
  client.clear();
});

it("cancels question playback before microphone recognition and reports unavailable playback", async () => {
  class Utterance {
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  const speak = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    speak,
    cancel,
    speaking: false,
    pending: false,
    paused: false,
  });
  vi.stubGlobal("SpeechRecognition", RoomRecognition);
  const active = { ...incompleteSession(), status: "active" as const, endedAt: null };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const client = openInterview();
  await screen.findByRole("button", { name: "Replay question" });
  await waitFor(() => expect(speak).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Start microphone" }));
  expect(cancel).toHaveBeenCalled();
  expect(RoomRecognition.last.start).toHaveBeenCalledOnce();
  client.clear();

  cleanup();
  vi.stubGlobal("SpeechSynthesisUtterance", undefined);
  vi.stubGlobal("speechSynthesis", undefined);
  const fallbackClient = openInterview();
  await screen.findByRole("button", { name: "Replay question" });
  fireEvent.click(screen.getByRole("button", { name: "Replay question" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Spoken questions are unavailable");
  expect(screen.getByText("What technical trade-offs would you consider?")).toBeVisible();
  fallbackClient.clear();
});

it("stops listening when the candidate edits the transcript", async () => {
  vi.stubGlobal("SpeechRecognition", RoomRecognition);
  vi.spyOn(Api, "getInterview").mockResolvedValue({
    ...incompleteSession(),
    status: "active",
    endedAt: null,
  });
  const client = openInterview();
  const input = await screen.findByRole("textbox", { name: "Your answer" });
  fireEvent.click(screen.getByRole("button", { name: "Start microphone" }));
  const lateResult = RoomRecognition.last.onresult!;
  act(() => lateResult({ results: [[{ transcript: "spoken draft" }]] }));
  fireEvent.change(input, { target: { value: "Edited draft" } });
  expect(RoomRecognition.last.abort).toHaveBeenCalledOnce();
  act(() => lateResult({ results: [[{ transcript: "late speech" }]] }));
  expect(input).toHaveValue("Edited draft");
  client.clear();
});

it("shows an actionable permission denial and sends only reviewed text", async () => {
  vi.stubGlobal("SpeechRecognition", RoomRecognition);
  const active: Interview = {
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    setup: { ...defaultSetup, input: "Voice" },
  };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const send = vi.spyOn(Api, "sendMessage").mockResolvedValue(active);
  const client = openInterview();
  const input = await screen.findByRole("textbox", { name: "Your answer" });
  fireEvent.click(screen.getByRole("button", { name: "Start microphone" }));
  act(() => RoomRecognition.last.onerror?.({ error: "not-allowed" }));
  expect(await screen.findByText(/Microphone permission was denied/)).toBeInTheDocument();
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: "Reviewed typed fallback" } });
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledExactlyOnceWith(
      active.id,
      "Reviewed typed fallback",
      undefined,
      "question-2",
    ),
  );
  client.clear();
});

it("starts camera preview only after opt-in and releases its track when the interview ends", async () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const active: Interview = { ...incompleteSession(), status: "active", endedAt: null };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  vi.spyOn(Api, "endInterview").mockReturnValue(new Promise(() => {}));
  const client = openInterview();
  expect(await screen.findByText("Camera off")).toBeVisible();
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enable camera" }));
  expect(await screen.findByText("Camera on")).toBeVisible();
  expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: true });
  expect(screen.getByLabelText("Your camera preview")).toHaveAttribute("autoplay");
  fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  expect(track.stop).toHaveBeenCalledOnce();
  client.clear();
});

it("releases camera tracks when leaving the interview route", async () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  vi.spyOn(Api, "getInterview").mockResolvedValue({
    ...incompleteSession(),
    status: "active",
    endedAt: null,
  });
  const client = openInterview();
  fireEvent.click(await screen.findByRole("button", { name: "Enable camera" }));
  expect(await screen.findByText("Camera on")).toBeVisible();
  cleanup();
  expect(track.stop).toHaveBeenCalledOnce();
  client.clear();
});

it("keeps text interviewing available after camera permission is denied", async () => {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
    },
  });
  const active: Interview = {
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    setup: { ...defaultSetup, input: "Text" },
  };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const send = vi.spyOn(Api, "sendMessage").mockResolvedValue(active);
  const client = openInterview();
  fireEvent.click(await screen.findByRole("button", { name: "Enable camera" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Camera permission was denied");
  const input = screen.getByRole("textbox", { name: "Your answer" });
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: "Typed fallback" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  client.clear();
});

it.each(["Voice", "Text"] as const)(
  "keeps %s input usable without speech recognition support",
  async (inputMode) => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    vi.spyOn(Api, "getInterview").mockResolvedValue({
      ...incompleteSession(),
      status: "active",
      endedAt: null,
      setup: { ...defaultSetup, input: inputMode },
    });
    const client = openInterview();
    const input = await screen.findByRole("textbox", { name: "Your answer" });
    if (inputMode === "Voice") {
      expect(screen.getByRole("button", { name: "Start microphone" })).toBeDisabled();
      expect(screen.getByText(/Voice transcription is unavailable/)).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("button", { name: "Start microphone" })).toBeNull();
    }
    fireEvent.change(input, { target: { value: "Typed answer" } });
    expect(input).toHaveValue("Typed answer");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    client.clear();
  },
);

it("loads and displays the dynamic AI hint without advancing or clearing a draft", async () => {
  const active: Interview = { ...incompleteSession(), status: "active", endedAt: null };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  let finish!: (value: Interview) => void;
  const getHint = vi.spyOn(Api, "getHint").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const client = openInterview();
  const input = await screen.findByRole("textbox", { name: "Your answer" });
  fireEvent.change(input, { target: { value: "My draft approach" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask for a hint" }));
  await waitFor(() => expect(getHint).toHaveBeenCalledExactlyOnceWith(active.id));
  expect(screen.getByRole("button", { name: "Loading hint…" })).toBeDisabled();
  const hintText =
    "Use a hash map to store visited values.\nLook up target minus the current number.";
  const updated: Interview = {
    ...active,
    messages: [
      ...active.messages,
      {
        id: "dynamic-hint",
        interviewId: active.id,
        from: "hint",
        text: hintText,
        createdAt: new Date().toISOString(),
      },
    ],
  };
  finish(updated);
  const hint = await screen.findByRole("note", { name: "Interview hint" });
  expect(hint).toHaveTextContent("Use a hash map to store visited values.");
  expect(hint).toHaveTextContent("Look up target minus the current number.");
  expect(hint).not.toHaveTextContent("Use a concrete example");
  expect(input).toHaveValue("My draft approach");
  expect(screen.getByRole("button", { name: "Ask for a hint" })).toBeEnabled();
  expect(client.getQueryData(["interview", active.id])).toEqual(updated);
  client.clear();
});

it.each([
  ["Python Developer", "python", "\ndef two_sum(nums, target):\n    return [0, 1]\n"],
  [
    "Java Developer",
    "java",
    "class Solution {\n    int[] twoSum(int[] nums, int target) { return new int[]{0, 1}; }\n}\n",
  ],
  ["Backend Developer", "python", "def solution():\n    return []\n"],
  ["Full Stack Developer", "javascript", "function solution() { return []; }"],
  [
    "C++ Developer",
    "cpp",
    "vector<int> twoSum(vector<int>& nums, int target) {\n    return {0, 1};\n}\n",
  ],
] as const)("uses the %s editor and submits source code intact", async (role, language, code) => {
  const active: Interview = {
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    setup: { ...defaultSetup, role, type: "Technical", input: "Voice" },
  };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  let finish!: (value: Interview) => void;
  const send = vi.spyOn(Api, "sendMessage").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const client = openInterview();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Code answer" })).toHaveAttribute(
      "data-language",
      language,
    ),
  );
  const editor = screen.getByRole("textbox", { name: "Code answer" });
  expect(screen.queryByRole("textbox", { name: "Your answer" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start microphone" })).toBeNull();
  const template = (editor as HTMLTextAreaElement).value;
  expect(template).toContain("Write your code here");
  expect(template).toContain(
    language === "python"
      ? "def solution():"
      : language === "javascript"
        ? "function solution()"
        : "class Solution",
  );
  expect(template).not.toMatch(/two_?sum/i);
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  fireEvent.change(editor, { target: { value: "" } });
  expect(editor).toHaveValue("");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  fireEvent.change(editor, { target: { value: code } });
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledExactlyOnceWith(
      active.id,
      code,
      { python: "Python", java: "Java", cpp: "C++", javascript: "JavaScript" }[language],
      "question-2",
    ),
  );
  expect(editor).toBeDisabled();
  finish({
    ...active,
    answeredCount: 2,
    messages: [
      ...active.messages,
      {
        id: "submitted-code",
        interviewId: active.id,
        from: "you",
        text: code,
        createdAt: new Date().toISOString(),
      },
      {
        id: "question-3",
        interviewId: active.id,
        from: "ai",
        text: "Implement mergeIntervals to merge overlapping intervals.",
        createdAt: new Date().toISOString(),
      },
    ],
  });
  await screen.findByText(/Implement mergeIntervals/);
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Code answer" })).toHaveValue(template),
  );
  const displayed = document.querySelector("pre");
  expect(displayed?.textContent).toBe(code);
  client.clear();
});

it.each(
  (
    [
      "Java Developer",
      "Python Developer",
      "C++ Developer",
      "Backend Developer",
      "Full Stack Developer",
    ] as const
  ).flatMap((role) =>
    (["Behavioral", "Role-specific"] as const).map((type) => [role, type] as const),
  ),
)("keeps text and voice input for %s %s interviews", async (role, type) => {
  vi.spyOn(Api, "getInterview").mockResolvedValue({
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    setup: { ...defaultSetup, role, type },
  });
  const client = openInterview();
  await screen.findByRole("textbox", { name: "Your answer" });
  expect(screen.queryByRole("textbox", { name: "Code answer" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Coding language" })).toBeNull();
  expect(screen.getByRole("button", { name: "Start microphone" })).toBeInTheDocument();
  client.clear();
});

it("retains the code draft when AI review fails", async () => {
  vi.spyOn(Api, "getInterview").mockResolvedValue({
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    setup: { ...defaultSetup, role: "Python Developer" },
  });
  vi.spyOn(Api, "sendMessage").mockRejectedValue(new Error("Review unavailable"));
  const client = openInterview();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Code answer" })).toHaveAttribute(
      "data-language",
      "python",
    ),
  );
  const code = "def solve():\n    return 42\n";
  fireEvent.change(screen.getByRole("textbox", { name: "Code answer" }), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "Code answer" })).toHaveValue(code);
  expect(screen.getByRole("textbox", { name: "Code answer" })).toBeEnabled();
  client.clear();
});

it("runs the current coding draft and shows bounded execution feedback", async () => {
  const active: Interview = {
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    setup: { ...defaultSetup, role: "Python Developer" },
  };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const run = vi.spyOn(Api, "runCode").mockResolvedValue({
    status: "success",
    stdout: "42\n",
    stderr: "",
  });
  const send = vi.spyOn(Api, "sendMessage");
  const client = openInterview();
  await screen.findByRole("textbox", { name: "Code answer" });
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Code answer" })).toHaveAttribute(
      "data-language",
      "python",
    ),
  );
  const editor = screen.getByRole("textbox", { name: "Code answer" });
  fireEvent.change(editor, { target: { value: "def solve(): return 42" } });
  fireEvent.click(screen.getByRole("button", { name: "Run code" }));
  expect(await screen.findByLabelText("Code run result")).toHaveTextContent("Run completed");
  expect(screen.getByLabelText("Code run result")).toHaveTextContent("42");
  expect(run).toHaveBeenCalledExactlyOnceWith(active.id, {
    language: "Python",
    code: "def solve(): return 42",
  });
  expect(send).not.toHaveBeenCalled();
  expect(editor).toHaveValue("def solve(): return 42");
  client.clear();
});

it.each([
  ["compile-error", "Compilation failed"],
  ["runtime-error", "Runtime error"],
  ["timeout", "Execution timed out"],
  ["output-limit", "Output limit reached"],
  ["unavailable", "Runner unavailable"],
] as const)("explains a code-run %s result", async (status, message) => {
  vi.spyOn(Api, "getInterview").mockResolvedValue({
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    setup: { ...defaultSetup, role: "Python Developer" },
  });
  vi.spyOn(Api, "runCode").mockResolvedValue({
    status,
    stdout: "",
    stderr: "Details",
  });
  const client = openInterview();
  await screen.findByRole("button", { name: "Run code" });
  fireEvent.click(screen.getByRole("button", { name: "Run code" }));
  expect(await screen.findByLabelText("Code run result")).toHaveTextContent(message);
  expect(screen.getByLabelText("Code run result")).toHaveTextContent("Details");
  client.clear();
});

it("renders AI problem statements, hints, and feedback as Markdown while keeping submitted code literal", async () => {
  const code = 'def solve():\n    return "**literal**"\n';
  const active: Interview = {
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    setup: { ...defaultSetup, role: "Python Developer" },
    messages: [
      {
        id: "md-question",
        interviewId: "session-123",
        from: "ai",
        text: "# Two Sum\n\n**Problem:** Return matching indices.\n\n## Input\n\n```python\nnums = [2, 7]\ntarget = 9\n```\n\n- Use distinct indices",
        createdAt: new Date().toISOString(),
      },
      {
        id: "md-hint",
        interviewId: "session-123",
        from: "hint",
        text: "Use a **hash map** to look up `target - value`.",
        createdAt: new Date().toISOString(),
      },
      {
        id: "literal-code",
        interviewId: "session-123",
        from: "you",
        text: code,
        createdAt: new Date().toISOString(),
      },
    ],
    lastAnswerFeedback: {
      accuracy: 6,
      completeness: 7,
      clarity: 8,
      structure: 9,
      went_well: "**Clear naming** makes this readable.",
      missing: "- Handle duplicate values",
      stronger_answer: "```python\ndef improved():\n    return []\n```",
    },
  };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const client = openInterview();
  await screen.findByRole("heading", { name: "Two Sum" });
  expect(screen.getByRole("heading", { name: "Input" })).toBeInTheDocument();
  expect(screen.getByText("Problem:").tagName).toBe("STRONG");
  expect(screen.getByText("hash map").tagName).toBe("STRONG");
  expect(screen.getByText("target - value").tagName).toBe("CODE");
  expect(screen.getByText("Clear naming").tagName).toBe("STRONG");
  expect(
    [...document.querySelectorAll("pre code")].some(
      (item) => item.textContent === "def improved():\n    return []\n",
    ),
  ).toBe(true);
  expect([...document.querySelectorAll("pre")].some((item) => item.textContent === code)).toBe(
    true,
  );
  client.clear();
});

it("switches Monaco language immediately and submits the selected language", async () => {
  const active: Interview = {
    ...incompleteSession(),
    status: "active",
    endedAt: null,
    setup: { ...defaultSetup, role: "Backend Developer", type: "Technical" },
  };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const send = vi.spyOn(Api, "sendMessage").mockReturnValue(new Promise(() => {}));
  const client = openInterview();
  const select = await screen.findByRole("combobox", { name: "Coding language" });
  expect(select).toHaveValue("python");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Python",
    "Java",
    "C++",
    "JavaScript",
    "TypeScript",
  ]);
  for (const language of ["java", "cpp", "javascript", "typescript"]) {
    fireEvent.change(select, { target: { value: language } });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Code answer" })).toHaveAttribute(
        "data-language",
        language,
      ),
    );
  }
  const code = "function solution(): number { return 1; }";
  fireEvent.change(screen.getByRole("textbox", { name: "Code answer" }), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledExactlyOnceWith(active.id, code, "TypeScript", "question-2"),
  );
  client.clear();
});
