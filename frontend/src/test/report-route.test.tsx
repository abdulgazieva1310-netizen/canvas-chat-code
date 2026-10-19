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
import { Route } from "@/routes/report";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";
import type { InterviewReport } from "@/lib/api/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openReport(url: string) {
  if (!vi.isMockFunction(Api.listInterviewMedia)) {
    vi.spyOn(Api, "listInterviewMedia").mockResolvedValue({ retentionDays: 30, media: [] });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Dashboard</p>,
  });
  const report = createRoute({
    getParentRoute: () => root,
    path: "/report",
    validateSearch: Route.options.validateSearch!,
    beforeLoad: Route.options.beforeLoad!,
    component: Route.options.component!,
  });
  const router = createRouter({
    context: { queryClient: client },
    routeTree: root.addChildren([dashboard, report]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

it("plays and deletes only the owner's saved recording without replacing the report", async () => {
  const data: InterviewReport = {
    interview: {
      id: "session-media",
      setup: { ...defaultSetup },
      status: "complete",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      answeredCount: 0,
      lastFeedback: null,
      messages: [],
    },
    feedback: {
      interviewId: "session-media",
      answeredQuestions: 0,
      selectedQuestions: 5,
      overall: null,
      scores: null,
      strengths: [],
      gaps: [],
      questions: [],
    },
  };
  vi.spyOn(Api, "getReport").mockResolvedValue(data);
  const media = vi.spyOn(Api, "listInterviewMedia").mockResolvedValue({
    retentionDays: 30,
    media: [
      {
        id: "media-1",
        mediaType: "audio/webm",
        sizeBytes: 123,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ],
  });
  vi.spyOn(Api, "downloadInterviewMedia").mockResolvedValue(
    new Blob(["audio"], { type: "audio/webm" }),
  );
  const deleteMedia = vi.spyOn(Api, "deleteInterviewMedia").mockResolvedValue(undefined);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recording");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  media
    .mockResolvedValueOnce({
      retentionDays: 30,
      media: [
        {
          id: "media-1",
          mediaType: "audio/webm",
          sizeBytes: 123,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
    })
    .mockResolvedValueOnce({ retentionDays: 30, media: [] });
  const { client } = openReport("/report?interviewId=session-media");
  fireEvent.click(await screen.findByRole("button", { name: "Play recording" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Saved recordings").querySelector("audio")).toHaveAttribute(
      "src",
      "blob:recording",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete recording" }));
  await waitFor(() => expect(deleteMedia).toHaveBeenCalledWith("session-media", "media-1"));
  await waitFor(() => expect(screen.getByText(/No saved recordings/)).toBeInTheDocument());
  expect(screen.getByRole("heading", { name: /Frontend Developer/ })).toBeInTheDocument();
  client.clear();
});

it.each([
  "/report",
  "/report?interviewId=",
  "/report?interviewId=%20%20",
  "/report?interviewId=123",
])("redirects invalid report URL %s without fetching", async (url) => {
  const report = vi.spyOn(Api, "getReport");
  const { router, client } = openReport(url);
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(report).not.toHaveBeenCalled();
  client.clear();
});

it("fetches the report for the URL's interview ID", async () => {
  const report = vi.spyOn(Api, "getReport").mockRejectedValue(new Error("Report unavailable"));
  const { client } = openReport("/report?interviewId=session-123");
  await waitFor(() => expect(report).toHaveBeenCalledWith("session-123"));
  client.clear();
});

it("renders Markdown questions and coaching in the final report", async () => {
  const data: InterviewReport = {
    interview: {
      id: "session-123",
      setup: { ...defaultSetup, role: "Python Developer" },
      status: "complete",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      answeredCount: 1,
      lastFeedback: null,
      messages: [
        {
          id: "question-1",
          interviewId: "session-123",
          from: "ai",
          text: "## Two Sum\n\nReturn **indices**. <script>alert(1)</script><img src=x onerror=alert(2)>",
          createdAt: "2026-10-01T00:00:00Z",
        },
        {
          id: "answer-1",
          interviewId: "session-123",
          from: "you",
          text: "code\n  indented",
          createdAt: "2026-10-01T00:01:00Z",
        },
      ],
    },
    feedback: {
      interviewId: "session-123",
      answeredQuestions: 1,
      selectedQuestions: 5,
      overall: 7,
      scores: { accuracy: 7, completeness: null, clarity: 8, structure: null },
      strengths: ["**Readable code**"],
      gaps: ["Handle `null`"],
      questions: [
        {
          questionId: "question-1",
          answerId: "answer-1",
          q: "## Two Sum\n\nReturn **indices**.",
          answer: "code\n  indented",
          score: 7,
          scores: { accuracy: 7, completeness: 6, clarity: 8, structure: null },
          good: "Uses a **hash map**.",
          miss: "- Consider duplicates",
          better: "```python\ndef solve():\n    return []\n```",
          practiceTopics: ["Duplicate handling"],
        },
      ],
    },
  };
  vi.spyOn(Api, "getReport").mockResolvedValue(data);
  const { client } = openReport("/report?interviewId=session-123");
  await screen.findByRole("heading", { name: "Two Sum" });
  expect(screen.getByRole("link", { name: "Practice: Duplicate handling" })).toBeVisible();
  expect(screen.getByText("Readable code").tagName).toBe("STRONG");
  expect(screen.getByText("hash map").tagName).toBe("STRONG");
  expect(document.querySelector("pre code.language-python")?.textContent).toBe(
    "def solve():\n    return []\n",
  );
  expect(
    screen.getByText(
      "Rationale: the notes below explain what the answer covered and what it missed.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("link", { name: "View this answer in transcript" }));
  expect(document.querySelector("#transcript-answer-1 pre")?.textContent).toBe("code\n  indented");
  expect(document.getElementById("transcript-answer-1")).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  expect(document.getElementById("transcript-question-1")).toBeInTheDocument();
  expect(document.querySelector("script, img")).toBeNull();
  expect(
    screen.getByText("Approximate coaching feedback, not a measure of hiring readiness."),
  ).toBeVisible();
  expect(screen.getAllByText("Not scored").length).toBeGreaterThan(0);
  expect(
    screen.getByText(
      "Static AI code review: submissions are reviewed without compiling or executing them.",
    ),
  ).toBeVisible();
  client.clear();
});

it("offers no targeted recommendation without scored evidence and leaves retry/setup available", async () => {
  const data: InterviewReport = {
    interview: {
      id: "unscored",
      setup: defaultSetup,
      status: "incomplete",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      answeredCount: 1,
      lastFeedback: null,
      messages: [
        {
          id: "question-unscored",
          interviewId: "unscored",
          from: "ai",
          text: "Question?",
          createdAt: "2026-10-01T00:00:00Z",
        },
        {
          id: "answer-unscored",
          interviewId: "unscored",
          from: "you",
          text: "An answer",
          createdAt: "2026-10-01T00:01:00Z",
        },
      ],
    },
    feedback: {
      interviewId: "unscored",
      answeredQuestions: 1,
      selectedQuestions: 5,
      overall: null,
      scores: null,
      strengths: [],
      gaps: [],
      questions: [
        {
          questionId: "question-unscored",
          answerId: "answer-unscored",
          q: "Question?",
          answer: "An answer",
          score: null,
          good: "AI evaluation unavailable for this answer.",
          miss: "This answer has not been scored.",
          better: "Try again when evaluation is available.",
        },
      ],
    },
  };
  vi.spyOn(Api, "getReport").mockResolvedValue(data);
  const { client } = openReport("/report?interviewId=unscored");
  await screen.findByText("This answer has not been scored.");
  expect(screen.queryByRole("link", { name: /Practice:/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Retry" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Choose practice settings" })).toBeVisible();
  client.clear();
});

it("makes zero-answer, incomplete, and error states explicit without placeholder scores", async () => {
  const data: InterviewReport = {
    interview: {
      id: "empty",
      setup: defaultSetup,
      status: "incomplete",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      answeredCount: 0,
      lastFeedback: null,
      messages: [],
    },
    feedback: {
      interviewId: "empty",
      answeredQuestions: 0,
      selectedQuestions: 5,
      overall: null,
      scores: null,
      strengths: [],
      gaps: [],
      questions: [],
    },
  };
  vi.spyOn(Api, "getReport").mockResolvedValue(data);
  const { client } = openReport("/report?interviewId=empty");
  expect(
    await screen.findByText("No answers were submitted, so there is no coaching feedback yet."),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Incomplete interview: 0 of 5 main questions answered. Feedback covers only submitted answers.",
    ),
  ).toBeVisible();
  expect(screen.getByText("Not scored")).toBeVisible();
  expect(screen.queryByText("0 / 10")).toBeNull();
  client.clear();
});

it("shows a retry action when the saved report request fails", async () => {
  const data: InterviewReport = {
    interview: {
      id: "retry-report",
      setup: defaultSetup,
      status: "complete",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      answeredCount: 0,
      lastFeedback: null,
      messages: [],
    },
    feedback: {
      interviewId: "retry-report",
      answeredQuestions: 0,
      selectedQuestions: 5,
      overall: null,
      scores: null,
      strengths: [],
      gaps: [],
      questions: [],
    },
  };
  const report = vi
    .spyOn(Api, "getReport")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(data);
  const { client } = openReport("/report?interviewId=retry-report");
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry report" }));
  await screen.findByText("No answers were submitted, so there is no coaching feedback yet.");
  expect(report).toHaveBeenCalledTimes(2);
  client.clear();
});
