import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
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
import { Route as DashboardRoute } from "@/routes/index";
import { AppShell } from "@/components/AppShell";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";
import type { Interview } from "@/lib/api/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const sessions: Interview[] = [
  {
    id: "unfinished-new",
    status: "incomplete",
    setup: { ...defaultSetup, role: "Backend Developer" },
    startedAt: "2026-10-18T12:00:00Z",
    endedAt: "2026-10-18T12:05:00Z",
    answeredCount: 1,
    messages: [],
    lastFeedback: null,
  },
  {
    id: "completed-new",
    status: "complete",
    setup: { ...defaultSetup, role: "QA Engineer" },
    startedAt: "2026-10-17T12:00:00Z",
    endedAt: "2026-10-17T12:05:00Z",
    answeredCount: 10,
    messages: [],
    lastFeedback: null,
  },
  {
    id: "completed-old",
    status: "complete",
    setup: defaultSetup,
    startedAt: "2026-10-16T12:00:00Z",
    endedAt: "2026-10-16T12:05:00Z",
    answeredCount: 10,
    messages: [],
    lastFeedback: null,
  },
];
function openDashboard(history: Interview[], initialEntry = "/") {
  vi.spyOn(Api, "getHistory").mockResolvedValue(history);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: DashboardRoute.options.component!,
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
  const setup = createRoute({
    getParentRoute: () => root,
    path: "/setup",
    component: () => <AppShell><p>Setup destination</p></AppShell>,
  });
  const router = createRouter({
    context: { queryClient: client },
    routeTree: root.addChildren([dashboard, report, interview, setup]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}
it.each([
  ["QA Engineer", "/report?interviewId=completed-new", "Report destination"],
  ["Backend Developer", "/interview?interviewId=unfinished-new", "Interview destination"],
])("opens a recent %s session at its own destination", async (role, href, destination) => {
  const { client, router } = openDashboard(sessions);
  const link = await screen.findByRole("link", { name: new RegExp(role) });
  expect(link).toHaveAttribute("href", href);
  fireEvent.click(link);
  await screen.findByText(destination);
  expect(router.state.location.href).toBe(href);
  client.clear();
});
it("adds the newest matching session IDs to top navigation", async () => {
  const { client } = openDashboard(sessions);
  await screen.findByRole("link", { name: /QA Engineer/ });
  const nav = within(screen.getByRole("navigation"));
  expect(nav.getByRole("link", { name: "Interview" })).toHaveAttribute(
    "href",
    "/interview?interviewId=unfinished-new",
  );
  expect(nav.getByRole("link", { name: "Report" })).toHaveAttribute(
    "href",
    "/report?interviewId=completed-new",
  );
  client.clear();
});
it.each([
  ["empty history", []],
  ["only completed sessions", sessions.filter((session) => session.status === "complete")],
])("opens setup from Interview with %s", async (_, history) => {
  const { client, router } = openDashboard(history);
  if (history.length) await screen.findByRole("link", { name: /QA Engineer/ });
  else await screen.findByText("No saved sessions yet.");
  const link = within(screen.getByRole("navigation")).getByRole("link", { name: "Interview" });
  expect(link).toHaveAttribute("href", "/setup");
  fireEvent.click(link);
  await screen.findByText("Setup destination");
  expect(router.state.location.href).toBe("/setup");
  client.clear();
});

it("keeps Report disabled without completed sessions", async () => {
  const { client } = openDashboard([]);
  await screen.findByText("No saved sessions yet.");
  const nav = within(screen.getByRole("navigation"));
  expect(nav.queryByRole("link", { name: "Report" })).toBeNull();
  expect(nav.getByText("Report")).toHaveAttribute("aria-disabled", "true");
  client.clear();
});

it("points Interview at a newly created active session from the cache", async () => {
  const { client } = openDashboard(sessions);
  await screen.findByRole("link", { name: /QA Engineer/ });
  const active = { ...sessions[0]!, id: "active-new", status: "active" as const, endedAt: null };
  client.setQueryData(["interview", active.id], active);
  await waitFor(() =>
    expect(
      within(screen.getByRole("navigation")).getByRole("link", { name: "Interview" }),
    ).toHaveAttribute("href", "/interview?interviewId=active-new"),
  );
  client.setQueryData(["interview", active.id], { ...active, status: "complete" });
  await waitFor(() =>
    expect(
      within(screen.getByRole("navigation")).getByRole("link", { name: "Interview" }),
    ).toHaveAttribute("href", "/interview?interviewId=unfinished-new"),
  );
  client.clear();
});

it("opens the unfinished interview when clicking the top navigation", async () => {
  const { client, router } = openDashboard(sessions);
  await screen.findByRole("link", { name: /Backend Developer/ });
  fireEvent.click(within(screen.getByRole("navigation")).getByRole("link", { name: "Interview" }));
  await screen.findByText("Interview destination");
  expect(router.state.location.href).toBe("/interview?interviewId=unfinished-new");
  client.clear();
});

it("reads history cache without creating a query or fetching from AppShell", async () => {
  const { client, router } = openDashboard([], "/setup");
  await screen.findByText("Setup destination");
  expect(Api.getHistory).not.toHaveBeenCalled();
  expect(client.getQueryCache().find({ queryKey: ["history"] })).toBeUndefined();
  client.setQueryData(["history"], sessions);
  const nav = within(screen.getByRole("navigation"));
  await waitFor(() => expect(nav.getByRole("link", { name: "Report" })).toHaveAttribute(
    "href", "/report?interviewId=completed-new",
  ));
  fireEvent.click(nav.getByRole("link", { name: "Report" }));
  await screen.findByText("Report destination");
  expect(router.state.location.href).toBe("/report?interviewId=completed-new");
  client.clear();
});

it("preserves the history query function on refetch and opens Dashboard", async () => {
  const { client, router } = openDashboard(sessions, "/setup");
  await screen.findByText("Setup destination");
  fireEvent.click(within(screen.getByRole("navigation")).getByRole("link", { name: "Dashboard" }));
  await screen.findByRole("link", { name: /QA Engineer/ });
  expect(router.state.location.pathname).toBe("/");
  expect(Api.getHistory).toHaveBeenCalledTimes(1);
  expect(client.getQueryCache().find({ queryKey: ["history"] })?.options.queryFn).toBeTypeOf("function");
  await client.refetchQueries({ queryKey: ["history"] }, { throwOnError: true });
  expect(Api.getHistory).toHaveBeenCalledTimes(2);
  client.clear();
});
