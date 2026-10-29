# Multilingual answer-evaluation benchmarks — issue #90

## Benchmark purpose

`backend/app/data/evaluation_benchmarks.v1.json` is a versioned synthetic
review set for English and Russian, the currently supported interview content
languages. It tests evaluation behavior; it is not a question bank, candidate
dataset, deterministic score key or evidence that another language is ready.

The first slice compares strong and weak answers to the same technical
contract in English and Russian, then adds answers with mixed-language clauses
and valid English technical terminology. The strong answer returns the first
value encountered twice from `[4, 2, 4, 2]` (`4`) using a set in O(n) time and
space. The weak answer sorts first and returns `2`, violating the left-to-right
contract despite a correct description of sorting complexity.

## Review rubric

Review the output in four separate dimensions:

1. **Substance:** did the evaluation recognize the implemented approach,
   contract result, evidence and actual omissions? Does it avoid crediting an
   approach the candidate did not describe?
2. **Score consistency:** matched strong English/Russian cases should land in
   the same qualitative band; matched weak cases should land in the same lower
   band. An appropriate rubric-specific band is a calibration aid, not an
   exact expected score. Do not compare raw scores across different question
   types or providers as though scales were statistically calibrated.
3. **Feedback language:** user-visible feedback must follow the selected
   interview language. Technical terms, identifiers, code and customary
   asymptotic notation may stay in their normal form. A real sentence in another
   language is a localization finding, separately from answer correctness.
4. **Evidence and fairness:** every strength/omission must be supported by the
   answer. A mixed-language answer that contains a correct algorithm remains
   substantively correct; mention language consistency only when relevant to
   the interview criterion. Do not infer fluency, hiring suitability or
   communication ability from one synthetic answer.

`strong-band` and `weak-band` express relative ordering within this paired
fixture. If the product uses 1–10 category scores, reviewers should check that
the strong pair is not scored below the weak pair by a material amount; record
the exact scores, dimension scores and rationale rather than requiring the
same integer across languages. Localization failure alone must not fabricate
or silently lower technical correctness scores. Existing validation may still
reject an unusably localized required response and ask for retry.

## Review workflow and release gates

For each provider/model prompt version:

- Run the same English and Russian question/answer pairs without changing the
  task contract. Preserve the fixture version and model/prompt provenance.
- Capture the structured score dimensions, strengths, missing feedback,
  improved example and any language/error response. Do not include secrets or
  real user data in saved artifacts.
- Have reviewers independently label substance and language compliance using
  the four dimensions above. Resolve disagreements with answer evidence; do not
  tune prompts to one exact score.
- Record per-case findings and score-band ordering. A strong/weak ordering
  inversion, invented omission, incorrect example result, loss of technical
  syntax, or wrong output language is a failure to investigate.
- Re-run the benchmark after changes to provider, model, prompt, schema,
  localization guard or scoring pipeline. Keep prior artifacts so regressions
  remain comparable.
- Add fixtures for every newly proposed interview language before enabling it.
  Require native/qualified language review and separate speech/browser checks;
  passing these text fixtures alone does not approve a language release.

Question/answer text is synthetic and public in the repository. Expected
results are review criteria, not machine-enforced gold prose. The corpus makes
no claim about cultural equivalence beyond the paired technical contract in
version 1. Future versions should add behavioral and role-specific pairs,
multiple technical topics, Russian code-review cases, and language-direction
counterexamples before making broad fairness or quality claims.

## Relationship to Russian validation

Issue #81 validates the broader Russian interview path: generated questions,
hints, follow-ups, API persistence, reports and browser speech. This benchmark
focuses on comparable evaluation feedback across selected content languages.
It does not change the provider allowlist or Russian preview status. See
[`docs/russian-language-validation.md`](russian-language-validation.md) for the
end-to-end validation matrix and release review requirements.
