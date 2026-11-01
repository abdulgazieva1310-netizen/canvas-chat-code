import { randomUUID } from "node:crypto";
import { expect, type Page } from "../frontend/node_modules/@playwright/test/index";

export const password = "ComposeE2e2026!";

export interface TestAccount {
  email: string;
  name: string;
  authorization: string;
}

export async function registerAccount(page: Page, label: string): Promise<TestAccount> {
  const email = `journey-${label}-${randomUUID()}@example.com`;
  const name = `Journey ${label.replaceAll("-", " ")} Candidate`;
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/auth/register",
  );
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const authorization = response.headers()["authorization"];
  expect(authorization).toMatch(/^Bearer\s+\S+/);
  await expect(page).toHaveURL(/\/$/);
  return { email, name, authorization: authorization! };
}

export async function removeAccount(page: Page, account: TestAccount) {
  const base = process.env.JOURNEY_API ?? `${process.env.JOURNEY_ORIGIN ?? "http://127.0.0.1:4173"}/api`;
  let authorization = account.authorization;
  let response = await page.request.delete(`${base}/auth/me`, {
    headers: { Authorization: authorization },
    data: { password, confirmation: "DELETE" },
  });
  if (response.status() === 401) {
    const login = await page.request.post(`${base}/auth/login`, {
      data: { email: account.email, password },
    });
    authorization = login.headers()["authorization"] ?? "";
    if (authorization) {
      response = await page.request.delete(`${base}/auth/me`, {
        headers: { Authorization: authorization },
        data: { password, confirmation: "DELETE" },
      });
    }
  }
  expect(response.status()).toBe(204);
}

export interface InterviewChoices {
  type?: "Technical" | "Behavioral" | "Role-specific";
  role?: string;
  level?: "Junior" | "Middle" | "Senior";
  mode?: "Practice" | "Real Interview";
  input?: "Text" | "Voice";
  language?: "English" | "Russian";
  questionCount?: "5" | "10" | "15";
}

export async function startInterview(page: Page, choices: InterviewChoices = {}) {
  const selection = {
    type: "Behavioral",
    role: "QA Engineer",
    level: "Junior",
    language: "English",
    mode: "Practice",
    input: "Text",
    questionCount: "5",
    ...choices,
  };
  await page.goto("/setup");
  for (const choice of Object.values(selection)) {
    await page.getByRole("button", { name: choice, exact: true }).click();
  }
  await page.getByRole("button", { name: "Start interview", exact: true }).click();
  await expect(page).toHaveURL(/\/interview\?interviewId=/);
  const interviewId = new URL(page.url()).searchParams.get("interviewId");
  expect(interviewId).toBeTruthy();
  return interviewId!;
}

export async function submitTextAnswer(page: Page, interviewId: string, text: string) {
  await page.getByRole("textbox", { name: "Your answer" }).fill(text);
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/interviews/${interviewId}/messages` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ answeredCount: number; status: string }>;
}

export async function completeInterview(page: Page, choices: InterviewChoices = {}) {
  const questionCount = Number(choices.questionCount ?? "5");
  const interviewId = await startInterview(page, choices);
  for (let index = 1; index <= questionCount; index += 1) {
    const result = await submitTextAnswer(
      page,
      interviewId,
      `I clarified the goal, tested the boundary cases, and measured result ${index}.`,
    );
    expect(result.answeredCount).toBe(index);
  }
  await expect(page).toHaveURL(new RegExp(`/report\\?interviewId=${interviewId}`));
  return interviewId;
}

export async function endInterview(page: Page, interviewId: string) {
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/interviews/${interviewId}/end` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "End interview", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/report\\?interviewId=${interviewId}`));
}
