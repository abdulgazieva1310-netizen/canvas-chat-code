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
import { Route as ProfileRoute } from "@/routes/profile";
import { Api } from "@/lib/api/client";
import { getAuthorization, saveAuthorization } from "@/lib/api/session";
import type { User } from "@/lib/api/types";

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

function openPage(path = "/", cached = false) {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(Api, "getProfile").mockResolvedValue(user);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["history"], []);
  if (cached) client.setQueryData(["profile"], user);
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <AppShell>Dashboard content</AppShell>,
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
    routeTree: root.addChildren([home, profile, login]),
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
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledExactlyOnceWith({
      name: "Dana Sadyk",
      targetRole: "C++ Developer",
      level: "Senior",
    }),
  );
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  const updated: User = {
    ...user,
    name: "Dana Sadyk",
    targetRole: "C++ Developer",
    level: "Senior",
  };
  vi.mocked(Api.getProfile).mockResolvedValue(updated);
  finish(updated);
  await screen.findByText("Profile saved.");
  expect(client.getQueryData(["profile"])).toEqual(updated);
  expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent("DS");
  expect(screen.getByLabelText("Name")).toHaveValue(updated.name);
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
