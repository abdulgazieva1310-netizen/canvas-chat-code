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
import { Route as SetupRoute } from "@/routes/setup";
import { Route as ReadyRoute } from "@/routes/ready";
import { defaultSetup } from "@/lib/api/default-setup";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openStartPage(path: "/setup" | "/ready") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });
  const setup = createRoute({
    getParentRoute: () => root,
    path: "/setup",
    component: SetupRoute.options.component!,
  });
  const ready = createRoute({
    getParentRoute: () => root,
    path: "/ready",
    validateSearch: ReadyRoute.options.validateSearch!,
    component: ReadyRoute.options.component!,
  });
  const interview = createRoute({
    getParentRoute: () => root,
    path: "/interview",
    component: () => <p>Live interview</p>,
  });
  const router = createRouter({
    context: { queryClient: client },
    routeTree: root.addChildren([setup, ready, interview]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

it.each(["/setup", "/ready"] as const)(
  "waits for creation on %s and navigates with the backend ID",
  async (path) => {
    let complete!: (response: Response) => void;
    const fetch = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const { client, router } = openStartPage(path);
    fireEvent.click(await screen.findByRole("button", { name: "Start interview" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/interviews",
      expect.objectContaining({ method: "POST", body: JSON.stringify(defaultSetup) }),
    );
    expect(router.state.location.pathname).toBe(path);
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    complete(
      new Response(JSON.stringify({ id: "backend-session-123", setup: defaultSetup }), {
        status: 201,
      }),
    );
    await screen.findByText("Live interview");
    expect(router.state.location.href).toBe("/interview?interviewId=backend-session-123");
    client.clear();
  },
);

it.each(["/setup", "/ready"] as const)(
  "stays on %s with an error when the response has no ID",
  async (path) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ setup: defaultSetup }), { status: 201 })),
    );
    const { client, router } = openStartPage(path);
    fireEvent.click(await screen.findByRole("button", { name: "Start interview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("did not return a valid interview");
    expect(router.state.location.pathname).toBe(path);
    expect(screen.queryByText("Live interview")).toBeNull();
    client.clear();
  },
);
