# Interview language support

The supported language/provider matrix is intentionally small and explicit:

| Interview language | AI provider and model | Recognition locale | Speech playback |
| --- | --- | --- | --- |
| English | Groq `openai/gpt-oss-120b` | `en-US` | `en-US` browser voice |
| Russian | Groq `openai/gpt-oss-120b` | `ru-RU` | Russian browser voice only |

Users choose a language for each session in interview setup. The value is saved
with the interview, so later profile changes cannot alter questions, hints,
answer evaluation, or report feedback for an existing session. Profile language
remains a general preference; unsupported values are not treated as interview
languages.

Russian sessions require `AI_API_KEY` and the exact allowlisted model above. When
the provider or model is unavailable, the API returns a clear error rather than
using English fallback questions, hints, or evaluations. Russian output is
checked for Cyrillic text, and coding prompts also need localized problem
requirements. English sessions retain their existing provider fallback behavior.

Voice input asks the browser speech-recognition service for `ru-RU` or `en-US`.
Playback selects the matching locale and refuses to use an English voice for a
Russian session. Browser speech support varies by device; text entry and the
visible transcript remain available when the selected speech service is absent.
The site controls remain in English; this feature localizes interview content,
coaching, speech locale, and report feedback.

Only English currently uses the curated bank's automated coding judge. Russian
coding interviews still receive Russian AI code review, but not hidden-test
correctness results until a Russian judged question is separately reviewed.

Run `cd backend && uv run pytest tests/test_multilingual_interviews.py tests/test_ai_service.py`
and `cd frontend && npm test -- --run src/test/start-interview.test.tsx
src/test/speech-recognition.test.tsx src/test/spoken-question.test.tsx` to verify
session persistence, provider failure handling, localized AI prompts, report
feedback, browser locale selection, and the no-English-voice fallback.

## Release status

`GET /api/interview-languages` exposes the maintained matrix without authentication
or credentials. Each entry includes configuration availability, release status,
provider/model, recognition and synthesis locales, curated fallback availability,
and a reason when unavailable. Responses use `Cache-Control: no-store` because
server configuration can change. `available` describes server configuration,
not live provider health or installed browser voices; Russian remains a preview
even when enabled. English remains selectable through its curated fallback.

Question generation, follow-ups, hints, and evaluation also enforce the matrix
at the AI service boundary. Calling these services directly with a disabled,
unknown, or unallowlisted non-English combination returns no generated content
without sending a provider request. HTTP callers retain their explicit errors.

Russian generated questions, follow-ups, and hints additionally
undergo a provider-based semantic review against their question/answer context.
Malformed, negative, or unavailable review results reject the content and retain
the existing explicit failure/skip behavior. This adds a provider round trip per
generated item. Russian generation and review allow up to 30 seconds of read
inactivity per request; several requests may occur in one interview operation.
Question and hint generation use a 4,096-token completion budget to reduce
reasoning-related truncation. Provider 429 responses can be retried at most twice,
with a combined wait budget of 30 seconds. Fractional delays in the provider body
take precedence over shorter rounded headers. Other transport errors are not retried.
Russian evaluation may generate one fresh response after schema, localization,
or a deterministic context check rejects it. A second rejection fails without saving
invented scores. Content review uses a 2,048-token budget to reduce quota usage.

Russian scoring uses a concise structured prompt and a 2,048-token first-attempt
budget, with a larger repair budget when needed. It validates score ranges,
required feedback and localization locally. It does not make a second AI review
request: that extra call previously rejected valid feedback and exhausted quotas.
The preview's human quality checks remain required before release approval.

Answer requests in the frontend time out after 60 seconds and keep the draft.
After a failure the button becomes an enabled **Retry answer**. Mutations are
not queued indefinitely when offline or automatically retried. The original
question ID accompanies retries so an answer accepted before a timeout is not
saved or scored a second time.

Russian answer submission commits the validated answer and scores immediately.
When an active transcript ends in a user answer, the frontend separately calls
`POST /api/interviews/{id}/next-question` to fetch a follow-up/main question or
finish the interview. This also resumes after reloading a pending interview.
Question-provider failure cannot roll back scores: the UI shows **Retry next
question** and lets the user end the interview to review saved results.

Code-review examples may contain English keywords and identifiers. Russian
comments or docstrings count as localized coaching when the other feedback
fields are Russian; source code is preserved. Preview strengths retain only
Russian excerpts actually present in the candidate's answer; unsupported
paraphrases and code-only strengths are omitted rather than presented as
demonstrated achievements. Non-coding improved answers are
requested as prose. Runtime semantic review remains probabilistic and must not
be treated as a substitute for the release quality review below.

Pure Python source and fenced Java/C++/JavaScript/TypeScript examples do not
need added Russian prose merely to pass localization. Python source is parsed,
never executed, for this check; English-only comments remain rejected. Optional
untranslated practice-topic labels are omitted so they cannot discard valid
scores and localized required feedback.
If the ancillary improved-answer example cannot be localized, its text is
replaced with an explicit Russian unavailable notice while retaining validated
scores and Russian answer-specific remarks. No fallback numerical scores are
invented. Missing/unlocalized primary remarks still require a valid provider
response or a clear retryable error.

Russian is an opt-in preview, not a quality-approved release language. The
server requires `ENABLE_RUSSIAN_INTERVIEWS=true` in addition to the configured
model and key. English remains available without this flag. The matrix above
records implementation targets; browser locales do not certify provider quality.
Live provider checks are recorded in `docs/qa`; real-microphone/listening quality
approval has not been recorded for this slice.
Cyrillic-output checks reject obvious language mismatches but cannot establish
fluency, accuracy, or the absence of mixed-language content.

Before release, record the reviewer, date, provider/model, browser/OS and device,
and results for Russian behavioral, role-specific and coding questions, hints,
feedback and saved reports. Dictate representative Russian answers, inspect
transcription accuracy, and listen to questions for intelligibility and locale.
Exercise provider outage and missing-voice behavior and explicitly switch back
to English. Russian curated fallback is intentionally unavailable: provider
failure must return an error rather than exposing the English bank. Issue #63
remains open until this end-to-end review passes.

## Provider repair (2026-10-20)

The retired/unavailable llama model was replaced in the preview allowlist by
`openai/gpt-oss-120b`, verified against this account's live model catalog. GPT-OSS
requests use low reasoning effort and at least 2,048 completion tokens so
reasoning does not consume the entire visible-output budget. Provider API
reference: https://console.groq.com/docs/api-reference . This is a provider
availability fix; Russian remains opt-in pending real-device speech approval.

Live probes after repair returned Russian questions and structured feedback,
but a synthetic first-repeat coding hint described an unrelated cumulative-sum
problem. Some generation calls were rejected or unavailable. These are quality
failures, not reasons to declare the language approved. Provider access is repaired;
end-to-end semantic review and real-device speech testing are still outstanding.
