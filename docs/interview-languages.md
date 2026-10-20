# Interview language support

The supported language/provider matrix is intentionally small and explicit:

| Interview language | AI provider and model | Recognition locale | Speech playback |
| --- | --- | --- | --- |
| English | Groq `llama-3.3-70b-versatile` | `en-US` | `en-US` browser voice |
| Russian | Groq `llama-3.3-70b-versatile` | `ru-RU` | Russian browser voice only |

Users choose a language for each session in interview setup. The value is saved
with the interview, so later profile changes cannot alter questions, hints,
answer evaluation, or report feedback for an existing session. Profile language
remains a general preference; unsupported values are not treated as interview
languages.

Russian sessions require `AI_API_KEY` and the exact reviewed model above. When
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

Russian is an opt-in preview, not a quality-approved release language. The
server requires `ENABLE_RUSSIAN_INTERVIEWS=true` in addition to the configured
model and key. English remains available without this flag. The matrix above
records implementation targets; browser locales do not certify provider quality.
No live Groq or real-microphone/listening review has been recorded for this slice.
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
