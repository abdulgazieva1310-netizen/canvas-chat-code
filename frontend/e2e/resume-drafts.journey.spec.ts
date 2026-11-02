import { expect, test } from "@playwright/test";
import {
  endInterview,
  registerAccount,
  removeAccount,
  startInterview,
  submitAnswer,
} from "./helpers";

test("active interview restores an unsent answer draft and incomplete sessions can resume", async ({
  page,
}) => {
  const account = await registerAccount(page, "resume-draft");
  try {
    const interviewId = await startInterview(page);
    const draft = "Draft answer: I checked edge cases before submitting.";
    await page.getByRole("textbox", { name: "Your answer" }).fill(draft);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(sessionStorage).some((key) =>
            key.startsWith("interview-mirror.answer-draft.v1:"),
          ),
        ),
      )
      .toBe(true);

    let answerPosts = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === `/api/interviews/${interviewId}/messages` &&
        request.method() === "POST"
      ) {
        answerPosts += 1;
      }
    });
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Your answer" })).toHaveValue(draft);
    expect(answerPosts).toBe(0);
    await page.getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "History", exact: true })
      .click();
    await page.getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Interview", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/interview\\?interviewId=${interviewId}`));
    await expect(page.getByRole("textbox", { name: "Your answer" })).toHaveValue(draft);
    expect(answerPosts).toBe(0);

    const submitted = await submitAnswer(page, interviewId, draft);
    expect(submitted.answeredCount).toBe(1);
    expect(answerPosts).toBe(1);
    await expect(page.getByText("Fixture question 2:", { exact: false })).toBeVisible();

    const incompleteId = await startInterview(page);
    await submitAnswer(page, incompleteId, "I saved a partial result to resume later.");
    await endInterview(page, incompleteId);
    await page.goto("/history");
    const incompleteRow = page.locator("li").filter({ hasText: "QA Engineer · Behavioral" }).first();
    await expect(incompleteRow.getByRole("link", { name: "Resume interview" })).toBeVisible();
    const resume = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${incompleteId}/resume` &&
        response.request().method() === "POST",
    );
    await incompleteRow.getByRole("link", { name: "Resume interview" }).click();
    expect((await resume).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/interview\\?interviewId=${incompleteId}`));
    await expect(page.getByRole("button", { name: "End interview" })).toBeEnabled();
  } finally {
    await removeAccount(page, account);
  }
});
