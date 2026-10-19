# Deterministic browser journeys

Install dependencies with `cd backend && uv sync --locked` and
`cd frontend && npm ci`. Install Chromium with
`cd frontend && npx playwright install chromium`; on Linux, install required
system libraries with `npx playwright install-deps chromium`.

From the repository root:

```sh
uv run --project backend python scripts/journey.py
```

The runner builds the production Node frontend with an isolated API URL, starts
FastAPI with `backend/tests/journey_app.py`, and runs three Chromium scenarios:

- Register, configure a five-question text interview, answer all five, reload
  saved feedback, traverse History's link to Dashboard, reopen results, and delete.
- Answer once and end early, then reload partial results and check Incomplete.
- Answer in Real Interview mode, check null feedback in both answer and saved
  responses, absent live feedback/hints in the UI, denial of the active report,
  and visible feedback after ending. The test injects a deliberately leaked field
  into the privacy assertion and verifies that the assertion rejects it.

The test-only ASGI entry provides deterministic questions, evaluation and hints;
AI_API_KEY is blank, email uses the local adapter, and each run gets a temporary
SQLite database. Each scenario registers its own user. Tests exercise real HTTP,
browser cookies and CORS. No browser API mocks replace the backend. Both server
processes and temporary data are cleaned up even when a scenario fails.

Failures retain Playwright traces, screenshots and videos in
`frontend/test-results/`, with an HTML report in `frontend/playwright-report/`.
Server logs are saved in `frontend/journey-servers.log`. View reports using
`cd frontend && npx playwright show-report` and traces using
`npx playwright show-trace <trace.zip>`. Artifacts are ignored by Git.
The separate navigation fixture suite still runs via `npx playwright test`
using `playwright.config.ts`; journey coverage uses its own configuration.

For environments where Chromium libraries are provided in an isolated directory,
prefix the invocation with `LD_LIBRARY_PATH=/path/to/libraries`. Local QA used
packages extracted under `/tmp/interview-browser-libs/extracted/usr/lib/x86_64-linux-gnu`
because sudo authentication was unavailable. This path is environment-specific.
