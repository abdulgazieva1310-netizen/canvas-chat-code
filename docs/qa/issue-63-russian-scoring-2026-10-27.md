# Russian answer scoring — 2026-10-27

Result: the reproduced evaluation failure is fixed. This does not approve the
remaining issue #63 speech/content release criteria.

## Causes and corrections

- Valid code-only improved answers were rejected as English feedback. Python
  source is now parsed without execution; comments/docstrings are inspected
  separately so division operators are not mistaken for comments. Fenced
  Java/C++/JavaScript/TypeScript examples are also accepted without adding prose.
- An optional untranslated practice topic could discard otherwise usable
  Russian scores and coaching. That optional topic is now omitted.
- A single malformed or rejected evaluation immediately failed the submission.
  Russian evaluation now makes at most one fresh attempt after schema,
  localization, or relevance rejection. Persistent failures remain errors;
  no scores are synthesized locally.
- Live API testing exposed Groq TPM throttling: one response requested a
  26.235-second wait. Completion requests now honor a provider wait of at most
  30 seconds once, using Retry-After or the provider's numeric wait message.
  Longer/unknown waits and other transport failures are not retried. Content
  reviews use a smaller completion budget to reduce quota consumption.
- Review instructions distinguish weak candidate answers, which still need
  scores, from invalid coaching, and distinguish hypothetical improved examples
  from claims about actual candidate achievements.

## Automated checks

The broader backend run passed **254 tests** covering AI services, multilingual
interviews, API routes, setup presets, contracts and study plans. After adding
the exact 26.235-second throttle case and source-code edge cases, the final
focused run passed **136 tests**:

```sh
cd backend
uv run pytest tests/test_russian_semantic_quality.py tests/test_ai_service.py tests/test_multilingual_interviews.py tests/test_contract.py
```

Regression checks include recovery after invalid output, persistent rejection,
transport outages, bounded throttling, optional topics, source-only examples,
Python floor division, C++ preprocessor directives, and an API submission that
saves exactly one answer with its repaired scores and report feedback.

## Live evaluation API checks

Used synthetic answers and a temporary SQLite database with the configured
Groq `openai/gpt-oss-120b` provider. Questions and follow-up generation were
replaced with fixed fixtures in the QA subprocess to isolate evaluation from
the independently verified generation path. Evaluation and its semantic review
used the live provider; saved scores and reports used the real API/store.

| Scenario | Answer submission | Saved scores | Report overall |
| --- | --- | --- | --- |
| Russian QA Behavioral | HTTP 200 | 8 / 7 / 7 / 6 | 7.0 |
| Russian Python Technical | HTTP 200 | 10 / 10 / 9 / 9 | 9.5 |

Both saved interviews retained `language: Russian`, one answered main question,
and Russian feedback. Early ending and report retrieval succeeded. Provider
ratings are illustrative coaching estimates, not asserted grading ground truth.
No production account data or permanent provider settings were changed.

The complete live generation-to-answer pipeline was also attempted earlier:
one scoring operation succeeded but the next-question request was throttled;
a later run exposed the longer quota wait described above. The final live
evaluation checks deliberately isolated that endpoint. These results do not
claim browser speech approval or guaranteed provider uptime.
