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
import { AuthGate } from "@/components/AuthGate";
import { Route as LoginRoute } from "@/routes/login";
import { Route as RegisterRoute } from "@/routes/register";
import { validateAuthSearch } from "@/lib/auth-redirect";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
function openApp(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: () => (
      <AuthGate>
        <Outlet />
      </AuthGate>
    ),
  });
  const login = createRoute({
    getParentRoute: () => root,
    path: "/login",
    validateSearch: LoginRoute.options.validateSearch!,
    component: LoginRoute.options.component!,
  });
  const register = createRoute({
    getParentRoute: () => root,
    path: "/register",
    validateSearch: RegisterRoute.options.validateSearch!,
    component: RegisterRoute.options.component!,
  });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Private dashboard</p>,
  });
  const setup = createRoute({
    getParentRoute: () => root,
    path: "/setup",
    component: () => <p>Private setup</p>,
  });
  const router = createRouter({
    context: { queryClient: client },
    routeTree: root.addChildren([login, register, dashboard, setup]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}
function enterCredentials() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "demo@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
}
it.each(["/login", "/register"])("renders %s without requesting private data", async (url) => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { client } = openApp(url);
  await screen.findByLabelText("Email");
  expect(fetch).not.toHaveBeenCalled();
  client.clear();
});
it("signs in, persists authorization, returns to setup, and handles expiry", async () => {
  const fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
    if (url.endsWith("/auth/login"))
      return new Response('{"id":"user"}', { headers: { Authorization: "Bearer test-session" } });
    return (options.headers as Record<string, string>)["Authorization"] === "Bearer test-session"
      ? new Response("[]")
      : new Response('{"message":"Unauthorized"}', { status: 401 });
  });
  vi.stubGlobal("fetch", fetch);
  const { client, router } = openApp("/setup");
  client.setQueryData(["private", "old-user"], "old data");
  await screen.findByRole("button", { name: "Sign in" });
  expect(router.state.location.pathname).toBe("/login");
  enterCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText("Private setup");
  expect(client.getQueryData(["private", "old-user"])).toBeUndefined();
  expect(sessionStorage.getItem("interview-mirror.authorization")).toBe("Bearer test-session");
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringContaining("/interviews"),
    expect.objectContaining({
      credentials: "include",
      headers: expect.objectContaining({ Authorization: "Bearer test-session" }),
    }),
  );
  window.dispatchEvent(new Event("api:unauthorized"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  client.clear();
});
it("registers and opens the authenticated dashboard", async () => {
  const fetch = vi.fn().mockImplementation(async (url: string) =>
    url.endsWith("/auth/register")
      ? new Response('{"id":"new-user"}', {
          status: 201,
          headers: { Authorization: "Bearer registered-session" },
        })
      : new Response("[]"),
  );
  vi.stubGlobal("fetch", fetch);
  const { client } = openApp("/register");
  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New user" } });
  enterCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByText("Private dashboard");
  expect(fetch.mock.calls[0]?.[0]).toMatch(/\/auth\/register$/);
  expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
    name: "New user",
    email: "demo@example.com",
    password: "secret",
  });
  expect(sessionStorage.getItem("interview-mirror.authorization")).toBe(
    "Bearer registered-session",
  );
  client.clear();
});
it("keeps invalid credentials on login with an error", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () => new Response('{"message":"Invalid email or password."}', { status: 401 }),
      ),
  );
  const { client, router } = openApp("/login");
  await screen.findByLabelText("Email");
  enterCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  expect(router.state.location.pathname).toBe("/login");
  client.clear();
});
it("restores stored authorization after remounting", async () => {
  sessionStorage.setItem("interview-mirror.authorization", "Bearer saved-session");
  const fetch = vi.fn().mockImplementation(async () => new Response("[]"));
  vi.stubGlobal("fetch", fetch);
  const { client } = openApp("/");
  await screen.findByText("Private dashboard");
  expect(fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer saved-session" }),
    }),
  );
  client.clear();
});
it.each(["https://evil.example", "//evil.example", "/login", "/register", "/\\evil.example"])(
  "rejects unsafe redirect %s",
  (redirect) => {
    expect(validateAuthSearch({ redirect }).redirect).toBe("/");
  },
);

it("shows registration errors without leaving the registration page", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () => new Response('{"message":"Email already registered."}', { status: 409 }),
      ),
  );
  const { client, router } = openApp("/register");
  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test" } });
  enterCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Email already registered.");
  expect(router.state.location.pathname).toBe("/register");
  client.clear();
});

it.each(["/history?role=QA", "/profile", "/report?interviewId=123"])(
  "preserves validated private destination %s",
  (redirect) => expect(validateAuthSearch({ redirect }).redirect).toBe(redirect),
);
