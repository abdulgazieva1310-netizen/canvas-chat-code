import { cleanup, render, waitFor } from "@testing-library/react";
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
import { Route } from "@/routes/report";
import { Api } from "@/lib/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openReport(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Dashboard</p>,
  });
  const report = createRoute({
    getParentRoute: () => root,
    path: "/report",
    validateSearch: Route.options.validateSearch!,
    beforeLoad: Route.options.beforeLoad!,
    component: Route.options.component!,
  });
  const router = createRouter({
    context: { queryClient: client },
    routeTree: root.addChildren([dashboard, report]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

it.each([
  "/report",
  "/report?interviewId=",
  "/report?interviewId=%20%20",
  "/report?interviewId=123",
])("redirects invalid report URL %s without fetching", async (url) => {
  const report = vi.spyOn(Api, "getReport");
  const { router, client } = openReport(url);
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(report).not.toHaveBeenCalled();
  client.clear();
});

it("fetches the report for the URL's interview ID", async () => {
  const report = vi.spyOn(Api, "getReport").mockRejectedValue(new Error("Report unavailable"));
  const { client } = openReport("/report?interviewId=session-123");
  await waitFor(() => expect(report).toHaveBeenCalledWith("session-123"));
  client.clear();
});
