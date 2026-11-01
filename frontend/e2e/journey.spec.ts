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
  await expect(page.getByText(/5 of 5 main questions · complete/)).toBeVisible();
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
  await expect(page.getByText(/1 of 5 main questions · incomplete/)).toBeVisible();
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

test('downloads a private-safe calendar reminder that returns to Setup without starting an interview', async ({ page }) => {
  await register(page, 'calendar');
  let starts = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/api/interviews') && request.method() === 'POST') starts++;
  });
  await page.goto('/setup?role=QA+Engineer&interviewType=Behavioral&level=Junior&language=Russian');
  await page.getByLabel('Local date and time').fill('2030-05-06T14:30');
  await page.getByLabel('Time zone').selectOption('UTC');
  await page.getByLabel('Duration').selectOption('45');
  const downloadPromise = page.waitForEvent('download');
  const downloadButton = page.getByRole('button', { name: 'Download calendar reminder' });
  await downloadButton.focus();
  await page.keyboard.press('Enter');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^interview-practice-2030-05-06\.ics$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const content = Buffer.concat(chunks).toString('utf8');
  const unfolded = content.replace(/\r\n /g, '');
  expect(unfolded).toContain('BEGIN:VCALENDAR');
  expect(unfolded).toContain('BEGIN:VEVENT');
  expect(unfolded).toContain('END:VEVENT');
  expect(unfolded).toContain('END:VCALENDAR');
  expect(unfolded).toContain('DTSTART:20300506T143000Z');
  expect(unfolded).toContain('DTEND:20300506T151500Z');
  expect(unfolded).toContain('SUMMARY:Interview practice reminder');
  expect(unfolded).not.toMatch(/transcript|score|email|job description|bearer|token/i);
  const setupLink = unfolded.match(/^URL:(.*)$/m)?.[1];
  expect(setupLink).toBeTruthy();
  const setup = new URL(setupLink!);
  expect(setup.pathname).toBe('/setup');
  expect(Object.fromEntries(setup.searchParams)).toEqual({
    role: 'QA Engineer',
    interviewType: 'Behavioral',
    level: 'Junior',
    language: 'Russian',
  });
  expect(starts).toBe(0);

  await page.goto(`${setup.pathname}${setup.search}`);
  await expect(page.getByRole('button', { name: 'Start interview', exact: true })).toBeVisible();
  expect(page.getByRole('button', { name: 'Russian', exact: true })).toHaveAttribute('data-active', 'true');
  expect(starts).toBe(0);
});

test('protected routes redirect to login and cookie-authenticated API mutations require CSRF', async ({ page }) => {
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/profile');

  await register(page, 'csrf');
  const api = process.env.JOURNEY_API!;
  const origin = new URL(process.env.JOURNEY_ORIGIN!).origin;
  const cookies = await page.context().cookies(api);
  const csrfCookie = cookies.find(cookie => cookie.name === 'csrf_token');
  expect(csrfCookie?.value).toBeTruthy();

  const client = page.context().request;
  const profile = await client.get(`${api}/auth/me`);
  expect(profile.status()).toBe(200);
  const current = await profile.json();
  const update = {
    name: 'CSRF Verified Candidate',
    targetRole: current.targetRole,
    level: current.level,
    preferredLanguage: current.preferredLanguage,
    interviewerAvatar: current.interviewerAvatar,
    interviewerVoiceName: current.interviewerVoiceName,
    interviewerVoiceLang: current.interviewerVoiceLang,
  };
  const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };

  const missingToken = await client.patch(`${api}/auth/me`, { headers, data: update });
  expect(missingToken.status()).toBe(403);
  const invalidToken = await client.patch(`${api}/auth/me`, {
    headers: { ...headers, 'X-CSRF-Token': 'invalid-token' },
    data: update,
  });
  expect(invalidToken.status()).toBe(403);
  expect((await (await client.get(`${api}/auth/me`)).json()).name).toBe(current.name);

  const validToken = await client.patch(`${api}/auth/me`, {
    headers: { ...headers, 'X-CSRF-Token': csrfCookie!.value },
    data: update,
  });
  expect(validToken.status()).toBe(200);
  expect((await validToken.json()).name).toBe(update.name);
});

test('password reset link changes password and supports login with the replacement', async ({ page }) => {
  await register(page, 'password-reset');
  const email = 'password-reset@example.com';
  const oldPassword = 'journey-password';
  const newPassword = 'recovered-password-2026';
  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(email);
  const requestPromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/auth/password-reset/request',
  );
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  const resetRequest = await requestPromise;
  expect(resetRequest.status()).toBe(202);
  await expect(page.getByRole('status')).toContainText('Reset request received.');

  const mailbox = await page.context().request.get(
    `${process.env.JOURNEY_API}/__test__/mailbox?email=${encodeURIComponent(email)}`,
  );
  expect(mailbox.status()).toBe(200);
  const messages = (await mailbox.json()).messages as Array<{ link: string }>;
  expect(messages.length).toBe(1);
  const resetUrl = new URL(messages[0]!.link);
  expect(resetUrl.pathname).toBe('/reset-password');
  expect(resetUrl.searchParams.get('token')).toBeTruthy();

  await page.goto(resetUrl.toString());
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
  const confirmPromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/auth/password-reset/confirm',
  );
  await page.getByRole('button', { name: 'Save new password', exact: true }).click();
  const confirmation = await confirmPromise;
  expect(confirmation.status()).toBe(204);
  await expect(page.getByRole('status')).toContainText('Your password has been changed.');
  expect(new URL(page.url()).searchParams.has('token')).toBe(false);

  const reusedToken = await page.context().request.post(`${process.env.JOURNEY_API}/auth/password-reset/confirm`, {
    data: { token: resetUrl.searchParams.get('token'), password: newPassword },
  });
  expect(reusedToken.status()).toBe(400);
  const oldLogin = await page.context().request.post(`${process.env.JOURNEY_API}/auth/login`, {
    data: { email, password: oldPassword },
  });
  expect(oldLogin.status()).toBe(401);

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(newPassword);
  const loginPromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/auth/login',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const login = await loginPromise;
  expect(login.status()).toBe(200);
  expect(login.headers()['authorization']).toMatch(/^Bearer\s+\S+/);
  await expect(page).toHaveURL(/\/$/);
});

test('mobile viewport can configure and start an interview without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await register(page, 'mobile');
  await page.goto('/setup');
  const hasNoHorizontalOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await expect.poll(hasNoHorizontalOverflow).toBe(true);

  for (const choice of ['Behavioral', 'QA Engineer', 'Junior', 'Practice', 'Text', '5']) {
    const control = page.getByRole('button', { name: choice, exact: true });
    await expect(control).toBeVisible();
    await control.click();
  }
  const startPromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/interviews' && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start interview', exact: true }).click();
  expect((await startPromise).status()).toBe(201);
  await expect(page).toHaveURL(/\/interview\?interviewId=/);
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End interview', exact: true })).toBeVisible();
  await expect.poll(hasNoHorizontalOverflow).toBe(true);
});

test('rate-limited password reset requests return 429 without sending more email', async ({ page }) => {
  await register(page, 'rate-limit');
  const email = 'rate-limit@example.com';
  const api = process.env.JOURNEY_API!;
  const client = page.context().request;
  const requestReset = () => client.post(`${api}/auth/password-reset/request`, { data: { email } });

  for (let index = 0; index < 5; index += 1) {
    expect((await requestReset()).status()).toBe(202);
  }
  const limited = await requestReset();
  expect(limited.status()).toBe(429);
  expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0);
  expect(await limited.json()).toMatchObject({ message: 'Too many password reset requests. Try again later.' });
  const mailbox = await client.get(`${api}/__test__/mailbox?email=${encodeURIComponent(email)}`);
  expect((await mailbox.json()).messages).toHaveLength(5);
});

test('long text answers and code blocks survive submission and report rendering', async ({ page }) => {
  await register(page, 'long-answer');
  const interviewId = await start(page);
  const longAnswer = `Long answer boundary. ${'Unicode проверка and detailed reasoning. '.repeat(500)}`.trimEnd();
  await page.getByRole('textbox', { name: 'Your answer' }).fill(longAnswer);
  const textResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/interviews/${interviewId}/messages` &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const textResponse = await textResponsePromise;
  expect(textResponse.status()).toBe(200);
  const textInterview = await textResponse.json();
  expect(textInterview.messages.some((message: { from: string; text: string }) =>
    message.from === 'you' && message.text === longAnswer,
  )).toBe(true);
  await page.getByRole('button', { name: 'End interview', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/report\\?interviewId=${interviewId}`));
  await expect(page.locator('pre').filter({ hasText: longAnswer.slice(0, 100) }).first()).toContainText(longAnswer.slice(-100));

  const codingInterviewId = await startCoding(page);
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
  const longCode = `# long code block saved through the interview answer API\n${'# boundary case\n'.repeat(1500)}`;
  const editor = page.getByRole('textbox', { name: 'Code answer' });
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(longCode);
  const codeResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/interviews/${codingInterviewId}/messages` &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const codeResponse = await codeResponsePromise;
  expect(codeResponse.status()).toBe(200);
  const codeInterview = await codeResponse.json();
  expect(codeInterview.messages.some((message: { from: string; text: string }) =>
    message.from === 'you' && message.text === longCode,
  )).toBe(true);
  await page.getByRole('button', { name: 'End interview', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/report\\?interviewId=${codingInterviewId}`));
  await expect(page.locator('pre').filter({ hasText: longCode.slice(0, 100) }).first()).toContainText(longCode.slice(-100));
});

async function startCoding(page: Page) {
  await page.goto('/setup');
  for (const choice of ['Technical', 'Python Developer', 'Junior', 'Practice', 'Text', '5']) {
    await page.getByRole('button', { name: choice, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start interview', exact: true }).click();
  await expect(page).toHaveURL(/\/interview\?interviewId=/);
  return new URL(page.url()).searchParams.get('interviewId')!;
}
