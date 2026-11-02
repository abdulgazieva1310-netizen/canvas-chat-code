import { expect, test } from "@playwright/test";
import { endInterview, registerAccount, removeAccount, startInterview, submitAnswer } from "./helpers";

test("saved question note can be created, edited, reloaded, and removed", async ({ page }) => {
  const account = await registerAccount(page, "saved-question");
  try {
    const interviewId = await startInterview(page);
    await submitAnswer(page, interviewId, "I tested boundary cases and measured the result.");
    await endInterview(page, interviewId);

    const save = page.getByRole("button", { name: "Save question for study" }).first();
    const saveResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/study/questions` &&
        response.request().method() === "POST",
    );
    await save.click();
    expect((await saveResponse).status()).toBe(200);
    await expect(page.getByRole("button", { name: "Question saved" }).first()).toBeDisabled();

    await page.goto("/study");
    const question = page.getByRole("listitem").filter({ hasText: "Fixture question 1:" });
    await expect(question).toBeVisible();
    await expect(question.getByRole("link", { name: "Review source report" })).toHaveAttribute(
      "href",
      new RegExp(interviewId),
    );

    const note = question.getByLabel("Private note");
    await note.fill("Recheck empty input and maximum length.");
    const firstSave = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/api/study/questions/") &&
        response.request().method() === "PATCH",
    );
    await question.getByRole("button", { name: "Save note" }).click();
    expect((await firstSave).status()).toBe(200);
    await expect(question.getByRole("status")).toContainText("Note saved.");

    await page.reload();
    const persisted = page.getByRole("listitem").filter({ hasText: "Fixture question 1:" });
    await expect(persisted.getByLabel("Private note")).toHaveValue(
      "Recheck empty input and maximum length.",
    );
    await persisted.getByLabel("Private note").fill("Updated note survives another reload.");
    const update = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/api/study/questions/") &&
        response.request().method() === "PATCH",
    );
    await persisted.getByRole("button", { name: "Save note" }).click();
    expect((await update).status()).toBe(200);
    await page.reload();
    const updated = page.getByRole("listitem").filter({ hasText: "Fixture question 1:" });
    await expect(updated.getByLabel("Private note")).toHaveValue(
      "Updated note survives another reload.",
    );

    const deletion = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/api/study/questions/") &&
        response.request().method() === "DELETE",
    );
    await updated.getByRole("button", { name: "Remove saved question" }).click();
    expect((await deletion).status()).toBe(204);
    await expect(page.getByText("No saved questions on this page.")).toBeVisible();
  } finally {
    await removeAccount(page, account);
  }
});
