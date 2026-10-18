# Interview Mirror backend

From the repository root, use `make install`, `make run`, and `make test`.
`make run` installs missing dependencies automatically. Override the address with
`make run HOST=0.0.0.0 PORT=8080`; run `make help` to list commands.

From this directory:

```sh
uv sync
uv run uvicorn app.main:app --reload --port 8000
uv run pytest
```

The API is under `http://localhost:8000/api`; interactive docs are at `/docs`.
Code is split into request/response models, authentication, SQLAlchemy database
records and a transactional repository, and auth/interview routers.

Log in with **demo@example.com / demo-password** to see a completed Practice
interview and an incomplete Real Interview with reports. New users have empty
history. Passwords use salted Argon2 hashes. Login and registration preserve the
spec's User response body and HttpOnly session cookie. They also return an
`Authorization: Bearer <token>` response header; send that header on subsequent
requests to authenticate without cookies. Tokens expire after 24 hours and only
their SHA-256 digests are stored. An invalid explicit Authorization header takes
precedence over a valid cookie. No credentials appear in response bodies.

For browser cookie authentication, use `credentials: 'include'`. CORS allows
localhost ports 3000, 5173, and 8080, plus 127.0.0.1:8080 by default, and exposes the Authorization response
header. Set `CORS_ORIGINS` to a comma-separated list of frontend origins and set
`SECURE_COOKIES=true` when serving over HTTPS.

All interviews are private to their owner. Missing and inaccessible interviews
both return 404. Invalid input returns 400 with `{ "message": "..." }`, as in
`../openapi.yaml`. Hints and state transitions enforce the contract. Questions are generated dynamically through the
[Groq Chat Completions API](https://console.groq.com/docs/text-chat) using `httpx`.
Set `AI_API_KEY` in `backend/.env` or export it with your Groq key to enable generation; `AI_MODEL` defaults to
`llama-3.3-70b-versatile`. For example, from the backend directory:

```sh
AI_API_KEY=your_groq_key uv run uvicorn app.main:app --reload --port 8000
```

Generation uses the role, level, interview type, job description, earlier questions,
and candidate answers. Missing/placeholder keys, API errors, timeouts, and invalid
responses automatically use the existing hardcoded question for that turn. Requests
have a 10-second timeout per network operation (3 seconds to connect), with no
automatic retries. No generation is requested after the final answer. Seeded demo
interviews remain deterministic and do not call the API. Hints remain demo fixtures;
there is no audio processing.

Each submitted answer is evaluated with the same Groq key/model using
[JSON object mode](https://console.groq.com/docs/structured-outputs).
The response is validated for numeric 1–10 accuracy, completeness, clarity, and
structure scores, plus nonempty `went_well`, `missing`, and `stronger_answer` text.
Invalid or unavailable evaluations never receive fabricated scores: the answer is
saved and the report marks it as unscored. Practice mode returns `lastFeedback`
scores and `lastAnswerFeedback` text immediately; Real Interview mode keeps both
null and reveals evaluations only in the final report.

The `answer_evaluations` table stores each result with its interview, question,
and answer IDs. It is created automatically for existing databases at startup;
no existing columns need to change. Stored results survive restarts and report
requests do not call Groq again. Older sessions without evaluations are shown as
unscored. Reports average each category across successfully evaluated answers;
overall scores average all four categories across those answers, rounded to one
decimal. Per-question category scores and written feedback remain available, and
unscored answers remain in the report with null scores. All scores are approximate
AI coaching estimates, not hiring predictions.

Users, password hashes, session token digests, and interviews persist across restarts.
By default the database is SQLite at `backend/interview.db`, independent of the
server's working directory. Configure the connection with `DATABASE_URL`:

```sh
DATABASE_URL=sqlite:////absolute/path/interview.db uv run uvicorn app.main:app --port 8000
```

Relative SQLite paths (such as `sqlite:///interview.db`) resolve from the server's
working directory. The parent directory must already exist. The server automatically loads `backend/.env` at startup, regardless of its working
directory. Existing process environment variables take precedence over `.env` values.
Copy `.env.example` to `.env` and edit the settings; `.env` is ignored by Git.
Restart the server after changing settings.

Tables are created automatically if missing. This does not migrate existing schemas;
future schema changes will need migrations. Demo data is inserted only when the demo
account is absent, so restarting does not duplicate interviews or reset their state.
For an empty database use `create_app(seed=False, database_url=...)`; tests use a
fresh SQLite file per test, and `sqlite:///:memory:` is also supported.

The repository uses SQLAlchemy types and queries with separate transactions for
API operations. User emails are unique in the database. Interview writes use version
checks to reject stale updates with 409. Multiple server instances can use the same
database. SQLite connection options are applied only to SQLite; another SQLAlchemy
URL (for example `postgresql+psycopg://user:password@host/interviews`) will select
that dialect after its driver is installed using `uv add`. PostgreSQL integration
is not yet tested. Interview setup, messages, feedback, and user profile fields use
portable JSON columns; ownership, status, timestamps, and credentials have dedicated
columns. Sessions commit on success and roll back on failure, following the
[SQLAlchemy transaction pattern](https://docs.sqlalchemy.org/en/20/orm/session_basics.html#framing-out-a-begin-commit-rollback-block).

The frontend uses this HTTP backend with cookie authentication; see
`../frontend/README.md` for connection settings.
