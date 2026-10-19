import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const [origin, api, output] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(origin + '/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.com');
  await page.getByLabel('Password', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(origin + '/');
  const record = await page.evaluate(async (base) => {
    const login = await fetch(base + '/auth/login', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@example.com', password: 'demo-password' }),
    });
    if (!login.ok) throw new Error('Browser login failed');
    const authorization = login.headers.get('Authorization');
    const me = await fetch(base + '/auth/me', { credentials: 'include' });
    if (!me.ok) throw new Error('Cookie session failed');
    const interview = await fetch(base + '/interviews', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'Python Developer', level: 'Junior', mode: 'Practice',
        questionCount: 5, type: 'Technical', input: 'Text', language: 'English',
        jobDescription: 'Deployment persistence check' }),
    });
    if (interview.status !== 201) throw new Error('Browser interview creation failed');
    return { id: (await interview.json()).id, authorization };
  }, api);
  await page.reload();
  const status = await page.evaluate(async (base) => (await fetch(base + '/auth/me', { credentials: 'include' })).status, api);
  if (status !== 200) throw new Error('Cookie lost after page reload');
  writeFileSync(output, JSON.stringify(record), { mode: 0o600 });
} finally {
  await browser.close();
}
