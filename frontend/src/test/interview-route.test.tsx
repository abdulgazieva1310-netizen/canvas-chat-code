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
import { Route } from "@/routes/interview";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";
import type { Interview } from "@/lib/api/types";
import type { BrowserSpeechRecognition } from "@/hooks/use-speech-recognition";

// Monaco's browser rendering is covered by the production build; exercise the
// real controlled editor wrapper and interview flow with a lightweight view.
vi.mock("@/components/MonacoEditor.client", () => ({
  default: (props: import("@/components/CodeEditor").CodeEditorProps) => (
    <textarea aria-label="Code answer" data-language={props.language} disabled={props.readOnly}
      value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

it("shows a recovery link when the backend returns no interview", async () => {
  vi.spyOn(Api, "getInterview").mockResolvedValue(null as unknown as Interview);
  const client = openInterview();
  expect(await screen.findByRole("alert")).toHaveTextContent("Interview unavailable.");
  expect(screen.getByRole("link", { name: "New interview" })).toHaveAttribute("href", "/setup");
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
      accuracy: 8, completeness: 7, clarity: 9, structure: 6,
      went_well: "You explained the mechanism clearly.",
      missing: "Discuss memory usage.",
      stronger_answer: "Compare time and memory trade-offs with an example.",
    };
    vi.spyOn(Api, "getInterview").mockResolvedValue({
      id: "session-123", setup: { ...defaultSetup, mode }, status: "active",
      startedAt: new Date().toISOString(), endedAt: null, answeredCount: 1,
      messages: [], lastFeedback: { accuracy: 8, completeness: 7, clarity: 9, structure: 6 },
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
    id: "session-123", setup: defaultSetup, status: "incomplete",
    startedAt: "2026-10-18T12:00:00Z", endedAt: "2026-10-18T12:05:00Z",
    answeredCount: 1, lastFeedback: null,
    messages: [{ id: "question-2", interviewId: "session-123", from: "ai",
      text: "What technical trade-offs would you consider?", createdAt: "2026-10-18T12:04:00Z" }],
  };
}

it.each(["click", "Enter"])("resumes an incomplete interview and sends an answer with %s", async (trigger) => {
  const saved = incompleteSession();
  const active: Interview = { ...saved, status: "active", endedAt: null };
  vi.spyOn(Api, "getInterview").mockResolvedValue(saved);
  let finishResume!: (value: Interview) => void;
  const resume = vi.spyOn(Api, "resumeInterview").mockReturnValue(new Promise((resolve) => { finishResume = resolve; }));
  const updated: Interview = { ...active, answeredCount: 2, messages: [...active.messages,
    { id: "answer-2", interviewId: active.id, from: "you", text: "My resumed answer", createdAt: new Date().toISOString() },
    { id: "question-3", interviewId: active.id, from: "ai", text: "Next question after resuming?", createdAt: new Date().toISOString() },
  ] };
  let finishSend!: (value: Interview) => void;
  const send = vi.spyOn(Api, "sendMessage").mockReturnValue(new Promise((resolve) => { finishSend = resolve; }));
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
  await waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith(saved.id, "My resumed answer"));
  expect(input).toBeDisabled();
  finishSend(updated);
  await screen.findByText("Next question after resuming?");
  expect(input).toHaveValue("");
  expect(input).toBeEnabled();
  expect(client.getQueryData(["interview", saved.id])).toEqual(updated);
  client.clear();
});

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
  constructor() { RoomRecognition.last = this; }
}

it("transcribes a Voice answer into the input and sends it through the existing API", async () => {
  vi.stubGlobal("SpeechRecognition", RoomRecognition);
  const active: Interview = { ...incompleteSession(), status: "active", endedAt: null,
    setup: { ...defaultSetup, input: "Voice" } };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  const send = vi.spyOn(Api, "sendMessage").mockResolvedValue({ ...active, answeredCount: 2 });
  const client = openInterview();
  const input = await screen.findByRole("textbox", { name: "Your answer" });
  const mic = screen.getByRole("button", { name: "Start microphone" });
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.change(input, { target: { value: "My approach:" } });
  fireEvent.click(mic);
  expect(RoomRecognition.last.start).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Stop microphone" })).toHaveAttribute("aria-pressed", "true");
  act(() => RoomRecognition.last.onresult?.({ results: [[{ transcript: "use a hash map" }]] }));
  expect(input).toHaveValue("My approach: use a hash map");
  fireEvent.click(screen.getByRole("button", { name: "Stop microphone" }));
  expect(RoomRecognition.last.stop).toHaveBeenCalledOnce();
  act(() => RoomRecognition.last.onresult?.({ results: [[{ transcript: "use a hash map for lookups." }]] }));
  act(() => RoomRecognition.last.onend?.());
  expect(input).toHaveValue("My approach: use a hash map for lookups.");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith(active.id, "My approach: use a hash map for lookups."));
  await waitFor(() => expect(input).toHaveValue(""));
  client.clear();
});

it("stops listening when the candidate edits the transcript", async () => {
  vi.stubGlobal("SpeechRecognition", RoomRecognition);
  vi.spyOn(Api, "getInterview").mockResolvedValue({ ...incompleteSession(), status: "active", endedAt: null });
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

it.each(["Voice", "Text"] as const)("keeps %s input usable without speech recognition support", async (inputMode) => {
  vi.stubGlobal("SpeechRecognition", undefined);
  vi.stubGlobal("webkitSpeechRecognition", undefined);
  vi.spyOn(Api, "getInterview").mockResolvedValue({ ...incompleteSession(), status: "active", endedAt: null,
    setup: { ...defaultSetup, input: inputMode } });
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
});

it("loads and displays the dynamic AI hint without advancing or clearing a draft", async () => {
  const active: Interview = { ...incompleteSession(), status: "active", endedAt: null };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  let finish!: (value: Interview) => void;
  const getHint = vi.spyOn(Api, "getHint").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const client = openInterview();
  const input = await screen.findByRole("textbox", { name: "Your answer" });
  fireEvent.change(input, { target: { value: "My draft approach" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask for a hint" }));
  await waitFor(() => expect(getHint).toHaveBeenCalledExactlyOnceWith(active.id));
  expect(screen.getByRole("button", { name: "Loading hint…" })).toBeDisabled();
  const hintText = "Use a hash map to store visited values.\nLook up target minus the current number.";
  const updated: Interview = { ...active, messages: [...active.messages, {
    id: "dynamic-hint", interviewId: active.id, from: "hint", text: hintText, createdAt: new Date().toISOString(),
  }] };
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
  ["Java Developer", "java", "class Solution {\n    int[] twoSum(int[] nums, int target) { return new int[]{0, 1}; }\n}\n"],
  ["C++ Developer", "cpp", "vector<int> twoSum(vector<int>& nums, int target) {\n    return {0, 1};\n}\n"],
] as const)("uses the %s editor and submits source code intact", async (role, language, code) => {
  const active: Interview = { ...incompleteSession(), status: "active", endedAt: null,
    setup: { ...defaultSetup, role, type: "Technical", input: "Voice" } };
  vi.spyOn(Api, "getInterview").mockResolvedValue(active);
  let finish!: (value: Interview) => void;
  const send = vi.spyOn(Api, "sendMessage").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const client = openInterview();
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Code answer" })).toHaveAttribute("data-language", language));
  const editor = screen.getByRole("textbox", { name: "Code answer" });
  expect(screen.queryByRole("textbox", { name: "Your answer" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start microphone" })).toBeNull();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  fireEvent.change(editor, { target: { value: code } });
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith(active.id, code));
  expect(editor).toBeDisabled();
  finish({ ...active, answeredCount: 2, messages: [...active.messages,
    { id: "submitted-code", interviewId: active.id, from: "you", text: code, createdAt: new Date().toISOString() }] });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Code answer" })).toHaveValue(""));
  const displayed = document.querySelector("pre");
  expect(displayed?.textContent).toBe(code);
  client.clear();
});

it.each(["Behavioral", "Role-specific"] as const)("keeps text and voice input for Python %s interviews", async (type) => {
  vi.spyOn(Api, "getInterview").mockResolvedValue({ ...incompleteSession(), status: "active", endedAt: null,
    setup: { ...defaultSetup, role: "Python Developer", type } });
  const client = openInterview();
  await screen.findByRole("textbox", { name: "Your answer" });
  expect(screen.queryByRole("textbox", { name: "Code answer" })).toBeNull();
  expect(screen.getByRole("button", { name: "Start microphone" })).toBeInTheDocument();
  client.clear();
});

it("retains the code draft when AI review fails", async () => {
  vi.spyOn(Api, "getInterview").mockResolvedValue({ ...incompleteSession(), status: "active", endedAt: null,
    setup: { ...defaultSetup, role: "Python Developer" } });
  vi.spyOn(Api, "sendMessage").mockRejectedValue(new Error("Review unavailable"));
  const client = openInterview();
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Code answer" })).toHaveAttribute("data-language", "python"));
  const code = "def solve():\n    return 42\n";
  fireEvent.change(screen.getByRole("textbox", { name: "Code answer" }), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "Code answer" })).toHaveValue(code);
  expect(screen.getByRole("textbox", { name: "Code answer" })).toBeEnabled();
  client.clear();
});
