import { expect, test } from "../frontend/node_modules/@playwright/test/index";
import { endInterview, registerAccount, removeAccount, startInterview } from "./helpers";

test("Python coding setup loads Monaco and stores source code in the report", async ({ page }) => {
  const account = await registerAccount(page, "coding");
  try {
    const interviewId = await startInterview(page, {
      type: "Technical",
      role: "Python Developer",
    });
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 30_000 });
    const code = "def solution(nums, target):\n    return [0, 1]\n";
    const editor = page.getByRole("textbox", { name: "Code answer" });
    await expect(editor).toBeVisible();
    await editor.fill(code);

    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${interviewId}/messages` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect((await responsePromise).status()).toBe(200);
    await endInterview(page, interviewId);

    const reportCode = page.locator("pre").filter({ hasText: "def solution(nums, target)" });
    await expect(reportCode).toBeVisible();
    await expect(reportCode).toContainText("return [0, 1]");
  } finally {
    await removeAccount(page, account);
  }
});
