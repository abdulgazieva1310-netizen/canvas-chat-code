import { expect, test, type Page } from "@playwright/test";

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(`${name}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('journey-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function start(page: Page, mode = 'Practice') {
  await page.goto('/setup');
  for (const name of ['Behavioral', 'QA Engineer', 'Junior', mode, 'Text', '5']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start interview', exact: true }).click();
  await expect(page).toHaveURL(/interview\?interviewId=/);
  return new URL(page.url()).searchParams.get('interviewId')!;
}

async function answer(page: Page, number: number) {
  await page.getByRole('textbox', { name: 'Your answer' }).fill(`I defined the goal, tested the risk, and measured the result for example ${number}.`);
  const response = page.waitForResponse(r => r.url().endsWith('/messages') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const result = await response;
  expect(result.ok()).toBeTruthy();
  return result.json();
}

function assertPrivate(data: any) {
  expect(data.lastFeedback).toBeNull();
  expect(data.lastAnswerFeedback).toBeNull();
  expect(JSON.stringify(data)).not.toContain('FIXTURE_FEEDBACK');
}

test('register, complete five questions, reload saved results/history, delete', async ({ page }) => {
  await register(page, 'complete');
  const id = await start(page);
  for (let n = 1; n <= 5; n++) {
    const data = await answer(page, n);
    expect(data.answeredCount).toBe(n);
    if (n < 5) await expect(page.getByText(`Fixture question ${n + 1}:`, { exact: false })).toBeVisible();
  }
  await expect(page).toHaveURL(/report\?interviewId=/);
  await page.reload();
  await expect(page.getByText(/5 of 5 questions · complete/)).toBeVisible();
  await expect(page.getByText('FIXTURE_FEEDBACK: concrete example').first()).toBeVisible();
  await page.goto('/history');
  // The shell's History route currently delegates saved sessions to Dashboard.
  await page.getByRole('link', { name: 'View saved interviews' }).click();
  await page.reload();
  const saved = page.getByRole('link').filter({ hasText: 'QA Engineer · Behavioral' });
  await expect(saved).toBeVisible();
  await saved.click();
  await expect(page).toHaveURL(new RegExp(`report\\?interviewId=${id}`));
  await page.goto('/');
  await page.getByRole('button', { name: /Delete QA Engineer session/ }).click();
  await expect(page.getByText('No saved sessions yet.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('No saved sessions yet.')).toBeVisible();
});

test('early end retains partial results', async ({ page }) => {
  await register(page, 'partial');
  await start(page);
  await answer(page, 1);
  await page.getByRole('button', { name: 'End interview', exact: true }).click();
  await expect(page).toHaveURL(/report\?interviewId=/);
  await page.reload();
  await expect(page.getByText(/1 of 5 questions · incomplete/)).toBeVisible();
  await expect(page.getByText('FIXTURE_FEEDBACK: concrete example').first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Incomplete', { exact: true })).toBeVisible();
});

test('Real mode hides feedback in responses and UI until ending', async ({ page }) => {
  await register(page, 'real');
  const id = await start(page, 'Real Interview');
  const data = await answer(page, 1);
  assertPrivate(data);
  expect(() => assertPrivate({ ...data, lastAnswerFeedback: { went_well: 'FIXTURE_FEEDBACK' } })).toThrow();
  await expect(page.getByText('Last answer', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/FIXTURE_FEEDBACK/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask for a hint' })).toHaveCount(0);
  await page.reload();
  const saved = await page.evaluate(async ({ api, id }) => {
    const result = await fetch(`${api}/interviews/${id}`, { credentials: 'include' });
    return result.json();
  }, { api: process.env.JOURNEY_API!, id });
  assertPrivate(saved);
  const report = await page.evaluate(async ({ api, id }) => (await fetch(`${api}/interviews/${id}/report`, { credentials: 'include' })).status,
    { api: process.env.JOURNEY_API!, id });
  expect(report).toBe(409);
  await page.getByRole('button', { name: 'End interview', exact: true }).click();
  await expect(page).toHaveURL(/report\?interviewId=/);
  await expect(page.getByText('FIXTURE_FEEDBACK: concrete example').first()).toBeVisible();
});
