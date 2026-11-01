import { readFile } from "node:fs/promises";
import { expect, test } from "../frontend/node_modules/@playwright/test/index";
import {
  password,
  registerAccount,
  removeAccount,
  startInterview,
  submitTextAnswer,
} from "./helpers";

test("registration, login, and profile changes persist across reloads", async ({ page }) => {
  const account = await registerAccount(page, "profile");
  try {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Logout", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const loginPromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/login",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const login = await loginPromise;
    expect(login.status()).toBe(200);
    expect(login.headers()["authorization"]).toMatch(/^Bearer\s+\S+/);
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Updated Journey Candidate");
    await page
      .getByRole("combobox", { name: "Target role", exact: true })
      .selectOption("Python Developer");
    await page.getByRole("combobox", { name: "Level", exact: true }).selectOption("Senior");
    await page.getByLabel("Preferred language", { exact: true }).fill("Russian");
    const updatePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/me" &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    expect((await updatePromise).status()).toBe(200);
    await expect(page.getByText("Profile saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Updated Journey Candidate",
    );
    await expect(
      page.getByRole("combobox", { name: "Target role", exact: true }),
    ).toHaveValue("Python Developer");
    await expect(page.getByRole("combobox", { name: "Level", exact: true })).toHaveValue("Senior");
    await expect(page.getByLabel("Preferred language", { exact: true })).toHaveValue("Russian");
  } finally {
    await removeAccount(account);
  }
});

test("account archive downloads as a readable JSON file", async ({ page }) => {
  const account = await registerAccount(page, "account-export");
  try {
    const interviewId = await startInterview(page);
    const answer = "I documented the test result and verified the important edge cases.";
    await submitTextAnswer(page, interviewId, answer);

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Download your account data" })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download account archive" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("interview-mirror-account.json");
    const archivePath = await download.path();
    expect(archivePath).toBeTruthy();

    const archiveText = await readFile(archivePath!, "utf8");
    const archive = JSON.parse(archiveText) as {
      schemaVersion: number;
      exportedAt: string;
      profile: { email: string; name: string };
      interviews: Array<{
        id: string;
        messages: Array<{ text?: string }>;
      }>;
      evaluations: unknown[];
      learningPlan: object;
      studyQuestions: unknown[];
      evaluationFeedback: unknown[];
      jobTargets: unknown[];
      setupPresets: unknown[];
      studyPlans: unknown[];
      media: unknown[];
      mediaBytesIncluded: boolean;
    };

    expect(archive.schemaVersion).toBe(1);
    expect(Number.isNaN(Date.parse(archive.exportedAt))).toBe(false);
    expect(archive.profile).toMatchObject({ email: account.email, name: account.name });
    const exportedInterview = archive.interviews.find((interview) => interview.id === interviewId);
    expect(exportedInterview).toBeDefined();
    expect(exportedInterview?.messages.map((message) => message.text)).toContain(answer);
    expect(archive).toMatchObject({
      evaluations: expect.any(Array),
      learningPlan: expect.any(Object),
      studyQuestions: expect.any(Array),
      evaluationFeedback: expect.any(Array),
      jobTargets: expect.any(Array),
      setupPresets: expect.any(Array),
      studyPlans: expect.any(Array),
      media: expect.any(Array),
      mediaBytesIncluded: false,
    });
    expect(archiveText).not.toContain(password);
    expect(archiveText).not.toContain("password_hash");
  } finally {
    await removeAccount(account);
  }
});
