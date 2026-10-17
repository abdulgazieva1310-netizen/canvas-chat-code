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
Code is split into request/response models, authentication, an in-memory store,
and auth/interview routers. `create_app(seed=False)` creates an empty isolated store.

Log in with **demo@example.com / demo-password** to see a completed Practice
interview and an incomplete Real Interview with reports. New users have empty
history. Passwords use salted Argon2 hashes. Login and registration preserve the
spec's User response body and HttpOnly session cookie. They also return an
`Authorization: Bearer <token>` response header; send that header on subsequent
requests to authenticate without cookies. Tokens expire after 24 hours and only
their SHA-256 digests are stored. An invalid explicit Authorization header takes
precedence over a valid cookie. No credentials appear in response bodies.

For browser cookie authentication, use `credentials: 'include'`. CORS allows
localhost ports 3000 and 5173 by default and exposes the Authorization response
header. Set `CORS_ORIGINS` to a comma-separated list of frontend origins and set
`SECURE_COOKIES=true` when serving over HTTPS.

All interviews are private to their owner. Missing and inaccessible interviews
both return 404. Invalid input returns 400 with `{ "message": "..." }`, as in
`../openapi.yaml`. Hints and state transitions enforce the contract. Questions,
scores, and coaching are deterministic demo fixtures, matching the frontend mock;
there is no AI evaluation or audio processing.

Data and tokens reset on restart. Run one worker: multiple workers would have
independent stores. The existing frontend still uses `MockApi`; this change adds
the HTTP backend without switching the frontend transport.
