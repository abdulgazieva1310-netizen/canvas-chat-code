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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Route as DashboardRoute } from "@/routes/index";
import { Route as ReadyRoute } from "@/routes/ready";
import { AppShell } from "@/components/AppShell";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";
import type { Interview, User } from "@/lib/api/types";

beforeEach(() => {
  vi.spyOn(Api, "getDashboardSummary").mockResolvedValue({ completedCount: 0, recentActivity: [], groups: [], strengths: [], weaknesses: [], suggestions: [] });
});

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
const dashboardUser: User = {
  id: "current",
  name: "Dana Sadyk",
  email: "dana@example.com",
  targetRole: "Python Developer",
  level: "Senior",
  preferredLanguage: "English",
};
function openDashboard(
  history: Interview[],
  initialEntry = "/",
  profile: User | null = dashboardUser,
) {
  vi.spyOn(Api, "getProfile").mockResolvedValue(profile as User);
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
    component: () => (
      <AppShell>
        <p>Setup destination</p>
      </AppShell>
    ),
  });
  const ready = createRoute({
    getParentRoute: () => root,
    path: "/ready",
    validateSearch: ReadyRoute.options.validateSearch!,
    component: () => (
      <AppShell>
        <p>Lobby destination</p>
      </AppShell>
    ),
  });
  const router = createRouter({
    context: { queryClient: client },
    routeTree: root.addChildren([
      dashboard,
      report,
      interview,
      setup,
      ready,
      createRoute({
        getParentRoute: () => root,
        path: "/history",
        component: () => (
          <AppShell>
            <p>History destination</p>
          </AppShell>
        ),
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

it("keeps History navigation available and restores the active page on back", async () => {
  const { client, router } = openDashboard(sessions);
  const history = await screen.findByRole("link", { name: "History" });
  expect(history.closest("nav")).not.toHaveClass("hidden");
  fireEvent.click(history);
  await screen.findByText("History destination");
  expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
  router.history.back();
  await screen.findByRole("heading", { name: "Your practice, reflected." });
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  client.clear();
});
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
it("uses the incomplete session for Interview and the newest completed session for Report", async () => {
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

it("opens an existing active interview from the cache without creating a session", async () => {
  const start = vi.spyOn(Api, "startInterview");
  const { client, router } = openDashboard(
    sessions.filter((session) => session.status === "complete"),
  );
  await screen.findByRole("link", { name: /QA Engineer/ });
  const active = { ...sessions[0]!, id: "active-new", status: "active" as const, endedAt: null };
  client.setQueryData(["interview", active.id], active);
  const link = within(screen.getByRole("navigation")).getByRole("link", { name: "Interview" });
  await waitFor(() => expect(link).toHaveAttribute("href", "/interview?interviewId=active-new"));
  fireEvent.click(link);
  await screen.findByText("Interview destination");
  expect(router.state.location.href).toBe("/interview?interviewId=active-new");

  expect(start).not.toHaveBeenCalled();
  client.clear();
});

it("reads history cache without creating a query or fetching from AppShell", async () => {
  const { client, router } = openDashboard([], "/setup");
  await screen.findByText("Setup destination");
  expect(Api.getHistory).not.toHaveBeenCalled();
  expect(client.getQueryCache().find({ queryKey: ["history"] })).toBeUndefined();
  client.setQueryData(["history"], sessions);
  const nav = within(screen.getByRole("navigation"));
  await waitFor(() =>
    expect(nav.getByRole("link", { name: "Report" })).toHaveAttribute(
      "href",
      "/report?interviewId=completed-new",
    ),
  );
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
  expect(client.getQueryCache().find({ queryKey: ["history"] })?.options.queryFn).toBeTypeOf(
    "function",
  );
  await client.refetchQueries({ queryKey: ["history"] }, { throwOnError: true });
  expect(Api.getHistory).toHaveBeenCalledTimes(2);
  client.clear();
});

it("opens the newest incomplete interview from the top navigation", async () => {
  const older = { ...sessions[0]!, id: "unfinished-old", startedAt: "2026-10-01T12:00:00Z" };
  const { client, router } = openDashboard([older, ...sessions]);
  await screen.findByRole("link", { name: /QA Engineer/ });
  const link = within(screen.getByRole("navigation")).getByRole("link", { name: "Interview" });
  expect(link).toHaveAttribute("href", "/interview?interviewId=unfinished-new");
  fireEvent.click(link);
  await screen.findByText("Interview destination");
  expect(router.state.location.href).toBe("/interview?interviewId=unfinished-new");
  client.clear();
});

it("updates Interview when incomplete sessions arrive or disappear from local history", async () => {
  const { client } = openDashboard([], "/setup");
  await screen.findByText("Setup destination");
  const nav = within(screen.getByRole("navigation"));
  expect(nav.getByRole("link", { name: "Interview" })).toHaveAttribute("href", "/setup");
  client.setQueryData(["history"], sessions);
  await waitFor(() =>
    expect(nav.getByRole("link", { name: "Interview" })).toHaveAttribute(
      "href",
      "/interview?interviewId=unfinished-new",
    ),
  );
  client.setQueryData(
    ["history"],
    sessions.map((session) => ({ ...session, status: "complete" })),
  );
  await waitFor(() =>
    expect(nav.getByRole("link", { name: "Interview" })).toHaveAttribute("href", "/setup"),
  );
  expect(Api.getHistory).not.toHaveBeenCalled();
  client.clear();
});

it("returns Interview to setup when the cached active session completes", async () => {
  const { client } = openDashboard([], "/setup");
  await screen.findByText("Setup destination");
  const active: Interview = { ...sessions[0]!, id: "active", status: "active", endedAt: null };
  const nav = within(screen.getByRole("navigation"));
  client.setQueryData(["interview", active.id], active);
  await waitFor(() =>
    expect(nav.getByRole("link", { name: "Interview" })).toHaveAttribute(
      "href",
      "/interview?interviewId=active",
    ),
  );
  client.setQueryData(["interview", active.id], { ...active, status: "complete" });
  await waitFor(() =>
    expect(nav.getByRole("link", { name: "Interview" })).toHaveAttribute("href", "/setup"),
  );
  client.clear();
});

it.each([sessions[0]!, sessions[1]!])(
  "deletes a $status session without navigating and clears its caches",
  async (target) => {
    let finish!: () => void;
    const deletion = vi.spyOn(Api, "deleteInterview").mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const { client, router } = openDashboard(sessions);
    await screen.findByRole("link", { name: /QA Engineer/ });
    const invalidation = vi.spyOn(client, "invalidateQueries");
    const remaining = sessions.filter((session) => session.id !== target.id);
    vi.mocked(Api.getHistory).mockResolvedValue(remaining);
    client.setQueryData(["interview", target.id], { ...target, status: "active", endedAt: null });
    client.setQueryData(["report", target.id], { interview: target });
    const button = screen.getByRole("button", { name: new RegExp(`Delete ${target.setup.role}`) });
    expect(button.closest("a")).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(deletion).toHaveBeenCalledExactlyOnceWith(target.id));
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(deletion).toHaveBeenCalledOnce();
    expect(router.state.location.href).toBe("/");
    finish();
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: new RegExp(target.setup.role) })).toBeNull(),
    );
    expect(client.getQueryData(["history"])).toEqual(remaining);
    expect(client.getQueryData(["interview", target.id])).toBeUndefined();
    expect(client.getQueryData(["report", target.id])).toBeUndefined();
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["history"] });
    await waitFor(() => expect(Api.getHistory).toHaveBeenCalledTimes(2));
    expect(router.state.location.href).toBe("/");
    client.clear();
  },
);

it("keeps a session visible and allows retrying after a deletion failure", async () => {
  const deletion = vi
    .spyOn(Api, "deleteInterview")
    .mockRejectedValue(new Error("Database unavailable"));
  const { client, router } = openDashboard(sessions);
  const link = await screen.findByRole("link", { name: /Backend Developer/ });
  const button = screen.getByRole("button", { name: /Delete Backend Developer/ });
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not delete session: Database unavailable",
  );
  expect(link).toBeInTheDocument();
  expect(button).toBeEnabled();
  expect(client.getQueryData(["history"])).toEqual(sessions);
  expect(Api.getHistory).toHaveBeenCalledOnce();
  expect(router.state.location.href).toBe("/");
  expect(deletion).toHaveBeenCalledExactlyOnceWith("unfinished-new");
  client.clear();
});

it("shows empty history and sends Interview to setup after deleting the final session", async () => {
  vi.spyOn(Api, "deleteInterview").mockResolvedValue(undefined);
  const { client } = openDashboard([sessions[0]!]);
  await screen.findByRole("link", { name: /Backend Developer/ });
  vi.mocked(Api.getHistory).mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: /Delete Backend Developer/ }));
  await screen.findByText("No saved sessions yet.");
  expect(
    within(screen.getByRole("navigation")).getByRole("link", { name: "Interview" }),
  ).toHaveAttribute("href", "/setup");
  expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  client.clear();
});

it.each(["/ready", "/ready?interviewId=session-123", "/ready?retryId=session-123"])(
  "highlights Lobby by its route at %s",
  async (url) => {
    const { client } = openDashboard([], url);
    await screen.findByText("Lobby destination");
    const nav = within(screen.getByRole("navigation"));
    const lobby = nav.getByRole("link", { name: "Lobby" });
    expect(lobby).toHaveAttribute("aria-current", "page");
    expect(lobby).toHaveClass("bg-muted", "text-foreground");
    expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    expect(nav.getByRole("link", { name: "Setup" })).not.toHaveAttribute("aria-current");
    client.clear();
  },
);

it("opens the /ready Lobby link and removes its highlight after leaving", async () => {
  const { client, router } = openDashboard([], "/setup");
  await screen.findByText("Setup destination");
  const lobby = within(screen.getByRole("navigation")).getByRole("link", { name: "Lobby" });
  expect(lobby).toHaveAttribute("href", "/ready");
  fireEvent.click(lobby);
  await screen.findByText("Lobby destination");
  expect(router.state.location.pathname).toBe("/ready");
  expect(screen.getByRole("link", { name: "Lobby" })).toHaveClass("bg-muted");
  fireEvent.click(within(screen.getByRole("navigation")).getByRole("link", { name: "Setup" }));
  await screen.findByText("Setup destination");
  expect(screen.getByRole("link", { name: "Lobby" })).not.toHaveClass("bg-muted");
  expect(screen.getByRole("link", { name: "Setup" })).toHaveClass("bg-muted");
  client.clear();
});

it("uses the authenticated user's name and saved target on the dashboard", async () => {
  const { client } = openDashboard([]);
  await screen.findByText("Welcome back, Dana Sadyk");
  expect(screen.getByText("Target: Senior Python Developer · English")).toBeInTheDocument();
  expect(screen.queryByText(/Welcome back, Aruzhan/)).toBeNull();
  client.clear();
});

it("uses User and Not set when no profile data is available", async () => {
  const { client } = openDashboard([], "/", null);
  await screen.findByText("No saved sessions yet.");
  expect(screen.getByText("Welcome back, User")).toBeInTheDocument();
  expect(screen.getByText("Target: Not set · English")).toBeInTheDocument();
  client.clear();
});

it("updates the greeting and target when the shared profile changes", async () => {
  const { client } = openDashboard([]);
  await screen.findByText("Welcome back, Dana Sadyk");
  client.setQueryData(["profile"], {
    ...dashboardUser,
    name: "New Name",
    targetRole: "Java Developer",
    level: "Junior",
  });
  await screen.findByText("Welcome back, New Name");
  expect(screen.getByText("Target: Junior Java Developer · English")).toBeInTheDocument();
  client.clear();
});
