import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
