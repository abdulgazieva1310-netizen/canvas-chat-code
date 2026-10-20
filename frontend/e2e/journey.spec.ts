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
  await page.reload();
  const saved = page.getByRole('link', { name: 'Open report' });
  await expect(saved).toBeVisible();
  await saved.click();
  await expect(page).toHaveURL(new RegExp(`report\\?interviewId=${id}`));
  await page.goto('/');
  await page.getByRole('button', { name: /Delete QA Engineer session/ }).click();
  await page.getByRole('button', { name: 'Delete interview', exact: true }).click();
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

test('optional 3D interviewer works at desktop and mobile sizes without requesting camera access', async ({ page }) => {
  await page.addInitScript(() => {
    const browserWindow = window as typeof window & { __cameraRequestCount?: number };
    browserWindow.__cameraRequestCount = 0;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;
    const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      value: (...args: Parameters<MediaDevices['getUserMedia']>) => {
        browserWindow.__cameraRequestCount = (browserWindow.__cameraRequestCount ?? 0) + 1;
        return getUserMedia(...args);
      },
    });
  });
  await register(page, 'avatar');
  await start(page);

  const enable = page.getByRole('button', { name: 'Enable 3D interviewer', exact: true });
  await enable.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Leave 3D interviewer' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () =>
    (await page.locator('[data-state="idle"]').count()) +
    (await page.getByText(/3D view is unavailable in this browser/).count()),
  ).toBe(1);
  if (await page.locator('[data-state="idle"]').isVisible()) {
    await expect(page.getByText('Interviewer idle.')).toBeVisible();
  }
  expect(await page.evaluate(() => (window as typeof window & { __cameraRequestCount?: number }).__cameraRequestCount)).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Leave 3D interviewer' }).click();
  await page.getByRole('button', { name: 'Enable 3D interviewer' }).click();
  await expect(page.getByText(/Still avatar shown to respect your reduced-motion setting/)).toBeVisible();
  const mobileLayout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowers: Array.from(document.querySelectorAll('*'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((element) => element.right > window.innerWidth + 1 || element.left < -1)
      .slice(0, 8),
  }));
  expect(mobileLayout.scrollWidth, JSON.stringify(mobileLayout)).toBeLessThanOrEqual(mobileLayout.width);
  expect(await page.evaluate(() => (window as typeof window & { __cameraRequestCount?: number }).__cameraRequestCount)).toBe(0);
});
