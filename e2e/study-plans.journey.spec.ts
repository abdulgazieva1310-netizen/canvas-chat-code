import { expect, test } from "../frontend/node_modules/@playwright/test/index";
import { completeInterview, registerAccount, removeAccount } from "./helpers";

test("study plan generation, item completion, persistence, and deletion", async ({ page }) => {
  const account = await registerAccount(page, "study-plan");
  try {
    await completeInterview(page);
    await completeInterview(page);

    await page.goto("/study");
    await expect(page.getByRole("heading", { name: "AI study plans" })).toBeVisible();
    await expect(page.getByText("Select 2–5 completed reports from this group")).toBeVisible();
    const reportChoices = page.getByRole("group", {
      name: "Select 2–5 completed reports from this group",
    });
    await reportChoices.getByRole("checkbox").nth(0).check();
    await reportChoices.getByRole("checkbox").nth(1).check();

    const createPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/study-plans" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Generate study plan", exact: true }).click();
    const created = await createPromise;
    expect(created.status()).toBe(201);
    const plan = page.locator('article[aria-label="Study plan for QA Engineer"]');
    await expect(plan).toBeVisible();
    await expect(plan.getByText("Boundary testing", { exact: true })).toBeVisible();
    await expect(plan.getByRole("link", { name: "review answer in source report" }).first()).toBeVisible();

    const item = plan.getByRole("checkbox").first();
    const completionPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.includes("/items/") &&
        response.request().method() === "PATCH",
    );
    await item.check();
    expect((await completionPromise).status()).toBe(200);
    await page.reload();
    const persistedPlan = page.locator('article[aria-label="Study plan for QA Engineer"]');
    await expect(persistedPlan.getByRole("checkbox").first()).toBeChecked();

    const deletePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/api/study-plans/") &&
        response.request().method() === "DELETE",
    );
    await persistedPlan.getByRole("button", { name: "Delete plan", exact: true }).click();
    expect((await deletePromise).status()).toBe(204);
    await expect(persistedPlan).toHaveCount(0);
    await expect(page.getByText("Your generated plans will appear here.")).toBeVisible();
  } finally {
    await removeAccount(page, account);
  }
});
