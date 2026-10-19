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
import { AppShell } from "@/components/AppShell";
import { Route as DashboardRoute } from "@/routes/index";
import { Route as ProfileRoute } from "@/routes/profile";
import { Api } from "@/lib/api/client";
import { getAuthorization, saveAuthorization } from "@/lib/api/session";
import type { User } from "@/lib/api/types";
import { defaultSetup, quickStartDefaults } from "@/lib/api/default-setup";

const user: User = {
  id: "user-1",
  name: "Aigerim Murat",
  email: "aigerim@example.com",
  targetRole: "Backend Developer",
  level: "Middle",
  preferredLanguage: "English",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function openPage(path = "/", cached = false, realDashboard = false, currentUser: User = user) {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(Api, "getProfile").mockResolvedValue(currentUser);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["history"], []);
  if (cached) client.setQueryData(["profile"], currentUser);
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: realDashboard
      ? DashboardRoute.options.component!
      : () => <AppShell>Dashboard content</AppShell>,
  });
  const profile = createRoute({
    getParentRoute: () => root,
    path: "/profile",
    component: ProfileRoute.options.component!,
  });
  const login = createRoute({
    getParentRoute: () => root,
    path: "/login",
    component: () => <p>Login page</p>,
  });
  const router = createRouter({
    context: { queryClient: client },
    routeTree: root.addChildren([
      home,
      profile,
      login,
      createRoute({
        getParentRoute: () => root,
        path: "/interview",
        validateSearch: (search: Record<string, unknown>) => ({
          interviewId: String(search["interviewId"] || ""),
        }),
        component: () => <p>New interview room</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

async function openMenu() {
  const button = await screen.findByRole("button", { name: "Account menu" });
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false });
  await screen.findByRole("menu");
  return button;
}

it("quick starts with saved preferences and opens the newly created room", async () => {
  vi.spyOn(Api, "getHistory").mockResolvedValue([]);
  const created = {
    id: "quick-started",
    setup: { ...quickStartDefaults, role: user.targetRole, level: user.level },
    status: "active" as const,
    startedAt: new Date().toISOString(),
    endedAt: null,
    answeredCount: 0,
    messages: [],
    lastFeedback: null,
  };
  const start = vi.spyOn(Api, "startInterview").mockResolvedValue(created);
  const { client, router } = openPage("/", true, true);
  fireEvent.click(await screen.findByRole("button", { name: "Quick Start →" }));
  await screen.findByText("New interview room");
  expect(start).toHaveBeenCalledExactlyOnceWith({
    ...quickStartDefaults,
    role: user.targetRole,
    level: user.level,
  });
  expect(router.state.location.search).toEqual({ interviewId: "quick-started" });
  expect(client.getQueryData(["interview", "quick-started"])).toEqual(created);
  expect(client.getQueryData(["profile"])).toEqual(user);
  client.clear();
});

it("uses explicit Quick Start defaults when saved role and level are missing", async () => {
  vi.spyOn(Api, "getHistory").mockResolvedValue([]);
  vi.spyOn(Api, "getDashboardSummary").mockResolvedValue({
    completedCount: 0,
    recentActivity: [],
    groups: [],
    strengths: [],
    weaknesses: [],
    suggestions: [],
  });
  const incompleteProfile = {
    ...user,
    targetRole: "" as User["targetRole"],
    level: "" as User["level"],
  };
  const created = {
    id: "default-quick-start",
    setup: quickStartDefaults,
    status: "active" as const,
    startedAt: new Date().toISOString(),
    endedAt: null,
    answeredCount: 0,
    messages: [],
    lastFeedback: null,
  };
  const start = vi.spyOn(Api, "startInterview").mockResolvedValue(created);
  const { client, router } = openPage("/", false, true, incompleteProfile);
  const quickStart = await screen.findByRole("button", { name: "Quick Start →" });
  await waitFor(() => expect(quickStart).toBeEnabled());
  fireEvent.click(quickStart);
  await screen.findByText("New interview room");
  expect(start).toHaveBeenCalledExactlyOnceWith(quickStartDefaults);
  expect(router.state.location.search).toEqual({ interviewId: created.id });
  expect(client.getQueryData(["profile"])).toEqual(incompleteProfile);
  client.clear();
});

it("keeps Quick Start on the dashboard after failure and retries without an invalid ID", async () => {
  vi.spyOn(Api, "getHistory").mockResolvedValue([]);
  vi.spyOn(Api, "getDashboardSummary").mockResolvedValue({
    completedCount: 0,
    recentActivity: [],
    groups: [],
    strengths: [],
    weaknesses: [],
    suggestions: [],
  });
  const created = {
    id: "quick-start-retry",
    setup: { ...quickStartDefaults, role: user.targetRole, level: user.level },
    status: "active" as const,
    startedAt: new Date().toISOString(),
    endedAt: null,
    answeredCount: 0,
    messages: [],
    lastFeedback: null,
  };
  const start = vi.spyOn(Api, "startInterview").mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(created);
  const { client, router } = openPage("/", true, true);
  fireEvent.click(await screen.findByRole("button", { name: "Quick Start →" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Could not start interview: offline"),
  );
  expect(router.state.location.pathname).toBe("/");
  fireEvent.click(screen.getByRole("button", { name: "Quick Start →" }));
  await screen.findByText("New interview room");
  expect(start).toHaveBeenCalledTimes(2);
  expect(router.state.location.search).toEqual({ interviewId: created.id });
  client.clear();
});

it("opens the avatar dropdown with the actual user and links to profile settings", async () => {
  const { client, router } = openPage();
  await screen.findByText("Dashboard content");
  expect(Api.getProfile).not.toHaveBeenCalled();
  const avatar = await openMenu();
  await screen.findByText(user.email);
  expect(screen.getByText(user.name)).toBeInTheDocument();
  expect(avatar).toHaveTextContent("AM");
  const settings = screen.getByRole("menuitem", { name: "Profile Settings" });
  expect(settings).toHaveAttribute("href", "/profile");
  fireEvent.click(settings);
  await screen.findByRole("heading", { name: "Profile Settings" });
  expect(router.state.location.pathname).toBe("/profile");
  expect(screen.getByLabelText("Name")).toHaveValue(user.name);
  client.clear();
});

it("opens from the keyboard and closes with Escape", async () => {
  const { client } = openPage("/", true);
  const button = await screen.findByRole("button", { name: "Account menu" });
  fireEvent.keyDown(button, { key: "Enter" });
  await screen.findByRole("menu");
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  client.clear();
});

it("saves name, role, and level and updates the shared user cache and avatar", async () => {
  const { client } = openPage("/profile");
  await screen.findByLabelText("Name");
  let finish!: (value: User) => void;
  const update = vi.spyOn(Api, "updateProfile").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Dana Sadyk  " } });
  fireEvent.change(screen.getByLabelText("Target role"), { target: { value: "C++ Developer" } });
  fireEvent.change(screen.getByLabelText("Level"), { target: { value: "Senior" } });
  fireEvent.change(screen.getByLabelText("Preferred language"), {
    target: { value: "  Kazakh  " },
  });
  expect(screen.getByText(/Interviews and feedback are currently in English/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledExactlyOnceWith({
      name: "Dana Sadyk",
      targetRole: "C++ Developer",
      level: "Senior",
      preferredLanguage: "Kazakh",
    }),
  );
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  const updated: User = {
    ...user,
    name: "Dana Sadyk",
    targetRole: "C++ Developer",
    level: "Senior",
    preferredLanguage: "Kazakh",
  };
  vi.mocked(Api.getProfile).mockResolvedValue(updated);
  finish(updated);
  await screen.findByText("Profile saved.");
  expect(client.getQueryData(["profile"])).toEqual(updated);
  expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent("DS");
  expect(screen.getByLabelText("Name")).toHaveValue(updated.name);
  expect(screen.getByLabelText("Preferred language")).toHaveValue("Kazakh");
  client.clear();
});

it("keeps edits and allows retrying a failed profile save", async () => {
  const { client } = openPage("/profile");
  await screen.findByLabelText("Name");
  vi.spyOn(Api, "updateProfile").mockRejectedValue(new Error("Database unavailable"));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Unsaved name" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save profile: Database unavailable",
  );
  expect(screen.getByLabelText("Name")).toHaveValue("Unsaved name");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  expect(client.getQueryData(["profile"])).toEqual(user);
  client.clear();
});

it("logs out, clears credentials and private cached data, and replaces the route with login", async () => {
  saveAuthorization("Bearer private-token");
  const { client, router } = openPage("/", true);
  client.setQueryData(["interview", "private"], { id: "private" });
  vi.spyOn(Api, "logout").mockResolvedValue(undefined);
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Logout" }));
  await screen.findByText("Login page");
  await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
  expect(getAuthorization()).toBeNull();
  expect(router.state.location.pathname).toBe("/login");
  expect(Api.logout).toHaveBeenCalledOnce();
  client.clear();
});

it("shows logout failures and retains the session for retry", async () => {
  saveAuthorization("Bearer private-token");
  const { client, router } = openPage("/", true);
  vi.spyOn(Api, "logout").mockRejectedValue(new Error("Network unavailable"));
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Logout" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not log out: Network unavailable",
  );
  expect(getAuthorization()).toBe("Bearer private-token");
  expect(router.state.location.pathname).toBe("/");
  expect(screen.getByRole("menuitem", { name: "Logout" })).not.toHaveAttribute("data-disabled");
  client.clear();
});

it("shows saved profile edits when returning to the real dashboard", async () => {
  const { client } = openPage("/profile", false, true);
  await screen.findByLabelText("Name");
  const updated: User = {
    ...user,
    name: "Dana Sadyk",
    targetRole: "Java Developer",
    level: "Senior",
  };
  vi.spyOn(Api, "updateProfile").mockResolvedValue(updated);
  vi.spyOn(Api, "getHistory").mockResolvedValue([
    {
      id: "recent-python-session",
      setup: { ...defaultSetup, role: "Python Developer", level: "Junior" },
      status: "incomplete",
      startedAt: "2026-10-19T10:00:00Z",
      endedAt: "2026-10-19T10:05:00Z",
      answeredCount: 1,
      messages: [],
      lastFeedback: null,
    },
  ]);
  vi.mocked(Api.getProfile).mockResolvedValue(updated);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: updated.name } });
  fireEvent.change(screen.getByLabelText("Target role"), { target: { value: updated.targetRole } });
  fireEvent.change(screen.getByLabelText("Level"), { target: { value: updated.level } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Profile saved.");
  fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
  await screen.findByText("Welcome back, Dana Sadyk");
  expect(screen.getByText("Target: Senior Java Developer · English")).toBeInTheDocument();
  client.clear();
});
