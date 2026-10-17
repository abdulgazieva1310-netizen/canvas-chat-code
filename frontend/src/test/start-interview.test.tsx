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
import { AuthGate } from "@/components/AuthGate";
import { Route as InterviewRoute } from "@/routes/interview";
import type { Interview } from "@/lib/api/types";
import { defaultSetup } from "@/lib/api/default-setup";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function openStartPage(path: "/setup" | "/ready", withAuth = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: withAuth
      ? () => (
          <AuthGate>
            <Outlet />
          </AuthGate>
        )
      : Outlet,
  });
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
    validateSearch: InterviewRoute.options.validateSearch!,
    beforeLoad: InterviewRoute.options.beforeLoad!,
    component: withAuth ? InterviewRoute.options.component! : () => <p>Live interview</p>,
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

const createdInterview: Interview = {
  id: "created-session-123",
  setup: defaultSetup,
  status: "active",
  startedAt: new Date().toISOString(),
  endedAt: null,
  answeredCount: 0,
  lastFeedback: null,
  messages: [
    {
      id: "question-1",
      interviewId: "created-session-123",
      from: "ai",
      text: "First interview question",
      createdAt: new Date().toISOString(),
    },
  ],
};

it("opens the real interview after creating it inside the authenticated app", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async (_url: string, options: RequestInit) =>
          new Response(
            JSON.stringify(
              options.method === "POST"
                ? createdInterview
                : _url.endsWith("/interviews")
                  ? []
                  : createdInterview,
            ),
            { status: options.method === "POST" ? 201 : 200 },
          ),
      ),
  );
  const { client, router } = openStartPage("/setup", true);
  fireEvent.click(await screen.findByRole("button", { name: "Start interview" }));
  await screen.findByText("First interview question");
  expect(router.state.location.href).toBe("/interview?interviewId=created-session-123");
  expect(client.getQueryData(["interview", createdInterview.id])).toEqual(createdInterview);
  client.clear();
});

it.each([400, 401, 500])(
  "keeps creation errors visible on Setup for HTTP %s, including inside AuthGate",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, options: RequestInit) =>
        options.method === "POST"
          ? new Response(JSON.stringify({ message: "Creation failed. Please try again." }), {
              status,
            })
          : new Response("[]"),
      ),
    );
    const { client, router } = openStartPage("/setup", true);
    fireEvent.click(await screen.findByRole("button", { name: "Start interview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not start interview: Creation failed. Please try again.",
    );
    expect(router.state.location.pathname).toBe("/setup");
    expect(screen.getByRole("button", { name: "Start interview" })).toBeEnabled();
    client.clear();
  },
);

it("displays network failures and allows retrying without leaving Setup", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockImplementation(
      async () => new Response(JSON.stringify(createdInterview), { status: 201 }),
    );
  vi.stubGlobal("fetch", fetch);
  const { client, router } = openStartPage("/setup");
  fireEvent.click(await screen.findByRole("button", { name: "Start interview" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not start interview: Failed to fetch",
  );
  expect(router.state.location.pathname).toBe("/setup");
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  await screen.findByText("Live interview");
  expect(fetch).toHaveBeenCalledTimes(2);
  client.clear();
});

it("displays a navigation failure on Setup", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify(createdInterview), { status: 201 }),
      ),
  );
  const { client, router } = openStartPage("/setup");
  await screen.findByRole("button", { name: "Start interview" });
  vi.spyOn(router, "navigate").mockRejectedValueOnce(new Error("Unable to open interview"));
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not start interview: Unable to open interview",
  );
  expect(router.state.location.pathname).toBe("/setup");
  client.clear();
});
