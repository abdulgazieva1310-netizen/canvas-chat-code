# Database setup and migration verification

The backend uses SQLAlchemy and defaults to `backend/interview.db`, resolved
independently of the server working directory. Configure `DATABASE_URL` in
`backend/.env` or the process environment. Environment values take precedence.

```sh
cd backend
uv sync --locked
DATABASE_URL=sqlite:////absolute/existing-directory/interview.db uv run python -m app.migrate
uv run uvicorn app.main:app --port 8000
```

Use an existing parent directory. An absolute SQLite URL has four slashes;
relative `sqlite:///interview.db` resolves against the process working directory.
Use the same URL when upgrading and running the server. Back up existing data
before deployment. Run the migration command once before starting multiple workers.
Application startup also upgrades the configured database.

The frozen baseline revision adopts existing users, login-token digests,
interviews, and evaluations without replacing records. Transcripts, setup,
pending questions, and progress use the interview JSON payload, so messages
persist as an equivalent to a separate messages table. Later schema changes
must add a new revision under `backend/migrations/versions`. Password hashes
and existing evaluated/unscored answers are retained. Downgrades are unsupported;
restore a backup to roll back.

Verify empty creation, repeated upgrades, legacy adoption, and exact preservation
after reopening, using temporary SQLite databases:

```sh
cd backend
uv run --locked pytest tests/test_migrations.py tests/test_migration_adoption.py
```

The adoption test compares every stored field: password hashes, profile JSON,
session digests and expiry, version numbers, formatted transcripts, and evaluation
JSON. The existing API persistence test verifies login and interview reads after
restarting the application.

Interview media uses separate consent and metadata tables. Raw files live in the
private `INTERVIEW_MEDIA_DIR`, never in the transcript payload or public frontend
tree. See [deployment.md](deployment.md) for directory permissions, 30-day
retention, and deletion behavior.
