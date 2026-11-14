# Development Rules

These rules guide collaborative development and code review for Interview Mirror. Apply them alongside the repository's `AGENTS.md` instructions and relevant documentation in `docs/`.

## Coding Standards

- **Backend:** Use Python 3.11+ with FastAPI. Manage dependencies with `uv`; define them in `backend/pyproject.toml` and keep `backend/uv.lock` current. Follow the existing typing, validation, routing, and test patterns.
- **Frontend:** Use TypeScript and React with the existing Vite/TanStack application structure. Keep components and client logic consistent with neighboring code.
- **Linting and formatting:** The frontend has ESLint (`cd frontend && npm run lint`) and Prettier (`cd frontend && npm run format`) configured. No Ruff or Black configuration is currently present for the backend; follow existing Python style and avoid adding a formatter or linter without configuring it for the project.
- Keep changes focused, readable, and documented when they change user-visible behavior, APIs, configuration, or operations.

## Branching Strategy

- Make changes on a feature or fix branch created from an up-to-date `main` branch. Do not develop directly on `main`.
- Open a Pull Request from the working branch into `main`, describe the change and verification, and address review feedback before merging.
- Keep each branch and Pull Request focused on a coherent change. Avoid force-pushing or rewriting published history.

## Commit Message Guidelines

Use Conventional Commit prefixes and a concise description of the change. Common prefixes include:

- `feat:` for a user-facing feature.
- `fix:` for a bug fix.
- `docs:` for documentation changes.
- `test:` for test-only changes.
- `refactor:`, `build:`, or `chore:` for suitable maintenance changes.

Examples: `feat: add interview history filters`, `fix: preserve answer draft after timeout`, and `docs: document local development rules`.

## Testing Requirements

- Every new feature must include backend pytest coverage for expected behavior and important failure cases, plus Playwright end-to-end coverage for its key user flow. Run the relevant tests locally; the full backend suite is `cd backend && uv run --locked pytest`.
- Run the relevant E2E tests locally and ensure they pass before pushing the branch. The Compose E2E command is `cd frontend && npm run test:e2e:compose`; it requires the Compose app to be running. The full browser journey suite is run in CI with `uv run --locked --project backend python scripts/journey.py`.
- Run the frontend unit tests with `cd frontend && npm test`; run `cd frontend && npm run build` for changes that affect the production build.
- If a test cannot run because a required service or dependency is unavailable, state that clearly in the Pull Request and arrange verification before merge. Do not report unrun checks as passing.

## CI/CD Requirements

- CI must be green before code is merged into `main`. All required checks must pass, including backend tests, frontend tests and build, Docker Compose integration/E2E, and full browser journeys.
- Pull Requests receive checks but do not deploy. A push to `main` triggers deployment only after all required checks pass, as configured in `.github/workflows/checks.yml`.
- Review CI results and resolve failures before requesting or completing a merge.

## Environment Variables

- Never commit secrets, credentials, access tokens, private keys, or production `.env` files to the repository.
- When adding an environment variable, document its purpose and update the appropriate example file (`backend/.env.example` and/or `frontend/.env.example`) with a safe placeholder or non-secret default. Keep real values in local untracked environment files or the relevant deployment secret manager.
- Do not use real provider credentials in automated tests. Prefer deterministic fixtures or stubs.
