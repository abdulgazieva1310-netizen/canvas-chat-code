# Issue #63 QA — 2026-10-20

Result: **FAIL for release**. Tested application revision `7d2eee5`.

## Automated checks

- `uv run --project backend pytest backend/tests/test_multilingual_interviews.py backend/tests/test_ai_service.py backend/tests/test_contract.py`: **95 passed**.
- `npm test --prefix frontend -- src/test/start-interview.test.tsx src/test/interview-route.test.tsx src/test/report-route.test.tsx src/test/speech-recognition.test.tsx src/test/spoken-question.test.tsx`: **99 passed**.

These tests cover session language persistence, profile changes, setup switching,
question/hint/feedback/report propagation, rejected provider combinations,
answer rollback, English fallback, browser recognition locales, explicit voice
selection, and missing-voice behavior. Provider and speech assertions in these
suites use fixtures; they do not certify live language quality.

## Live provider and API checks

The configured model was `openai/gpt-oss-120b`, which is outside the Russian
allowlist. Russian preview was disabled. Neither setting was changed on disk.
For the QA subprocess only, selected the allowlisted
`llama-3.3-70b-versatile` model and enabled Russian preview.

- Live Russian question generation failed for QA Behavioral, QA Role-specific,
  and Python Technical scenarios.
- A direct provider diagnostic returned **HTTP 404**, error type
  `invalid_request_error`, code **`model_not_found`** for the allowlisted model.
  This establishes unavailability for the configured account at test time; it
  does not establish provider-wide model retirement.
- Live hints and evaluations were not run because no question was obtained.
- A real API start request using a temporary SQLite database returned **503**
  with: “The Russian question provider is temporarily unavailable. Select
  English or try again later.” No saved history was created.
- An explicit English start with AI disabled returned **201** and recorded
  `setup.language = English`, using the existing fallback.

Synthetic QA credentials and answers were used. No application data or provider
configuration was changed, and no API key is included in this report.

## Browser speech capability check

Chromium 156 in headless Linux exposed recognition and synthesis APIs but
returned an empty synthesis voice list. No Russian voice was available. No
physical microphone transcription or listening-quality review was possible.
API availability alone is not evidence of working speech recognition.

## Acceptance assessment

| Criterion | Result |
| --- | --- |
| Select and persist the session language | PASS in automated checks |
| Consistent question, hint, feedback, report and speech language | Fixture checks PASS; live end-to-end verification incomplete |
| Unsupported/unavailable combinations fail clearly | PASS, including real provider failure through the API |
| Explicit English fallback and switching/failure tests | PASS |
| Reviewed question, speech and feedback quality before release | FAIL / unverified |

Keep #63 open. The next engineering step is to validate an accessible provider/model
combination before changing the Russian allowlist. Then repeat live question,
hint, evaluation and saved-report review, plus real-device recognition and
playback review with recorded browser/OS/device and reviewer evidence. Russian
should remain an opt-in preview until that quality gate passes.
