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
    else if (path === "/api/interviews") body = [complete, active];
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
      await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/history$/);
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
