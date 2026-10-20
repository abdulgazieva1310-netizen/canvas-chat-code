import { expect, test } from "@playwright/test";

const setup = {
  role: "QA Engineer",
  level: "Middle",
  mode: "Practice",
  questionCount: 5,
  type: "Role-specific",
  input: "Text",
  language: "English",
};
const complete = {
  id: "complete",
  setup,
  status: "complete",
  startedAt: "2026-10-19T10:00:00Z",
  endedAt: "2026-10-19T10:10:00Z",
  answeredCount: 5,
  messages: [],
  lastFeedback: null,
};
const active = { ...complete, id: "active", status: "active", endedAt: null, answeredCount: 0 };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === "/api/auth/me")
      body = {
        id: "user",
        name: "Candidate",
        email: "candidate@example.com",
        targetRole: "QA Engineer",
        level: "Middle",
        preferredLanguage: "English",
      };
    else if (path === "/api/dashboard/summary")
      body = { completedCount: 1, recentActivity: [complete], groups: [], strengths: [], weaknesses: [], suggestions: [] };
    else if (path === "/api/interviews")
      body = { items: [complete, active], total: 2, page: 1, pageSize: 20 };
    else if (path.endsWith("/media"))
      body = { retentionDays: 30, media: [] };
    else if (path.endsWith("/report"))
      body = {
        interview: complete,
        feedback: {
          interviewId: complete.id,
          overall: null,
          scores: null,
          strengths: [],
          gaps: [],
          questions: [],
        },
      };
    else body = active;
    await route.fulfill({ json: body });
  });
});

for (const width of [375, 1280]) {
  test(`keyboard navigation, refresh, and back at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await expect(navigation).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    for (const [label, path] of [
      ["Setup", "/setup"],
      ["Lobby", "/ready"],
      ["Interview", "/interview"],
      ["Report", "/report"],
      ["History", "/history"],
      ["Profile", "/profile"],
    ]) {
      const link = navigation.getByRole("link", { name: label, exact: true });
      await link.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(link).toBeFocused();
      expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
        "none",
      );
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`));
      if (path === "/interview") {
        await expect(page.getByRole("button", { name: "End interview" })).toBeVisible();
        await page.goBack();
        continue;
      }
      await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/history(\?|$)/);
    await expect(page.getByRole("heading", { name: "Interview History" })).toBeVisible();
    await page.screenshot({ path: `test-results/navigation-${width}.png`, fullPage: true });
  });
}

test("authentication and recovery links remain reachable", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Interview Mirror" })).toBeVisible();
  await page.getByRole("link", { name: "Create an account", exact: true }).click();
  await expect(page).toHaveURL(/\/register/);
  await page.getByRole("link", { name: "Already have an account? Sign in" }).click();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await page.goto("/reset-password?token=test-link");
  await expect(page.getByRole("heading", { name: /password/i })).toBeVisible();
});

test("private evaluation feedback can be saved, edited, and removed", async ({ page }) => {
  await page.route("**/api/interviews/complete/report", (route) => route.fulfill({ json: {
    interview: complete,
    feedback: { interviewId: complete.id, answeredQuestions: 1, selectedQuestions: 5, overall: 7,
      scores: { accuracy: 7, completeness: 7, clarity: 7, structure: 7 }, strengths: [], gaps: [],
      questions: [{ questionId: "question", answerId: "answer", q: "Question?", answer: "Answer",
        score: 7, good: "Good", miss: "Missing", better: "Better" }] },
  } }));
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/interviews/complete/answers/answer/feedback", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: saved ?? {
      answerId: "answer", rating: null, category: null, comment: null, updatedAt: null, provenanceStatus: "unknown",
    } });
    if (route.request().method() === "PUT") {
      saved = { answerId: "answer", ...route.request().postDataJSON(), updatedAt: new Date().toISOString(), provenanceStatus: "unknown" };
      return route.fulfill({ json: saved });
    }
    saved = null;
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/report?interviewId=complete");
  await expect(page.getByRole("button", { name: "Needs review" })).toBeVisible();
  await page.getByRole("button", { name: "Needs review" }).click();
  await page.getByLabel("Category").selectOption("incorrect");
  await page.getByLabel(/Comment/).fill("The rationale did not match my answer.");
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Feedback saved." })).toBeVisible();
  expect(saved).toMatchObject({ rating: "needs_review", category: "incorrect", comment: "The rationale did not match my answer." });
  await page.getByRole("button", { name: "Remove feedback" }).click();
  await expect(page.getByRole("button", { name: "Save feedback" })).toBeDisabled();
  expect(saved).toBeNull();
});

for (const width of [375, 1280]) {
  test(`saved report comparison is readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:900});
    await page.route("**/api/interviews/*/report",async route=>{
      const id=new URL(route.request().url()).pathname.split("/").at(-2)!;
      await route.fulfill({json:{interview:{...complete,id,status:"incomplete",answeredCount:1},feedback:{interviewId:id,overall:id==="one" ? 7:8,scores:{accuracy:id==="one" ? 7:8,completeness:null,clarity:6,structure:null},strengths:["Clear explanation"],gaps:["Explain trade-offs"],questions:[]}}});
    });
    await page.goto("/compare?first=one&second=two");
    await expect(page.getByRole("heading",{name:"Compare saved reports"})).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const link=page.getByRole("link",{name:"Review full report 1"});
    await link.focus();await expect(link).toBeFocused();
    await page.reload();await expect(page.getByRole("table")).toBeVisible();
  });
}
