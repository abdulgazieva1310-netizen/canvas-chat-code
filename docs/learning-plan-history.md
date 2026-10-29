# Performance history for learning plans — issue #84

## Minimum useful history

Select two to five owned, completed interview reports. Every selected report
must have at least one scored answer and an overall score. Reports must match
exactly on role, interview type, mode, starting level and language. Text and
voice inputs may be compared within that group. Active, early-ended and
unscored sessions cannot supply plan evidence. Report count alone is not enough.

At least one actionable practice area must appear in scored feedback from two
distinct selected interviews. Several answers in one interview count as only
one interview for recurrence. Topics come from persisted report feedback using
the existing practice-topic extraction; comparison normalizes whitespace and
case. It does not infer synonyms or use an AI call to invent a shared weakness.
Topics that sound similar but do not normalize identically remain separate.

There is no minimum low-score threshold: an actionable improvement area can
remain useful in an otherwise strong answer. There is no automatic age cutoff
or claim that older results describe current skill. Users select the relevant
reports, and the plan shows source dates and scores. Broader history windows,
recency weighting and synonym consolidation need a future reviewed policy.

## Evidence to practice goals

Only scored answers with actionable missing-feedback text and recurring topics
are passed to the provider. Generic unavailable/no-actionable-feedback notices
are excluded. Each evidence record contains the question, saved score, missing
feedback, eligible practice topics and an opaque reference mapped to the exact
interview/answer. It excludes the candidate's full answer and unrelated history.

The provider receives at most 20 answer records, selected round-robin across
reports so a long report cannot fill the entire budget. Question and feedback
text retain the existing length caps. The provider suggests two to four ordered
goals, each with a topic, evidence-based rationale and concrete practice action.
Different goals may practice different aspects of one recurring area.

For example, boundary-testing feedback in two compatible QA reports can support
goals to enumerate input partitions and then write boundary tests. A one-off
communication weakness cannot be promoted as recurring. Each goal must cite
valid, unique evidence references from at least two different reports, and all
its cited answers must share at least one eligible topic. Server validation
rejects unsupported citations before saving any changes. Citation validation
does not prove that every generated sentence is accurate; plans remain coaching
suggestions with report links for review.

## Insufficient history and failures

The Study screen explains the comparison group, two-report minimum and shared
improvement-area requirement before generation. The API remains authoritative:

| Situation | Result and next step |
| --- | --- |
| Fewer than two or more than five selected reports | Request validation error; choose two to five |
| Duplicate IDs or mixed comparison groups | 400; select distinct reports in one group |
| Report not owned or missing | 404; choose accessible reports |
| Active or early-ended report | 409; complete interviews first |
| Unscored report or insufficient actionable evidence | 422; complete and score more compatible answers |
| No topic recurring across two reports | 422; gather more compatible history and select reports with a shared improvement area |
| Provider unavailable or unsupported generated citations | 503; no plan changes saved, allow retry |

Failures never manufacture recommendations. Provider failure does not remove
existing plans, reports or checked-off progress. Existing saved plans remain
readable even if created before this stricter policy; new generation and
regeneration use the current requirements.

## Refresh policy

Completing another interview does not automatically call the provider, replace
a plan, change source references or reset completion. On the next history read,
the Study screen flags a compatible completed report outside the source set
whose end time is later than the plan's creation time. This notice indicates
new history, not confirmed eligibility: the selected reports must still pass
the scored-feedback and recurrence gate.

To incorporate newer results, select the desired compatible reports and create
a new plan. The previous plan and its progress remain intact. **Regenerate
plan** explicitly reuses the original source set and resets completion only
after successful generation; it never silently adds newer reports. Deleting a
source interview removes dependent plans under the existing deletion policy.

The dashboard's deterministic recurring suggestions remain separate from saved
AI plans. Account-wide trends must not supply evidence across incompatible
groups. See the exact API behavior in `backend/app/routers/study_plans.py` and
the Study UI in `frontend/src/routes/study.tsx`.
