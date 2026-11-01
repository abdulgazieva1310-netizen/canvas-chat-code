import { expect, test } from "../frontend/node_modules/@playwright/test/index";
import { endInterview, registerAccount, removeAccount, startInterview, submitTextAnswer } from "./helpers";

test("text interview accepts an answer, advances, and can end with a saved report", async ({
  page,
}) => {
  const account = await registerAccount(page, "text-flow");
  try {
    const interviewId = await startInterview(page);
    const result = await submitTextAnswer(
      page,
      interviewId,
      "I defined the risk, tested the boundary cases, and recorded the result.",
    );
    expect(result.answeredCount).toBe(1);
    await expect(page.getByText("Fixture question 2:", { exact: false })).toBeVisible();

    await endInterview(page, interviewId);
    await expect(page.getByText(/1 of 5 main questions · incomplete/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Question by question" })).toBeVisible();
  } finally {
    await removeAccount(account);
  }
});

test("voice interview captures a browser speech transcript and saves the spoken answer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const browser = window as any;
    browser.__recognitionInstances = [];
    class TestRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { results: any[] }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        browser.__recognitionInstances.push(this);
      }

      start() {}
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    browser.SpeechRecognition = TestRecognition;
    browser.SpeechSynthesisUtterance = class {
      lang = "";
      voice?: unknown;
      constructor(readonly text: string) {
        browser.__lastSpoken = text;
      }
    };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [{ name: "Journey English", lang: "en-US" }],
        cancel: () => undefined,
        speak: (utterance: { text: string }) => {
          browser.__lastSpoken = utterance.text;
        },
      },
    });
  });

  const account = await registerAccount(page, "voice-flow");
  try {
    const interviewId = await startInterview(page, { input: "Voice" });
    await expect(page.getByRole("button", { name: "Replay question" })).toBeVisible();
    await page.getByRole("button", { name: "Replay question" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__lastSpoken as string))
      .toContain("Fixture question 1");

    const startMicrophone = page.getByRole("button", { name: "Start microphone" });
    await expect(startMicrophone).toBeEnabled();
    await startMicrophone.click();
    await expect(page.getByRole("button", { name: "Stop microphone" })).toBeVisible();
    const spokenAnswer = "I checked the edge cases and confirmed the expected result.";
    await page.evaluate((text) => {
      const recognition = (window as any).__recognitionInstances.at(-1);
      recognition.onresult?.({ results: [[{ transcript: text }]] });
    }, spokenAnswer);
    await expect(page.getByRole("textbox", { name: "Your answer" })).toHaveValue(spokenAnswer);
    await page.getByRole("button", { name: "Stop microphone" }).click();

    const answerPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${interviewId}/messages` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect((await answerPromise).status()).toBe(200);
    await expect(page.getByText("Fixture question 2:", { exact: false })).toBeVisible();
    await endInterview(page, interviewId);

    const savedAnswer = page.locator("pre").filter({ hasText: spokenAnswer });
    await expect(savedAnswer).toBeVisible();
    await expect(savedAnswer).toHaveText(spokenAnswer);
  } finally {
    await removeAccount(account);
  }
});
