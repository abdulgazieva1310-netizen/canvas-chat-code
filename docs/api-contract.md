# API contract and implementation handoff

`openapi.yaml` is the shared contract; `frontend/src/lib/api/types.ts` mirrors
its payloads. Validate offline with `cd backend && uv run --offline --locked
pytest tests/test_contract.py`. Dependencies must be installed first with
`uv sync --locked`. Validation rejects remote references, blocks socket connections,
validates OpenAPI 3.0 structure, and checks every named example against its schema.

Existing operations are implemented unless explicitly marked
`x-implementation-status: planned`. Dashboard summaries (#32), follow-up metadata
(#18), per-category inapplicable scores (#20), and filtered pagination (#40) remain
planned handoffs. The planned start-key parameter is implemented and verified
separately in #13.
`GET /interviews` currently returns an array. Its
`x-planned-contract` defines filters and the future `HistoryPage` response; backend
and all consumers must migrate together. No current client is switched by this issue.

History combines exact role/type, inclusive UTC start-date bounds, inclusive
score bounds, and case-insensitive substring search over role/job description.
Pagination starts at page 1, defaults to 20 items, and allows at most 100. Date and
score lower bounds must not exceed upper bounds; malformed input returns the
standard 400 Error envelope. Unscored sessions are excluded only when filtering
by score. All results and totals belong to the authenticated user.

Summary groups compare the same role, interview type, mode, and starting level.
Only completed scored sessions contribute to averages/trends. Incomplete sessions
remain labeled in recent activity. Repeated coaching claims need at least two
distinct answer references; absent evidence yields empty claim/suggestion lists.
Null categories are omitted from averages; no usable scores produce a null average.

Named examples in OpenAPI cover text and formatted Python answers, a planned
follow-up linked to its main question, and an early-ended unscored report tied to
the actual transcript. Scores are coaching estimates. Real Interview mode hides
live evaluations; partial results are available after early ending. Follow-ups do
not consume main question slots, and at most one is allowed per main question.

Cookie and opaque bearer sessions are supported. Invalid explicit Authorization
headers take precedence over cookies. Authenticated operations enforce ownership;
unknown and inaccessible interviews both return 404. The `{message}` error envelope
is used for 400 validation, 401 authentication, 404 ownership/not-found, and 409
state/idempotency conflicts. Recovery responses do not disclose account existence.
