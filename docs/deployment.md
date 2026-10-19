# Production deployment

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

The current application seeds a public demo account on startup. Restrict access
to a private staging environment until demo seeding is made configurable and
production account policy is established. This guide verifies deployment
mechanics; it does not assert public release readiness.

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

Run backend tests with `cd backend && uv run --locked pytest`, frontend tests with
`cd frontend && npm test`, and the production build command above. CI automation
and full product journey coverage are tracked separately in #41 and #34.
