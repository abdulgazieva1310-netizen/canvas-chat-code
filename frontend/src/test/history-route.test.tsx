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
import type { ReactNode } from "react";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";
import { Route as HistoryRoute } from "@/routes/history";
import type { HistoryPage, Interview, InterviewReport } from "@/lib/api/types";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function session(
  id: string,
  status: Interview["status"],
  overrides: Partial<Interview> = {},
): Interview {
  return {
    id,
    setup: { ...defaultSetup, role: "QA Engineer", type: "Behavioral" },
    status,
    startedAt: "2026-10-18T23:30:00-04:00",
    endedAt: status === "active" ? null : "2026-10-19T03:00:00Z",
    answeredCount: status === "complete" ? 5 : 1,
    messages: [],
    lastFeedback: null,
    ...overrides,
  };
}

function page(items: Interview[], pageNumber = 1, total = items.length): HistoryPage {
  return { items, page: pageNumber, pageSize: 20, total };
}

function openHistory(initialEntry = "/history") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });
  const history = createRoute({
    getParentRoute: () => root,
    path: "/history",
    validateSearch: HistoryRoute.options.validateSearch!,
    component: HistoryRoute.options.component!,
  });
  const report = createRoute({
    getParentRoute: () => root,
    path: "/report",
    validateSearch: (search: Record<string, unknown>) => ({ interviewId: search["interviewId"] }),
    component: () => <p>Report destination</p>,
  });
  const interview = createRoute({
    getParentRoute: () => root,
    path: "/interview",
    validateSearch: (search: Record<string, unknown>) => ({ interviewId: search["interviewId"] }),
    component: () => <p>Interview destination</p>,
  });
  const router = createRouter({
    context: { queryClient: client },
    routeTree: root.addChildren([history, report, interview]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

function reportFor(interview: Interview, overall: number | null): InterviewReport {
  return {
    interview,
    feedback: {
      interviewId: interview.id,
      overall,
      scores: null,
      strengths: [],
      gaps: [],
      questions: [],
    },
  };
}

it("composes URL-backed filters, resets page on change, and navigates stably between pages", async () => {
  const item = session("one", "complete");
  const request = vi
    .spyOn(Api, "getHistoryPage")
    .mockImplementation(async (query) => page([item], query.page, 45));
  vi.spyOn(Api, "getReport").mockResolvedValue(reportFor(item, 8.5));
  const { client, router } = openHistory("/history?page=3&pageSize=20");
  await screen.findByText("Score 8.5 / 10");
  expect(request).toHaveBeenLastCalledWith({ page: 3, pageSize: 20 });

  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "QA Engineer" } });
  await waitFor(() =>
    expect(request).toHaveBeenLastCalledWith({ role: "QA Engineer", page: 1, pageSize: 20 }),
  );
  fireEvent.change(screen.getByLabelText("Interview type"), { target: { value: "Behavioral" } });
  fireEvent.change(screen.getByLabelText("Start date (UTC)"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("End date (UTC)"), { target: { value: "2026-10-19" } });
  fireEvent.change(screen.getByLabelText("Minimum score"), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText("Maximum score"), { target: { value: "9" } });
  fireEvent.change(screen.getByLabelText("Search role or job description"), {
    target: { value: "API design" },
  });
  await waitFor(() =>
    expect(request).toHaveBeenLastCalledWith({
      role: "QA Engineer",
      type: "Behavioral",
      startDate: "2026-10-01",
      endDate: "2026-10-19",
      minScore: 7,
      maxScore: 9,
      search: "API design",
      page: 1,
      pageSize: 20,
    }),
  );
  expect(router.state.location.href).toContain("role=QA+Engineer");
  expect(router.state.location.href).toContain("search=API+design");
  expect(screen.getByLabelText("Role")).toHaveValue("QA Engineer");

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await waitFor(() =>
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })),
  );
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  client.clear();
});

it("shows status labels, UTC dates, score availability, and active versus report links", async () => {
  const complete = session("complete-id", "complete");
  const incomplete = session("partial-id", "incomplete");
  const active = session("active-id", "active");
  vi.spyOn(Api, "getHistoryPage").mockResolvedValue(page([complete, incomplete, active], 1, 3));
  vi.spyOn(Api, "getReport").mockImplementation(async (id) =>
    reportFor(id === complete.id ? complete : incomplete, id === complete.id ? 8 : null),
  );
  const { client } = openHistory();
  const completeRow = await screen.findByRole("link", {
    name: /QA Engineer.*Behavioral.*Completed/,
  });
  expect(completeRow).toHaveAttribute("href", "/report?interviewId=complete-id");
  expect(screen.getByText("2026-10-19 UTC · Practice · Completed")).toBeVisible();
  expect(await screen.findByText("Score 8 / 10")).toBeVisible();
  expect(screen.getByRole("link", { name: /Incomplete/ })).toHaveAttribute(
    "href",
    "/report?interviewId=partial-id",
  );
  expect(await screen.findByText("Unscored")).toBeVisible();
  const activeRow = screen.getByRole("link", { name: /Active/ });
  expect(activeRow).toHaveAttribute("href", "/interview?interviewId=active-id");
  expect(activeRow).toHaveTextContent("Active");
  client.clear();
});

it("has usable empty, loading, and retryable error states and restores filters from the URL", async () => {
  let resolve!: (data: HistoryPage) => void;
  const request = vi
    .spyOn(Api, "getHistoryPage")
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(page([]));
  const { client } = openHistory("/history?role=QA%20Engineer&search=systems");
  expect(await screen.findByRole("status")).toHaveTextContent("Loading interview history");
  expect(screen.getByLabelText("Role")).toHaveValue("QA Engineer");
  expect(screen.getByLabelText("Search role or job description")).toHaveValue("systems");
  resolve(page([]));
  await screen.findByText("No interviews match these filters.");
  fireEvent.change(screen.getByLabelText("Search role or job description"), {
    target: { value: "retry search" },
  });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("No interviews match these filters.");
  expect(request).toHaveBeenCalledTimes(3);
  client.clear();
});

it("does not let a stale filter response replace the current result set", async () => {
  let resolveOld!: (data: HistoryPage) => void;
  const old = session("stale-result", "complete", {
    setup: { ...defaultSetup, role: "Backend Developer" },
  });
  const current = session("current-result", "complete", {
    setup: { ...defaultSetup, role: "Data Analyst" },
  });
  vi.spyOn(Api, "getHistoryPage").mockImplementation((query) =>
    query.search
      ? Promise.resolve(page([current]))
      : new Promise((resolve) => {
          resolveOld = resolve;
        }),
  );
  vi.spyOn(Api, "getReport").mockImplementation(async (id) =>
    reportFor(id === old.id ? old : current, 8),
  );
  const { client } = openHistory();
  await screen.findByRole("status");
  fireEvent.change(screen.getByLabelText("Search role or job description"), {
    target: { value: "current" },
  });
  expect(await screen.findByRole("link", { name: /Data Analyst/ })).toBeVisible();
  resolveOld(page([old]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByRole("link", { name: /Data Analyst/ })).toBeVisible();
  expect(screen.queryByRole("link", { name: /Backend Developer/ })).toBeNull();
  client.clear();
});
