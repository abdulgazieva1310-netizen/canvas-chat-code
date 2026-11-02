import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const password = "Journey-E2E-2026!";

export interface Account {
  email: string;
  name: string;
  authorization: string;
}

export function apiUrl(path: string) {
  const base = process.env.JOURNEY_API;
  if (!base) throw new Error("JOURNEY_API must be set for browser journeys");
  return `${base}${path}`;
}

export async function registerAccount(page: Page, label: string): Promise<Account> {
  const email = `${label}-${randomUUID()}@example.com`;
  const name = `E2E ${label}`;
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

export async function removeAccount(page: Page, account: Account) {
  const response = await page.request.delete(apiUrl("/auth/me"), {
    headers: { Authorization: account.authorization },
    data: { password, confirmation: "DELETE" },
  });
  expect(response.status()).toBe(204);
}

export async function startInterview(
  page: Page,
  choices: {
    type?: string;
    role?: string;
    level?: string;
    mode?: string;
    input?: string;
    language?: string;
    questionCount?: string;
  } = {},
) {
  const settings = {
    type: "Behavioral",
    role: "QA Engineer",
    level: "Junior",
    mode: "Practice",
    input: "Text",
    language: "English",
    questionCount: "5",
    ...choices,
  };
  await page.goto("/setup");
  for (const value of Object.values(settings)) {
    await page.getByRole("button", { name: value, exact: true }).click();
  }
  await page.getByRole("button", { name: "Start interview", exact: true }).click();
  await expect(page).toHaveURL(/\/interview\?interviewId=/);
  const id = new URL(page.url()).searchParams.get("interviewId");
  expect(id).toBeTruthy();
  return id!;
}

export async function submitAnswer(page: Page, interviewId: string, text: string) {
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

export async function endInterview(page: Page, interviewId: string) {
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/interviews/${interviewId}/end` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "End interview", exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/report\\?interviewId=${interviewId}`));
}

export async function completeInterview(page: Page) {
  const interviewId = await startInterview(page);
  for (let index = 1; index <= 5; index++) {
    const result = await submitAnswer(
      page,
      interviewId,
      `I clarified the goal, tested the boundary cases, and measured result ${index}.`,
    );
    expect(result.answeredCount).toBe(index);
  }
  await expect(page).toHaveURL(new RegExp(`/report\\?interviewId=${interviewId}`));
  return interviewId;
}
