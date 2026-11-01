import { expect, test } from "../frontend/node_modules/@playwright/test/index";
import { endInterview, registerAccount, removeAccount, startInterview, submitTextAnswer } from "./helpers";

test("Russian interview continues with a translated English question after Groq is unavailable", async ({
  page,
}) => {
  const account = await registerAccount(page, "russian-fallback");
  try {
    const interviewId = await startInterview(page, { language: "Russian" });
    await expect(
      page.getByText("Расскажите о конкретной ситуации", { exact: false }),
    ).toBeVisible();

    const fallbackPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${interviewId}/next-question` &&
        response.request().method() === "POST",
    );
    const answer = await submitTextAnswer(
      page,
      interviewId,
      "Я проверил граничные случаи и подтвердил ожидаемый результат.",
    );
    expect(answer.answeredCount).toBe(1);
    expect((await fallbackPromise).status()).toBe(200);

    await expect(
      page.getByText("Опишите конкретное решение при тестировании", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("Оригинал вопроса на английском:", { exact: false })).toBeVisible();
    await expect(page.getByText("Fixture question 2:", { exact: false })).toBeVisible();

    await endInterview(page, interviewId);
    await page.getByRole("button", { name: "View full transcript" }).click();
    await expect(
      page.getByText("Опишите конкретное решение при тестировании", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("Fixture question 2:", { exact: false })).toBeVisible();
  } finally {
    await removeAccount(page, account);
  }
});
