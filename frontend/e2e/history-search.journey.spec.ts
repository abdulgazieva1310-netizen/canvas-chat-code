import { expect, test } from "@playwright/test";
import {
  apiUrl,
  completeInterview,
  registerAccount,
  removeAccount,
} from "./helpers";

test("history filters, searches transcripts, preserves URL state, and paginates", async ({ page }) => {
  test.setTimeout(120_000);
  const account = await registerAccount(page, "history-search");
  try {
    const completedId = await completeInterview(page);
    const setup = (index: number) => ({
      role: index % 2 ? "Python Developer" : "QA Engineer",
      level: "Junior",
      mode: "Practice",
      questionCount: 5,
      type: index % 2 ? "Technical" : "Behavioral",
      input: "Text",
      language: "English",
      jobDescription: index === 0 ? "targeted practice calibration" : "ordinary interview",
    });
    for (let index = 0; index < 21; index += 1) {
      const created = await page.request.post(apiUrl("/interviews"), {
        headers: { Authorization: account.authorization },
        data: setup(index),
      });
      expect(created.status()).toBe(201);
      const interview = (await created.json()) as { id: string };
      const ended = await page.request.post(apiUrl(`/interviews/${interview.id}/end`), {
        headers: { Authorization: account.authorization },
      });
      expect(ended.status()).toBe(200);
    }

    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "Interview History" })).toBeVisible();
    await expect(page.getByText(/Page 1 of 2 · 22 sessions/)).toBeVisible();

    await page.getByRole("combobox", { name: "Role" }).selectOption("QA Engineer");
    await expect(page).toHaveURL(/role=QA(%20|\+)Engineer/);
    await expect(page.getByText(/sessions/)).toBeVisible();
    await page.getByRole("combobox", { name: "Interview type" }).selectOption("Behavioral");
    await expect(page).toHaveURL(/type=Behavioral/);
    await expect(page.getByText("QA Engineer · Behavioral").first()).toBeVisible();
    await expect(page.getByText("Python Developer · Technical")).toHaveCount(0);

    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Start date (UTC)").fill(today);
    await page.getByLabel("End date (UTC)").fill(today);
    await page.getByLabel("Minimum score").fill("7");
    await page.getByLabel("Maximum score").fill("8");
    await expect(page).toHaveURL(/startDate=/);
    await expect(page).toHaveURL(/endDate=/);
    await expect(page).toHaveURL(/minScore=7/);
    await expect(page).toHaveURL(/maxScore=8/);
    await expect(page.getByText(`QA Engineer · Behavioral`, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/Page 1 of 1 · 1 sessions/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Start date (UTC)")).toHaveValue(today);
    await expect(page.getByLabel("Minimum score")).toHaveValue("7");

    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("combobox", { name: "Search in" }).selectOption("setup");
    await page.getByLabel("Search role or job description").fill("targeted practice calibration");
    await expect(page.getByText("QA Engineer · Behavioral").first()).toBeVisible();
    await expect(page.getByText("Python Developer · Technical")).toHaveCount(0);

    await page.getByRole("combobox", { name: "Search in" }).selectOption("transcript");
    const transcriptSearchRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/interviews" && url.searchParams.get("searchMode") === "transcript") {
        transcriptSearchRequests.push(url.searchParams.get("search") ?? "");
      }
    });
    await page.getByLabel("Search questions and answers").fill("boundary cases");
    await expect(page.getByRole("list", { name: /Transcript matches/ }).first()).toBeVisible();
    await expect(page).toHaveURL(/searchMode=transcript/);
    expect(transcriptSearchRequests).toContain("boundary cases");
    const requestsBeforeShortSearch = transcriptSearchRequests.length;
    await page.getByLabel("Search questions and answers").fill("x");
    await expect(page.getByRole("status")).toContainText(
      "Enter at least 2 characters to search transcript questions and answers.",
    );
    expect(transcriptSearchRequests).toHaveLength(requestsBeforeShortSearch);
    await page.getByRole("button", { name: "Clear filters" }).click();

    await expect(page.getByText(/Page 1 of 2 · 22 sessions/)).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/Page 2 of 2 · 22 sessions/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(page.getByText(/Page 1 of 2 · 22 sessions/)).toBeVisible();
    expect(completedId).toBeTruthy();
  } finally {
    await removeAccount(page, account);
  }
});
