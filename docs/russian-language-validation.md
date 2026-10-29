# Russian interview validation — issue #81

Russian is the first additional interview language and remains an opt-in preview.
Release approval requires the provider, content, persistence and real-device
speech evidence below. A successful automated run is one part of that evidence.

## Supported combination and scope

The runtime source of truth is `SUPPORTED_LANGUAGE_MATRIX` in
`backend/app/services/ai_service.py`: Groq `openai/gpt-oss-120b`, Russian content,
recognition locale `ru-RU`, and a matching Russian browser synthesis voice.
`GET /api/interview-languages` reports configuration availability separately from
release status. `ENABLE_RUSSIAN_INTERVIEWS=true` opts into preview testing; it
does not certify a browser, microphone, voice, model response or release.

The validation fixture version is 1 in
`backend/app/data/russian_validation.v1.json`. It covers QA Behavioral conflict
resolution, QA Role-specific risk prioritization, and Python Technical duplicate
detection. Each includes a synthetic reference question/answer, known bad output
fragments and human semantic review checks. Add role/language/provider slices
explicitly as quality evidence grows.

## Checks and pass criteria

| Stage | Required result | Evidence |
| --- | --- | --- |
| Configuration | Preview enabled, real key, exact allowlisted model; unsupported combinations stop before provider calls | Backend tests and live preflight |
| Setup/profile | Both text and voice sessions save Russian; changing profile preference to English leaves the existing session Russian | API journey tests for all three fixtures |
| Main question | Russian instructions, correct interview type, coherent requirements/examples, no solution leak | Live generated sample and human review |
| Follow-up | Russian, grounded in the actual answer/question, no type switch, no main-count increment | Live reference probe, API tests and human review |
| Hint | Russian, relevant to the current problem; no complete solution or unrelated algorithm | Live reference probe, known bad-fragment checks and human review |
| Evaluation | Scores validate as provider estimates; remarks correspond to actual evidence, with no invented omissions or achievements | Live probe, API tests and human rubric |
| Improved example | An actual Russian prose/code example with source syntax preserved | Live probe and human review; an unavailable notice fails release-quality validation |
| Saved report | Transcript/source unchanged; question, per-answer feedback, scores and session language survive save/reload and early ending | API journey tests and report-rendering probe |
| Recognition | Explicit Russian locale, intelligible dictated Russian retained through interim/final results; unsupported service errors keep the draft and typing available | Hook tests plus physical microphone review |
| Playback | Russian voice/locale, intelligible pronunciation; an English saved preference or missing voice never silently supplies English speech | Hook tests plus listening review |
| Browser lifecycle | Cancel stale speech/results on language/session change; replay works after voices load; microphone/playback handoff remains usable | Hook/in-room tests and real-device checks |
| Failure/fallback | Provider outages and unlocalized primary content fail clearly; drafts and saved scores survive; English is an explicit user choice | Existing multilingual/scoring/retry tests |
| Release | Every content rubric and approved speech combination has reviewer evidence, with no unresolved failures | Recorded human sign-off |

The mixed-prose guard rejects common English coaching clauses even when a
Russian paragraph is longer. Known technical names such as SQL, REST and GraphQL
and code blocks are allowed. This is a heuristic: it cannot establish fluency,
technical correctness, fair scoring or complete absence of language mixing.

## Automated regression commands

```sh
cd backend
uv run pytest tests/test_russian_validation.py tests/test_multilingual_interviews.py tests/test_russian_semantic_quality.py tests/test_ai_service.py
```

```sh
cd frontend
npm test -- --run src/test/start-interview.test.tsx src/test/speech-recognition.test.tsx src/test/spoken-question.test.tsx src/test/interview-route.test.tsx src/test/report-route.test.tsx
```

Provider and browser APIs in these suites use fixtures. The six API journeys
exercise both input modes across all three interview categories, including an
actual successful profile update, hints, scored submission, deferred follow-up,
early ending and persisted report. Hook tests exercise locale requests, Russian
interim transcript revisions, unavailable recognition/voices, late callbacks,
an incompatible English preferred voice, and explicit replay after voice loading.

## Opt-in live provider probes

Use synthetic data and run one slice at a time to avoid consuming the provider
quota with overlapping probes. The command requires `--live` and uses the same
preview flag/key/model configuration as interviews:

```sh
cd backend
uv run python -m app.validation.russian --live --case behavioral-priorities --output /tmp/russian-behavioral.json
uv run python -m app.validation.russian --live --case qa-risk-prioritization --output /tmp/russian-role-specific.json
uv run python -m app.validation.russian --live --case python-first-repeat --output /tmp/russian-coding.json
```

Omit `--case` to run all slices sequentially. Exit code 0 means the selected
automated checks passed; exit code 1 means a failed preflight or content stage.
The JSON artifact includes provider/model, locales, fixture ID, generated question,
reference question/answer, follow-up, hint, structured evaluation, rendered
report and human review rubric. It contains synthetic content and no credentials.

Generated-question probes are separate from the fixed reference question used
to evaluate hints, follow-ups and coaching. This makes regression comparisons
reproducible. Report rendering is checked without creating accounts or touching
application databases; the API regression suite verifies actual persistence.

The report always records `releaseApproved: false` and lists outstanding human
content/speech review. Do not promote a provider or language solely because its
automated checks returned success. Retain failed artifacts for investigation;
repeatedly regenerating samples until one passes is not quality approval.

## Real-device review record

Record one row per tested provider/browser/OS/device/voice combination. Browser
brand or the existence of a speech API alone is not evidence of Russian support.
Use `PASS`, `FAIL` or `NOT RUN`; record unsupported speech combinations as text
fallback rather than marking voice quality approved.

| Evidence field | Required entry |
| --- | --- |
| Reviewer and date | Named reviewer and UTC date/time |
| Fixture/model provenance | Fixture version 1, all three case IDs, provider/model and JSON artifact locations |
| Environment | Browser name and exact version, OS/version, device, microphone, selected voice name and locale |
| Content review | Every fixture's `human_checks`, with pass/fail and concrete examples for findings |
| Recognition | Dictated text and resulting transcript; accuracy of negation, technical names, numbers and punctuation |
| Playback | Heard question text, intelligibility and Russian pronunciation; speaker/listener handoff |
| Failure checks | Permission denial, absent microphone/voice, provider failure, late events and successful typed continuation |
| English fallback | Explicitly select English in a new session; verify English speech/content and unchanged old Russian report |
| Decision | Approve only the tested combination when all required checks pass; link remaining defects |

Suggested dictation samples:

- «Я проверил двенадцать сценариев API и нашёл две ошибки.»
- «Сначала уточню требования, затем проверю граничные случаи и риск потери данных.»
- «Алгоритм использует множество; время линейное, дополнительная память линейная.»

Accept equivalent number spelling and punctuation while checking meaning and
technical terms. For coding sessions, inspect that feedback remains Russian
and source identifiers/syntax are unchanged. Complete a live saved interview
and review its transcript/report after changing the profile language.

Attach the completed evidence and unresolved findings to #81/#63. Keep the
runtime language status as preview until the release review is approved.
