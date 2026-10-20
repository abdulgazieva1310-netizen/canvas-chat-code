# Account data downloads

Profile offers **Download account archive**, a schema-version-1 JSON document
from authenticated `GET /api/auth/me/export`. The server chooses the current
identity; callers cannot request another account. SQLite reads run in an
explicit snapshot and PostgreSQL uses REPEATABLE READ. Downloads are capped at
10 MiB encoded UTF-8; oversize documents return 413 without a partial file.

The archive includes public profile/preferences, interview configurations and
transcripts, saved evaluations, derived learning-plan evidence, study notes and
media metadata including expiry. Media files, private storage keys, credentials,
password/reset/session hashes, hidden tests and internal reviewer notes are not
included. Local-only avatar preferences and dismissed learning-plan suggestions
are browser state and are not represented as server-persisted records. No AI
calls or data changes occur during export. Active Real Interviews must end
before export (409), preserving their feedback-visibility boundary.
