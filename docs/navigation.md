# Navigation QA

The shared shell links Dashboard, Setup, Lobby, Interview Room, Report, History,
and Profile. Report requires a completed session; without one, it is clearly
disabled. Interview opens an existing active/incomplete session or Setup. Account
pages include login, registration, recovery request, and reset-link completion.
History is a placeholder until issue #29 implements the full page.

On narrow screens the navigation remains visible in a horizontally scrollable
row. Keyboard focus moves links into view; the shell and page do not need to scroll
horizontally. Focus outlines apply to links, buttons, inputs, selects, textareas,
and explicitly focusable elements. Active navigation ignores session query strings.

After `cd frontend && npm ci`, run:

```sh
npm test
npx playwright install chromium
npx playwright test e2e/navigation.spec.ts
```

The browser test starts Vite automatically on port 4173 and intercepts API calls
with deterministic fixtures; no backend credentials are needed. It traverses the
actual links using keyboard Tab/Shift+Tab/Enter at 375px and 1280px, checks visible
focus, selected navigation, direct refresh, back navigation, and page overflow.
Screenshots are written under ignored `frontend/test-results/`.
