# DevOps Engineering

This document describes the application's container architecture, verification strategy, automated delivery checks, Render alternative, and deployment operations. AWS uses the low-cost EC2 Compose setup in `docs/deployment.md`.

## Docker architecture

### Application image

The root `Dockerfile` builds one deployable image in two stages:

1. **Frontend build:** Node 22 slim installs the locked frontend dependencies with `npm ci` and builds the production frontend with `/api` as its API base URL.
2. **Runtime image:** Python 3.12 slim receives Node from the build stage and uv 0.9.5. It installs the locked backend dependencies without development packages, copies the backend, and copies the frontend's complete Nitro `.output` directory.

The FastAPI process listens on port 8000. It serves the built frontend through its configured Node SSR server on loopback port 3000, so a single image provides both browser UI and API behind one origin. The container command starts Uvicorn on `0.0.0.0:8000`; the image exposes port 8000. Backend Python dependencies are pinned by `backend/uv.lock`; frontend dependencies are pinned by `frontend/package-lock.json`. `.dockerignore` excludes local virtual environments, node modules, built output, test artifacts, local databases, and media storage from the build context.

### Local Compose stack

`docker-compose.yaml` defines:

- **postgres:** PostgreSQL 16 Alpine, with configurable database credentials, a persistent named volume (`interview-canvas-pgdata`), and a `pg_isready` health check.
- **app:** the root Dockerfile image, started after PostgreSQL becomes healthy. The database URL points to the Compose `postgres` service; host port 8100 forwards to container port 8000 on loopback only.
- **caddy:** an optional `aws` profile that serves HTTPS and proxies public traffic to the app. The database remains private; app, media, and Caddy data are persisted in local volumes.

Start the stack with `docker compose up --build`. The named volume preserves the local database across container recreation. Remove it only when intentionally resetting local data (`docker compose down --volumes`). Compose is used for integration and browser E2E verification; Render uses its managed PostgreSQL service instead of running this Compose file.

### Isolated code execution

The optional coding runner is a separate security boundary, not part of the application image. Its gateway runs on a dedicated patched host with Docker Engine access, while executor containers are built from `coding-runner/Dockerfile`. Never mount the Docker socket or host directories into executor containers. The gateway must not share the API host or its secrets. See the Deployment section and `docs/security/coding-runner.md` for setup and threat details.

## Testing strategy

The CI workflow exercises four complementary layers, with AI disabled and local email adapters used where appropriate so automated checks do not depend on provider credentials:

| Layer | Coverage | Main command in CI |
| --- | --- | --- |
| Backend unit and API suite | `backend/tests`, including API behavior, auth, persistence, migrations, validation, and provider integration seams | `uv run --locked --project backend pytest backend/tests` |
| Coding runner unit suite | Gateway and executor behavior | `uv run --locked --project backend python -m pytest coding-runner/test_runner.py` |
| Frontend tests and production build | Vitest component/client tests plus production bundling | `npm test --prefix frontend`; `npm run build --prefix frontend` |
| Compose integration and browser E2E | PostgreSQL/API integration against the running stack plus Chromium browser flow | `backend/tests/integration/test_compose_stack.py`; `npm run test:e2e:compose --prefix frontend` |
| Full product journeys | Browser-driven end-to-end journeys against locally started services | `uv run --locked --project backend python scripts/journey.py` |

The Compose job installs Playwright Chromium with system dependencies, builds and starts the stack, runs integration checks and browser E2E, uploads Playwright artifacts on failure (seven-day retention), and always tears down containers and volumes. The journeys job uploads browser artifacts and server logs when it fails. For local production topology verification, `docs/deployment.md` also documents `scripts/deployment-smoke.py`, which builds the Node frontend and validates login, session persistence, interview creation, and restart persistence using temporary services and storage.

Run the unit suites locally with `cd backend && uv run --locked pytest` and `cd frontend && npm test`. Build the frontend with `cd frontend && npm ci && npm run build`. Compose browser checks require Docker and Chromium; the detailed local deployment smoke instructions are in the Deployment section.

## CI/CD pipeline

The workflow is `.github/workflows/checks.yml` (`Checks`). It runs for pull requests and pushes to `main`, grants read-only repository contents by default, and cancels an earlier run for the same workflow/ref when a newer one starts. Four checks run independently in parallel: backend, frontend, Compose integration/E2E, and full browser journeys. The jobs use Python 3.12, uv with the backend lockfile cache, and Node 22 with the frontend lockfile cache.

Pull requests and pushes to `main` run checks only. AWS deployment is a separate manual CloudFormation operation; pushes do not create or update AWS resources. Failed checks should be resolved before merging. Keep credentials out of CI and source control.

## Render deployment

`render.yaml` is a Render Blueprint for an alternative deployment target. It creates a Docker web service named `interview-mirror-render` in Frankfurt on the free plan, builds the root `Dockerfile`, and creates a managed PostgreSQL 16 database named `interview-mirror-render-db` in the same region. Render injects the database connection string into `DATABASE_URL`, and the service health check uses `/api/health`. The database IP allow list is empty, limiting direct network access.

The Blueprint configures `PORT=8000`, secure cookies, automatic email adapter selection, `openai/gpt-oss-120b` as the model, and disables Russian interviews. `AI_API_KEY` is marked `sync: false`, so supply it privately in the Render dashboard when AI features are wanted; leaving it unset enables the documented deterministic fallback. Review or set any required application variables and credentials in Render before allowing real users. Render's `autoDeployTrigger: checksPass` ties deployment to successful repository checks. The Blueprint provisions the managed database rather than starting `docker-compose.yaml`.

The free plan is suitable for a trial environment, not a guarantee of production availability or durable operational capacity. Review current Render plan limits and persistence/backup behavior before selecting a production plan. Confirm database migrations complete, HTTPS and secure cookies work, and `/api/health` passes after deployment. The endpoint is a liveness check only; it does not prove database, AI provider, or email readiness. Public deployments must set `SEED_DEMO_ACCOUNT=false`.

## Deployment

## AWS EC2 deployment

The current AWS design runs the application and PostgreSQL in Docker Compose on
one `t3.micro` EC2 instance. It uses the existing default VPC, Caddy for HTTPS,
and Systems Manager for host access. It does not create RDS, ECR, a load
balancer, NAT, or Secrets Manager resources. Deployment and cleanup commands,
Free Plan limits, and the public URL lookup are documented in
[`docs/deployment.md`](docs/deployment.md). CI validates code but does not deploy.

Run the frontend SSR server and FastAPI as separate services behind an HTTPS
reverse proxy. Install Python 3.11+ with uv and a Node version compatible with the
locked frontend dependencies (this guide was verified with Node 22).

From `backend`, install and migrate before starting workers:

```sh
uv sync --locked
export DATABASE_URL=sqlite:////srv/interview-mirror/data/interview.db
export SECURE_COOKIES=true
export CORS_ORIGINS=https://interviews.example.com
export EMAIL_ADAPTER=smtp
export PASSWORD_RESET_URL=https://interviews.example.com/reset-password
export SMTP_HOST=smtp.example.com
export SMTP_PORT=587
export SMTP_FROM=accounts@example.com
export SMTP_USERNAME=replace-with-account
export SMTP_PASSWORD=replace-with-secret
export AI_API_KEY=replace-with-groq-key
export AI_MODEL=llama-3.3-70b-versatile
uv run --locked python -m app.migrate
uv run --locked uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Mount `/srv/interview-mirror/data` as durable storage, ensure the service can
write it, and back it up consistently using SQLite's backup API or with writers
stopped. Do not place the database on ephemeral container storage. Run migrations
once per release before traffic; test backup restoration before upgrading.
Application startup also applies pending migrations. Use a single SQLite service
instance; do not share this file across hosts. A different SQLAlchemy URL requires
an appropriate installed driver and deployment validation.

Explicitly consented audio recordings use `INTERVIEW_MEDIA_DIR` (default: `backend/media-storage`).
Set it to a durable private directory outside frontend/static roots, owned by the
API service with mode `0700`; recording files are created with mode `0600`. When
running multiple API workers on one host, point them at the same private mount.
The API accepts audio recordings only; local camera preview video is never uploaded or persisted.
It retains audio recordings for 30 days, removes expired files hourly and when
media is accessed, supports explicit owner deletion, and limits each interview to three
uploads of at most 100 MB each. Include the directory in protected backup and
deletion procedures; do not serve it directly from nginx or the frontend.

From `frontend`, build and serve the Node target:

```sh
npm ci
NITRO_PRESET=node-server VITE_API_BASE_URL=/api npm run build
HOST=127.0.0.1 PORT=3000 node .output/server/index.mjs
```

`VITE_API_BASE_URL` is embedded at build time. The default build target is the
existing Lovable/Cloudflare target; set `NITRO_PRESET=node-server` for the Node
commands above. Deploy the complete `.output` directory. A Vite development
server is unnecessary for this deployment.

Example nginx server locations (inside an HTTPS server block whose certificate
and key are managed by the deployment):

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The API proxy preserves `/api/`. Browser requests then share the frontend origin.
For a separate API origin, build with its absolute `/api` URL and add the exact
frontend origin to `CORS_ORIGINS` (comma-separated, no wildcard). Cookies are
HttpOnly, SameSite=Lax, scoped to `/api`, and Secure when `SECURE_COOKIES=true`;
use HTTPS for both services and a same-site deployment for cookie authentication.
Allow only the trusted reverse proxy to reach application ports.

Set `SEED_DEMO_ACCOUNT=false` for public hosts. The default remains enabled for
local development and deterministic demo tests. A public demo still needs
appropriate account, data-retention, and operational policies before production.

`GET /api/health` returns exactly `{"status":"ok"}` without authentication, with
no-store caching. It is a process liveness check: it performs no database query,
AI call, or email delivery. It does not establish provider availability, database
readiness, or migration compatibility. Startup database failures can prevent the
process from becoming available. Use operational monitoring for those dependencies.

AI is optional: unset `AI_API_KEY` to use deterministic fallback questions and
feedback. Never use real provider secrets in tests. For local capture, use
`EMAIL_ADAPTER=local` with the in-memory outbox. Production SMTP configuration,
TLS, timeout and link validation are described in [email-delivery.md](email-delivery.md).
Do not commit actual credentials or expose the development mailbox via HTTP.

## Repeatable local verification

After installing dependencies and building the Node target as above, run from
the repository root:

```sh
uv run --project backend python scripts/deployment-smoke.py
```

The smoke script rebuilds the Node frontend with an isolated absolute API URL,
uses a temporary persistent SQLite file, runs the migration
command, starts actual backend and built frontend processes on isolated loopback
ports, and uses Chromium to submit the actual login form, use the session
cookie, create an interview, and reload. It restarts the backend and verifies
both the saved record and session remain. AI is disabled and email uses the
local adapter. Temporary files and processes are cleaned up. Install Chromium
first using `cd frontend && npx playwright install chromium` if necessary. On
Linux, install its system libraries with `npx playwright install-deps chromium`
(which may require administrator privileges).
The loopback check sets Secure cookies false; HTTPS termination and Secure cookie
transport require verification in the deployment environment.

## Optional isolated coding runner

Code execution is disabled unless `CODING_RUNNER_URL` and
`CODING_RUNNER_TOKEN` are configured on the API. Static AI code review remains
available without them. Deploy the gateway on a dedicated, patched host with no
application database or AI/email/session secrets. Build the executor image from
`coding-runner/Dockerfile` on that host and set `CODING_EXECUTOR_IMAGE` to the
promoted immutable image digest. The gateway requires Docker Engine access and a
private submissions directory; this Docker access is confined to the dedicated
runner host.

Set a runner-only random token of at least 32 characters in both the API and
runner secret stores. Keep the gateway bound to loopback behind a private TLS
proxy or expose it only on an authenticated private network with firewall rules
allowing the API service. Do not expose port 8090 publicly. Set
`CODING_RUNNER_HOST=127.0.0.1`, `CODING_RUNNER_PORT=8090`, and
`CODING_RUNNER_SOURCE_DIR=/var/lib/interview-code-runner/submissions` for a
loopback deployment; create that directory for the runner service account with
mode `0700`. For a remote API, use a private address and HTTPS proxy for
`CODING_RUNNER_URL`. Never mount the Docker socket or any host directory into
executor containers.

On the dedicated runner host, install Docker Engine and Python 3, create the
`coding-runner` service account, add it to the host's Docker group, and install
the `coding-runner/` files under `/opt/interview-code-runner`. Create
`/var/lib/interview-code-runner/submissions` owned by that account with mode
`0700`, build the executor image, and configure the service token in a
root-owned `/etc/interview-code-runner.env` file with mode `0600`:

```sh
docker build --pull -t interview-code-executor:1 /opt/interview-code-runner
install -m 0644 /opt/interview-code-runner/interview-code-runner.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now interview-code-runner
```

Before production, tag the tested image by its immutable digest and set
`CODING_EXECUTOR_IMAGE` to that digest in the service environment. On the API
host, set `CODING_RUNNER_URL` to the private HTTPS gateway URL and configure the
same runner-only token. The runner service unit enables filesystem and kernel
hardening for the gateway process; its Docker group membership is root-equivalent
on that dedicated host, which is why it must not share the API host or its
credentials.

Run gateway unit tests with `uv run --project backend python -m pytest -q
coding-runner/test_runner.py backend/tests/test_coding_runner.py`. On a host
with Docker access and the built executor image, run the security integration
cases with `CODING_RUNNER_INTEGRATION=1` set. They exercise supported runtimes,
compile and runtime failures, timeouts, memory and output limits, filesystem
isolation, network denial, and environment-secret isolation. See
[`security/coding-runner.md`](security/coding-runner.md) for the threat model,
resource limits, and residual container-kernel risk.

Run backend tests with `cd backend && uv run --locked pytest`, frontend tests with
`cd frontend && npm test`, and the production build command above. CI automation
and full product journey coverage are tracked separately in #41 and #34.
