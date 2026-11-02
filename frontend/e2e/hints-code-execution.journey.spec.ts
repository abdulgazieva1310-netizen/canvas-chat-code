import { expect, test } from "@playwright/test";
import { apiUrl, endInterview, registerAccount, removeAccount, startInterview } from "./helpers";

test("Practice hints do not submit answers and reviewed code examples show results", async ({
  page,
}) => {
  const account = await registerAccount(page, "hint-code");
  try {
    const practiceId = await startInterview(page);
    const hintResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${practiceId}/hint` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Ask for a hint" }).click();
    expect((await hintResponse).status()).toBe(200);
    await expect(page.getByRole("note", { name: "Interview hint" })).toContainText(
      "Fixture hint: identify the goal first.",
    );
    await expect(page.locator("header")).toContainText("Question 1 / 5");
    expect(
      await page.getByRole("textbox", { name: "Your answer" }).inputValue(),
    ).toBe("");
    await endInterview(page, practiceId);

    const realId = await startInterview(page, { mode: "Real Interview" });
    await expect(page.getByRole("button", { name: "Ask for a hint" })).toHaveCount(0);
    const forbiddenHint = await page.request.post(apiUrl(`/interviews/${realId}/hint`), {
      headers: { Authorization: account.authorization },
    });
    expect(forbiddenHint.status()).toBe(409);
    await endInterview(page, realId);

    const codingId = await startInterview(page, {
      type: "Technical",
      role: "Backend Developer",
    });
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 30_000 });
    const editor = page.getByRole("textbox", { name: "Code answer" });
    const incorrect = "print('wrong')\n";
    await editor.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(incorrect);
    const failedRun = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${codingId}/run` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Run public examples" }).click();
    const failed = await failedRun;
    expect(failed.status()).toBe(200);
    expect(await failed.json()).toMatchObject({ status: "failed", passed: 0, total: 2 });
    await expect(page.getByRole("region", { name: "Code run result" })).toContainText(
      "Public examples failed",
    );
    await expect(editor).toHaveValue(incorrect);

    const correct = [
      "line = input().strip()",
      "pairs = {')': '(', ']': '[', '}': '{'}",
      "stack = []",
      "valid = True",
      "for char in line:",
      "    if char in '([{':",
      "        stack.append(char)",
      "    elif char in pairs:",
      "        if not stack or stack.pop() != pairs[char]:",
      "            valid = False",
      "            break",
      "    else:",
      "        valid = False",
      "        break",
      "print(str(valid and not stack).lower())",
    ].join("\n");
    await editor.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(correct);
    const passedRun = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${codingId}/run` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Run public examples" }).click();
    const passed = await passedRun;
    expect(passed.status()).toBe(200);
    expect(await passed.json()).toMatchObject({ status: "passed", passed: 2, total: 2 });
    await expect(page.getByRole("region", { name: "Code run result" })).toContainText(
      "Public examples passed",
    );

    const send = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${codingId}/messages` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send" }).click();
    expect((await send).status()).toBe(200);
    await endInterview(page, codingId);
    await expect(page.locator("pre").filter({ hasText: "line = input().strip()" })).toContainText(
      "print(str(valid and not stack).lower())",
    );
  } finally {
    await removeAccount(page, account);
  }
});
