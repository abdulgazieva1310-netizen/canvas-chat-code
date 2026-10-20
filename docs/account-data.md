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

## Permanent account deletion

Profile requires the current password and typing DELETE to confirm. Cancellation
or failed reauthentication leaves data unchanged. `DELETE /api/auth/me` removes
the current user's interviews/transcripts, evaluations, start-idempotency rows,
study questions/notes, recording consent/metadata, reset links and login tokens,
then the account, in one transaction. Local private caches and credentials are
cleared only after success. Other accounts are unaffected.

Migration 0006 adds a durable queue containing only private storage keys and
creation timestamps, without a user foreign key. Recording access ends when
metadata is committed away. File deletion runs after commit and queued failures
retry every minute, including after restart; already-missing files are safe to
retry. Database failure rolls back deletion and leaves files untouched. Storage
operators should monitor the generic deferred-cleanup log and resolve persistent
storage failures. The bounded worker processes up to 100 queued files per pass.
