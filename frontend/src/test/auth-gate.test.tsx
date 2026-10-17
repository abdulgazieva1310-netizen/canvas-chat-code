import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { AuthGate } from "@/components/AuthGate";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("requires login, loads private content, and handles expiry", async () => {
  let signedIn = false;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/auth/login")) {
        signedIn = true;
        return new Response('{"id":"user"}');
      }
      return signedIn
        ? new Response("[]")
        : new Response('{"message":"Unauthorized"}', { status: 401 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["private", "old-user"], "old data");
  render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <p>Private dashboard</p>
      </AuthGate>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Sign in" });
  expect(screen.queryByText("Private dashboard")).toBeNull();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "demo@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "demo-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText("Private dashboard");
  expect(client.getQueryData(["private", "old-user"])).toBeUndefined();
  window.dispatchEvent(new Event("api:unauthorized"));
  await waitFor(() => expect(screen.queryByText("Private dashboard")).toBeNull());
  client.clear();
});
