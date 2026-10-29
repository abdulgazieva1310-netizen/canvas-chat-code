# Russian scoring and Send recovery — 2026-10-29

The scoring failure had three separate causes: a second AI review blocked valid
scores; the answer transaction waited for follow-up/next-question generation and
rolled back scores on that provider's failure; and the UI could wait indefinitely
on a request or an offline-paused mutation.

## Fixes

- Russian scoring uses one concise structured evaluation request. Numeric/schema
  and Russian primary-feedback validation remain enforced. A secondary model
  review no longer vetoes scores. One invalid-output repair remains bounded.
- An unusable improved-answer example displays an explicit Russian unavailable
  notice without discarding actual scores and Russian answer-specific remarks.
  The service never invents fallback numbers or exposes English-only feedback.
- A successful Russian answer commits before question generation. An active
  transcript ending in a user answer indicates a pending continuation. The new
  owner-only `POST /api/interviews/{id}/next-question` continues that exchange;
  provider failure leaves the answer and its scores intact.
- The UI continues automatically once per saved answer, including after reload.
  A continuation failure offers **Retry next question** and permits ending the
  interview to review saved results. A scoring failure keeps the draft and
  offers an enabled **Retry answer**.
- Both requests have a 60-second browser abort deadline. Answer mutations are
  not indefinitely queued offline or automatically retried. Original question
  IDs make lost-response retries idempotent.
- Provider throttling uses the longer of a fractional body wait and a rounded
  header, with a small margin. At most two retries share a 30-second wait budget.

## Verification

- Backend AI, language, API and contract suites: **258 passed**.
- Frontend client and interview-route suites: **82 passed**.
- Frontend production build: **passed**.

Regression scenarios include a stalled fetch, offline submission, scoring 503,
retry after timeout, preserved drafts, exact replay without duplicate evaluation,
failed question generation after saved scores, continuation replay, ownership,
pending-session reload, subsequent answers, and final-question follow-up/completion.

## Live unmocked provider/API run

Used Groq `openai/gpt-oss-120b`, synthetic interviews/answers, and a temporary
SQLite database. Question generation, scoring, follow-ups, and continuation all
used the live provider; no generation or evaluation stubs were used in this run.

| Scenario | Start | Score submission | Scoring time | Continuation | Report |
| --- | --- | --- | --- | --- | --- |
| Russian QA Behavioral | 201 | 200 | 1.2 s | 200, 1.1 s | Russian, overall 3.0 |
| Russian Python Technical | 201 | 200 | 14.7 s | 200, 65.8 s | Russian, overall 2.0 |

Low scores reflect the synthetic answers and are not asserted as grading ground
truth. Exact answer replay did not add a second answer. Both saved reports
retained numerical feedback and Russian session language.

The Python continuation exceeded the browser's deadline; this demonstrates why
it must be separate from scoring. The saved score remained available throughout.
A browser timeout is recoverable through **Retry next question**, which returns
the already-generated question without adding another one.

These checks approve this scoring/retry fix. They do not certify real-device
Russian speech quality or close issue #63's remaining release review criteria.
