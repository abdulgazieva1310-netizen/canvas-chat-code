# Recording consent, retention and playback — issue #85

## Scope and consent

Transcription and stored recording are separate actions. Voice answers normally
submit browser-transcribed text; they do not retain raw microphone audio.
Optional **Save a recording** controls capture audio only after the user checks
the recording notice and explicitly starts recording. Browser microphone
permission alone is not storage consent. Camera preview is local and never
included in the recording; video uploads are rejected.

Consent applies to one owned interview, not the account or future interviews.
It is checked before reading an upload and again before saving the recording.
New consent is accepted only while the interview is active. An already
consented final upload can finish after ending. Consent can be withdrawn after
ending too, via the consent API; withdrawal removes all saved recordings for
that interview. During an active interview the checkbox provides withdrawal.
The report provides individual recording deletion after ending. A new interview
requires its own explicit consent. Granting consent does not itself start a
microphone or create a recording.

## Storage and retention

Recordings belong to the signed-in owner and their saved interview. No public
URL is exposed: authenticated, owner-scoped API requests download bytes with
`Cache-Control: private, no-store` and `nosniff`. Missing and inaccessible IDs
both return 404. Metadata contains an opaque ID, type, byte count, creation time
and expiry; storage paths are not exposed.

The application stores files outside the web assets in `INTERVIEW_MEDIA_DIR`
(default `backend/media-storage`), with directory mode 0700 and file mode 0600.
Only WebM or MP4 audio is accepted, up to 100 MiB per recording and three
recordings per interview. This is media-type/size validation, not a codec or
content authenticity check. Browser capture requests audio only.

Expiry is fixed at upload creation plus 30 days. Playing, listing or revisiting
a report does not extend it. Expired recordings are excluded from listings and
playback even if a storage error prevents file removal. The running application
reaper attempts expired-file removal every minute, with further attempts on
media requests. Failed expired-file removal leaves metadata available to retry.

User deletion and consent withdrawal remove playback metadata immediately.
Failed physical deletion creates a durable cleanup entry; the existing reaper
retries queued removals every minute. Application downtime or storage outages
can delay physical erasure, but do not extend access to expired or deleted
recordings. Deployments must keep the application/reaper running and monitor
cleanup failures. The application does not manage external backup copies;
exclude raw recording storage from ordinary database backups or define a
matching retention/deletion process for any separately managed copies.

## User controls and interview relationship

| Action | Recordings | Transcript and report |
| --- | --- | --- |
| Stop and save | Saves the explicitly consented audio if upload succeeds | Unchanged |
| End interview | Allows pending consented upload to finish | Saved normally |
| Delete recording in report | Removes that recording's access; retries failed physical cleanup | Unchanged |
| Withdraw interview recording consent | Removes all that interview's recording access and blocks uploads | Unchanged |
| Recording expires or file is missing | No playback; transcript remains the review fallback | Unchanged |
| Delete interview | Removes its recordings under the existing interview deletion flow | Interview, transcript and report are removed |
| Delete account | Revokes sessions and removes all account recording metadata, with durable file cleanup retries | Account records removed |

## Playback behavior

The report never starts playback automatically. **Play recording** fetches a
private blob and creates a temporary browser URL. Deletion, expiry, disappearance
from refreshed metadata or leaving the page clears playback and revokes that
URL. The expiry timer runs while the page is active; browser suspension may
delay client-side callbacks, so server expiry enforcement remains authoritative.
A failed fetch preserves the report and explains that playback is unavailable;
404 responses refresh the recording list. Repeating deletion after another
tab has already deleted the file refreshes the list rather than reporting a
new failure. Application deletion cannot recall copies users already downloaded
or copies in a suspended browser; it prevents further server retrieval.

## Future video playback gate

Video retention is not enabled by this policy. A future version must add an
explicit audio/video notice and opt-in capture action, bounded upload formats
and sizes, owner-scoped playback/deletion, fixed expiry, storage cleanup tests
and browser playback evidence. Camera-preview permission must never silently
become permission to store video. Reuse the interview ownership and expiry
rules, and review the actual storage/backup deployment before enabling capture.

API contracts: the three `/interviews/{interviewId}/media` paths in
`openapi.yaml`. Regression evidence is recorded in the issue #85 QA document.
