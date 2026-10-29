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
import { Api } from "@/lib/api/client";
import type { Interview, StudyPlan } from "@/lib/api/types";
import { Route as StudyRoute } from "@/routes/study";
import { SaveQuestionButton } from "@/components/SaveQuestionButton";
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: any) => <div>{children}</div>,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const item = {
  id: "saved",
  interviewId: "interview",
  questionId: "question",
  prompt: "<script>question</script>",
  note: "Original",
  savedAt: "2026-10-20T00:00:00Z",
};
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => root,
    path: "/study",
    component: StudyRoute.options.component!,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/study"] }),
  });
  if (!vi.isMockFunction(Api.getHistory)) vi.spyOn(Api, "getHistory").mockResolvedValue([]);
  if (!vi.isMockFunction(Api.getStudyPlans))
    vi.spyOn(Api, "getStudyPlans").mockResolvedValue({ items: [] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}
it("loads notes, safely renders text, retains failed edits and supports retry/removal", async () => {
  const listing = vi
    .spyOn(Api, "getStudyQuestions")
    .mockResolvedValue({ items: [item], total: 1, page: 1, pageSize: 20 });
  const update = vi
    .spyOn(Api, "updateStudyQuestion")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ...item, note: "Русский <b>note</b>" });
  vi.spyOn(Api, "deleteStudyQuestion").mockImplementation(async () => {
    listing.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  });
  const client = open();
  const input = await screen.findByLabelText("Private note");
  expect(screen.getByText(item.prompt)).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
  fireEvent.change(input, { target: { value: "Русский <b>note</b>" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByRole("alert");
  expect(input).toHaveValue("Русский <b>note</b>");
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByText("Note saved.");
  expect(update).toHaveBeenLastCalledWith("saved", "Русский <b>note</b>");
  fireEvent.click(screen.getByRole("button", { name: "Remove saved question" }));
  await screen.findByText("No saved questions on this page.");
  client.clear();
});
it("paginates and retries listing failures", async () => {
  const listing = vi
    .spyOn(Api, "getStudyQuestions")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ items: [item], total: 21, page: 1, pageSize: 20 })
    .mockResolvedValue({
      items: [{ ...item, id: "last", prompt: "Last question" }],
      total: 21,
      page: 2,
      pageSize: 20,
    });
  const client = open();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByLabelText("Private note");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Last question");
  expect(listing).toHaveBeenLastCalledWith(2);
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  client.clear();
});
it("saves reported questions with pending and failure recovery", async () => {
  let finish!: (value: typeof item) => void;
  const save = vi
    .spyOn(Api, "saveStudyQuestion")
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <SaveQuestionButton interviewId="interview" questionId="question" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("button", { name: "Saving question…" })).toBeDisabled();
  finish(item);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Question saved" })).toBeDisabled(),
  );
  expect(save).toHaveBeenLastCalledWith("interview", "question");
  client.clear();
});

const report = (id: string): Interview => ({
  id,
  setup: {
    role: "QA Engineer",
    level: "Junior",
    mode: "Practice",
    questionCount: 5,
    type: "Behavioral",
    input: "Text",
    language: "English",
  },
  status: "complete",
  startedAt: "2026-10-20T00:00:00Z",
  endedAt: "2026-10-20T01:00:00Z",
  answeredCount: 5,
  messages: [],
  lastFeedback: null,
});
const plan: StudyPlan = {
  id: "plan",
  comparisonGroup: {
    role: "QA Engineer",
    type: "Behavioral",
    mode: "Practice",
    level: "Junior",
    language: "English",
  },
  sources: [
    { interviewId: "report-1", startedAt: "2026-10-20T00:00:00Z", overall: 6.5 },
    { interviewId: "report-2", startedAt: "2026-10-19T00:00:00Z", overall: 6.2 },
  ],
  items: [
    {
      id: "plan-item",
      topic: "Boundary testing",
      rationale: "Both reports missed edge cases.",
      action: "Write boundary tests for a validator.",
      completed: false,
      sources: [{ interviewId: "report-1", answerId: "answer-1" }],
    },
  ],
  createdAt: "2026-10-20T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
};

it("creates a plan from selected completed reports and renders sourced practice actions", async () => {
  vi.spyOn(Api, "getHistory").mockResolvedValue([report("report-1"), report("report-2")]);
  vi.spyOn(Api, "createStudyPlan").mockResolvedValue(plan);
  vi.spyOn(Api, "getStudyPlans").mockResolvedValue({ items: [plan] });
  const client = open();
  const checks = await screen.findAllByRole("checkbox");
  fireEvent.click(checks[0]!);
  fireEvent.click(checks[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Generate study plan" }));
  expect(await screen.findByText("Both reports missed edge cases.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Start targeted practice" })).toHaveAttribute(
    "href",
    expect.stringContaining("practiceTopic"),
  );
  expect(Api.createStudyPlan).toHaveBeenCalledWith(["report-1", "report-2"]);
  client.clear();
});

it("persists plan-item completion and exposes regenerate and delete actions", async () => {
  const completed = { ...plan, items: [{ ...plan.items[0]!, completed: true }] };
  const listing = vi
    .spyOn(Api, "getStudyPlans")
    .mockResolvedValueOnce({ items: [plan] })
    .mockResolvedValueOnce({ items: [completed] })
    .mockResolvedValueOnce({ items: [plan] })
    .mockResolvedValue({ items: [] });
  vi.spyOn(Api, "updateStudyPlanItem").mockResolvedValue(completed);
  vi.spyOn(Api, "regenerateStudyPlan").mockResolvedValue(plan);
  vi.spyOn(Api, "deleteStudyPlan").mockResolvedValue(undefined);
  const client = open();
  const checkbox = await screen.findByRole("checkbox", { name: /1\. Boundary testing/ });
  fireEvent.click(checkbox);
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: /1\. Boundary testing/ })).toBeChecked(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));
  await waitFor(() => expect(Api.regenerateStudyPlan).toHaveBeenCalledWith("plan"));
  fireEvent.click(screen.getByRole("button", { name: "Delete plan" }));
  await screen.findByText("Your generated plans will appear here.");
  expect(Api.deleteStudyPlan).toHaveBeenCalledWith("plan");
  expect(listing).toHaveBeenCalled();
  client.clear();
});

it("explains the empty report state and surfaces insufficient-history feedback", async () => {
  vi.spyOn(Api, "getHistory").mockResolvedValue([]);
  const client = open();
  expect(await screen.findByText(/No completed reports yet/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Generate study plan" })).toBeNull();
  client.clear();
  cleanup();

  vi.restoreAllMocks();
  vi.spyOn(Api, "getHistory").mockResolvedValue([report("report-1"), report("report-2")]);
  vi.spyOn(Api, "getStudyQuestions").mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  vi.spyOn(Api, "getStudyPlans").mockResolvedValue({ items: [] });
  vi.spyOn(Api, "createStudyPlan").mockRejectedValue(
    new Error("Complete and score more answers first."),
  );
  const retryClient = open();
  const checks = await screen.findAllByRole("checkbox");
  fireEvent.click(checks[0]!);
  fireEvent.click(checks[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Generate study plan" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Complete and score more answers first.",
  );
  retryClient.clear();
});

it.each([true, false])(
  "shows a new-results notice only for newer compatible completions: %s",
  async (compatible) => {
    const newer = {
      ...report("new-report"),
      endedAt: "2026-10-22T01:00:00Z",
      setup: {
        ...report("new-report").setup,
        role: compatible ? ("QA Engineer" as const) : ("Frontend Developer" as const),
      },
    };
    vi.spyOn(Api, "getHistory").mockResolvedValue([report("report-1"), report("report-2"), newer]);
    vi.spyOn(Api, "getStudyQuestions").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    vi.spyOn(Api, "getStudyPlans").mockResolvedValue({ items: [plan] });
    const create = vi.spyOn(Api, "createStudyPlan");
    const regenerate = vi.spyOn(Api, "regenerateStudyPlan");
    const client = open();
    await screen.findByText(/Plans stay unchanged when new results arrive/);
    await screen.findByRole("combobox", { name: "Comparison group" });
    if (compatible)
      expect(await screen.findByText(/New completed reports are available/)).toBeVisible();
    else expect(screen.queryByText(/New completed reports are available/)).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(regenerate).not.toHaveBeenCalled();
    expect(screen.getByText(/A practice area must recur in at least two/)).toBeVisible();
    client.clear();
  },
);
