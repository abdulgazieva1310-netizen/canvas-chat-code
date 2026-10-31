import { randomUUID } from "node:crypto";
import { expect, test } from "../frontend/node_modules/@playwright/test/index.mjs";

const baseURL = process.env.COMPOSE_APP_URL ?? "http://localhost:8100";
const password = "ComposeE2e2026!";

test("register, log in, complete an interview answer, and review its report", async ({ page }) => {
  const email = `compose-e2e-${randomUUID()}@example.com`;
  const name = "Compose E2E Candidate";
  let authorization: string | undefined;

  try {
    await page.goto("/register");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const registrationResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/auth/register",
    );
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    const registrationResponse = await registrationResponsePromise;
    expect(registrationResponse.status()).toBe(201);
    authorization = registrationResponse.headers()["authorization"];
    expect(authorization).toMatch(/^Bearer\s+\S+/);
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Logout", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const loginResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/auth/login",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(200);
    authorization = loginResponse.headers()["authorization"];
    expect(authorization).toMatch(/^Bearer\s+\S+/);
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/setup");
    for (const choice of ["Behavioral", "QA Engineer", "Junior", "Practice", "Text", "5"]) {
      await page.getByRole("button", { name: choice, exact: true }).click();
    }
    await page.getByRole("button", { name: "Start interview", exact: true }).click();
    await expect(page).toHaveURL(/\/interview\?interviewId=/);
    const interviewId = new URL(page.url()).searchParams.get("interviewId");
    expect(interviewId).toBeTruthy();

    const answerText = "I clarified the goal, compared options, and measured the result.";
    await page.getByRole("textbox", { name: "Your answer" }).fill(answerText);
    const answerResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/interviews/${interviewId}/messages` &&
      response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const answerResponse = await answerResponsePromise;
    expect(answerResponse.status()).toBe(200);
    expect((await answerResponse.json()).answeredCount).toBe(1);

    const endResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/interviews/${interviewId}/end` &&
      response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "End interview", exact: true }).click();
    expect((await endResponsePromise).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/report\\?interviewId=${interviewId}`));
    await expect(page.getByText(/1 of 5 main questions · incomplete/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Question by question" })).toBeVisible();
    await page.getByRole("button", { name: /Question 1/ }).click();
    await expect(page.getByText(answerText, { exact: true })).toBeVisible();
  } finally {
    if (!authorization) {
      const relogin = await page.request.post(`${baseURL}/api/auth/login`, {
        data: { email, password },
      });
      authorization = relogin.headers()["authorization"];
    }
    if (authorization) {
      let deleted = await page.request.delete(`${baseURL}/api/auth/me`, {
        headers: { Authorization: authorization },
        data: { password, confirmation: "DELETE" },
      });
      if (deleted.status() === 401) {
        const relogin = await page.request.post(`${baseURL}/api/auth/login`, {
          data: { email, password },
        });
        authorization = relogin.headers()["authorization"];
        if (authorization) {
          deleted = await page.request.delete(`${baseURL}/api/auth/me`, {
            headers: { Authorization: authorization },
            data: { password, confirmation: "DELETE" },
          });
        }
      }
      expect(deleted.status()).toBe(204);
    }
  }
});
