import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { Api } from "@/lib/api/client";
import { Route as ReadyRoute } from "@/routes/ready";
import type { Interview } from "@/lib/api/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("retains an evidence-backed topic across a failed start and retries with a Practice setup", async () => {
  const source: Interview = {
    id: "original",
    setup: {
      role: "Backend Developer",
      level: "Middle",
      mode: "Real Interview",
      questionCount: 10,
      type: "Technical",
      input: "Text",
      language: "English",
    },
    status: "complete",
    startedAt: "2026-10-01T00:00:00Z",
    endedAt: "2026-10-01T01:00:00Z",
    answeredCount: 10,
    messages: [],
    lastFeedback: null,
  };
  vi.spyOn(Api, "getInterview").mockResolvedValue(source);
  const start = vi.spyOn(Api, "startInterview").mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ...source, id: "retry", setup: { ...source.setup, mode: "Practice", practiceTopic: "hashing" }, status: "active" });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });
  const ready = createRoute({
    getParentRoute: () => root,
    path: "/ready",
    validateSearch: ReadyRoute.options.validateSearch!,
    component: ReadyRoute.options.component!,
  });
  const interview = createRoute({
    getParentRoute: () => root,
    path: "/interview",
    validateSearch: (search: Record<string, unknown>) => ({ interviewId: search["interviewId"] }),
    component: () => <p>Interview destination</p>,
  });
  const router = createRouter({
    context: { queryClient: client },
    routeTree: root.addChildren([ready, interview]),
    history: createMemoryHistory({ initialEntries: ["/ready?retryId=original&practiceTopic=hashing"] }),
  });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);

  expect(await screen.findByLabelText("Targeted practice topic")).toHaveTextContent("hashing");
  const expected = { ...source.setup, mode: "Practice", practiceTopic: "hashing" };
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  await screen.findByRole("alert");
  expect(start).toHaveBeenNthCalledWith(1, expected);
  expect(screen.getByLabelText("Targeted practice topic")).toHaveTextContent("hashing");

  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  await screen.findByText("Interview destination");
  expect(start).toHaveBeenNthCalledWith(2, expected);
  expect(router.state.location.search).toEqual({ interviewId: "retry" });
  client.clear();
});
