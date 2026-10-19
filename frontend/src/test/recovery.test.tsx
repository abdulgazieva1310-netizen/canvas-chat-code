import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { RecoveryPage } from "@/components/RecoveryPage";
import { AuthGate } from "@/components/AuthGate";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function openRecovery(token?: string) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const root = createRootRoute({
    component: () => (
      <AuthGate>
        <Outlet />
      </AuthGate>
    ),
  });
  const recovery = createRoute({
    getParentRoute: () => root,
    path: token === undefined ? "/forgot-password" : "/reset-password",
    component: () => <RecoveryPage token={token} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([recovery]),
    history: createMemoryHistory({
      initialEntries: [token === undefined ? "/forgot-password" : "/reset-password"],
    }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}

it("requests a reset publicly and shows neutral delivery guidance", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"message":"Accepted"}', { status: 202 }));
  vi.stubGlobal("fetch", fetch);
  const client = openRecovery();
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "person@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(await screen.findByRole("status")).toHaveTextContent("If this account exists");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/auth/password-reset/request"),
    expect.objectContaining({ body: JSON.stringify({ email: "person@example.com" }) }),
  );
  client.clear();
});

it("keeps input on delivery request failure and permits retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const client = openRecovery();
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "person@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
  expect(screen.getByLabelText("Email")).toHaveValue("person@example.com");
  expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
  client.clear();
});

it("validates confirmation then resets and clears saved credentials and private caches", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  sessionStorage.setItem("interview-mirror.authorization", "Bearer old-session");
  const client = openRecovery("reset-token");
  client.setQueryData(["private"], "previous user's data");
  fireEvent.change(await screen.findByLabelText("New password"), {
    target: { value: "replacement" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "different" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Passwords must match");
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Your password has been changed");
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/auth/password-reset/confirm"),
    expect.objectContaining({
      body: JSON.stringify({ token: "reset-token", password: "replacement" }),
    }),
  );
  await waitFor(() => expect(client.getQueryData(["private"])).toBeUndefined());
  expect(sessionStorage.getItem("interview-mirror.authorization")).toBeNull();
  client.clear();
});

it.each(["", "expired-token"])("handles a missing or expired link (%s)", async (token) => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response('{"message":"Invalid or expired password reset link."}', { status: 400 }),
    );
  vi.stubGlobal("fetch", fetch);
  const client = openRecovery(token);
  if (token) {
    fireEvent.change(await screen.findByLabelText("New password"), {
      target: { value: "replacement" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "replacement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
  }
  expect(await screen.findByRole("alert")).toHaveTextContent("invalid or expired");
  expect(screen.getByRole("link", { name: "Request another reset link" })).toBeVisible();
  if (!token) expect(fetch).not.toHaveBeenCalled();
  client.clear();
});
