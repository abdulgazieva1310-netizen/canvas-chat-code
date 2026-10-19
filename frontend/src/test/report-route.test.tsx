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
    interview: { id: "session-123", setup: defaultSetup, status: "complete", startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(), answeredCount: 1, lastFeedback: null, messages: [] },
    feedback: { interviewId: "session-123", overall: 7, scores: null, strengths: ["**Readable code**"], gaps: ["Handle `null`"],
      questions: [{ q: "## Two Sum\n\nReturn **indices**.", answer: "code", score: 7,
        good: "Uses a **hash map**.", miss: "- Consider duplicates", better: "```python\ndef solve():\n    return []\n```" }] },
  };
  vi.spyOn(Api, "getReport").mockResolvedValue(data);
  const { client } = openReport("/report?interviewId=session-123");
  await screen.findByRole("heading", { name: "Two Sum" });
  expect(screen.getByRole("link", { name: /Practice: - Consider duplicates/ })).toBeVisible();
  expect(screen.getByText("Readable code").tagName).toBe("STRONG");
  expect(screen.getByText("hash map").tagName).toBe("STRONG");
  expect(document.querySelector("pre code.language-python")?.textContent).toBe("def solve():\n    return []\n");
  fireEvent.click(screen.getByRole("button", { name: /Question 1/ }));
  expect(screen.queryByRole("heading", { name: "Two Sum" })).toBeNull();
  client.clear();
});

it("offers no targeted recommendation without scored evidence and leaves retry/setup available", async () => {
  const data: InterviewReport = {
    interview: { id: "unscored", setup: defaultSetup, status: "incomplete", startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(), answeredCount: 1, lastFeedback: null, messages: [] },
    feedback: { interviewId: "unscored", overall: null, scores: null, strengths: [], gaps: [],
      questions: [{ q: "Question?", answer: "An answer", score: null,
        good: "AI evaluation unavailable for this answer.", miss: "This answer has not been scored.",
        better: "Try again when evaluation is available." }] },
  };
  vi.spyOn(Api, "getReport").mockResolvedValue(data);
  const { client } = openReport("/report?interviewId=unscored");
  await screen.findByText("This answer has not been scored.");
  expect(screen.queryByRole("link", { name: /Practice:/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Retry" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Choose practice settings" })).toBeVisible();
  client.clear();
});
