# Reviewed coding judge specifications

These specs belong to the existing question bank entries. Question text and judge
contracts are versioned separately. Interview transcripts save the question ID,
question version, judge key, and judge spec version with the question message.
Reports show those same values. Updating a bank entry therefore cannot change an
existing interview or the meaning of an earlier judge result.

Each program reads whitespace-separated tokens from standard input and
write one result line to standard output. Arrays contain signed 32-bit integers.
Implementations must reject malformed input according to the sentinel below.
The judge reveals only the number of failed cases and a generic coaching summary;
inputs and expected outputs remain server-side.

The manual **Run public examples** action uses only the separately maintained
`PUBLIC_CASES` registry; submitting an answer uses the full `JUDGE_CASES` suite.
Both are immutable versioned mappings in `backend/app/services/coding_specs.py`.
Execution additionally requires an exact reviewed question ID/version and judge
key/version match. A new contract needs a new version; old sessions are never
silently judged using a replacement contract.

## Public executable examples

| Judge | Standard input | Expected stdout |
| --- | --- | --- |
| balanced-brackets-v1 | `([])` / `([)]` | `true` / `false` |
| first-repeat-v1 | `4 4 2 4 2` / `3 1 2 3` | `4` / `null` |
| runs-v1 | `4 2 2 3 2` / `0` | `[[2,2],[3,1],[2,1]]` / `[]` |
| merge-sorted-v1 | `2 2 1 3 2 3` / `0 0` | `[1,2,3,3]` / `[]` |

Every input and expected output ends with a newline. The UI reports only public
pass/fail counts. Hidden input/output and program diagnostics never enter a
candidate-visible judge summary.

## `coding-junior-balanced` / `balanced-brackets-v1`

- Version: question 1, spec 1.
- Input: one line of at most 100000 characters, containing only `()[]{}`.
- Output: `true` when every bracket is properly nested and matched; otherwise
  `false`. An empty line is valid and prints `true`; any non-bracket character
  prints `false`.
- Public examples: `([]) => true`; `([)] => false`.
- Wrapper signature: `balancedBrackets(text) -> boolean`.
- Reviewed normal, boundary, and invalid-input cases are in `JUDGE_CASES` under
  `balanced-brackets-v1`.

## `coding-junior-first-repeat` / `first-repeat-v1`

- Version: question 1, spec 1.
- Input: `n` (`0..100000`), then `n` signed 32-bit integers.
- Output: the first value encountered for its second occurrence, or `null` if no
  value repeats. Print as a JSON integer or JSON `null`, on one line.
- Malformed input, a count outside its limit, or a non-integer token prints
  `null`.
- Wrapper signature: `firstRepeat(values) -> integer | null`.
- Reviewed normal, boundary, and invalid-input cases are in `JUDGE_CASES` under
  `first-repeat-v1`.

## `coding-junior-runs` / `runs-v1`

- Version: question 1, spec 1.
- Input: `n` (`0..100000`), then `n` signed 32-bit integers.
- Output: compact JSON `[[value,count],...]`, preserving run encounter order;
  print `[]` for an empty input.
- Malformed input, a count outside its limit, or a non-integer token prints
  `[]`.
- Wrapper signature: `compressRuns(values) -> array<[integer, positive integer]>`.
- Reviewed normal, boundary, and invalid-input cases are in `JUDGE_CASES` under
  `runs-v1`.

## `coding-junior-merge-sorted` / `merge-sorted-v1`

- Version: question 1, spec 1.
- Input: `n m` (`0..100000` each), followed by `n` values and then `m` values;
  both arrays are sorted ascending and their combined length is at most 100000.
- Output: compact JSON array with all values sorted and duplicates preserved.
  Print `[]` when both arrays are empty.
- Malformed input, an invalid count, a non-integer token, or an unsorted input
  array prints `[]`.
- Wrapper signature: `mergeSorted(left, right) -> array<integer>`.
- Reviewed normal, boundary, and invalid-input cases are in `JUDGE_CASES` under
  `merge-sorted-v1`.

The execution service is called once per reviewed case using the currently
supported isolated runner languages: Python, Java, C++, JavaScript, and
TypeScript. The runner retains its CPU, memory, process, filesystem, network,
source-size, and output-size limits, with a 12-second per-command wall-clock
deadline to accommodate the supported compilers in the constrained container. Compilation errors,
runtime errors, timeouts, unavailable runner infrastructure, and incorrect
outputs keep distinct judge statuses. Static AI coaching still runs when
automated execution is unavailable.

No judge case input or expected output is included in candidate-visible API
summaries or report feedback.

## Case review and promotion — issue #83

The version-1 registry contains 26 submission cases and eight separately
maintained public examples across four contracts. Each submission suite has
normal, boundary and invalid-input categories. Review evidence includes:

| Contract | Submission cases | Representative coverage | Plausible mistake detected |
| --- | --- | --- | --- |
| Balanced brackets | 5 | Mixed types, mismatched nesting, empty input, nested pairs, invalid character | Counting brackets without checking nesting |
| First repeat | 7 | Repetition encounter order, no duplicate, empty input, minimum signed integer, immediate duplicate, negative count, non-integer | Returning the smallest duplicate |
| Runs | 7 | Disjoint runs, repeated values, empty input, signed integer extremes, singleton, negative count, non-integer | Combining all occurrences into one run |
| Merge sorted | 7 | Interleaving, one empty side, both empty, signed extremes, duplicates, negative count, unsorted input | Deduplicating the merged result |

`backend/tests/test_judge_case_quality.py` independently recomputes every stored
expected output using small reference oracles. It also verifies that each suite
rejects its listed plausible algorithm error. These offline oracles are for
fixture review, not production execution or performance benchmarking.

SHA-256 snapshots cover each published public/submission case sequence,
including categories, order, inputs and expected outputs. They detect accidental
edits to version-1 cases. Do not refresh a published digest to accommodate a
contract change: add a new judge key/spec version, retain the old registry,
update the reviewed question identity, and add its review evidence. Runtime
immutability alone does not protect old sessions from source-code edits.

The sandbox reference suite in `coding-runner/test_judge_references.py` covers
all four contracts in Python, Java, C++, JavaScript and TypeScript. For each
combination it executes both public and submission cases with a known-correct
reference, then checks that a deliberately wrong program is rejected. Execution
uses the same isolated container entrypoint and resource limits as submissions;
no candidate code is run in the backend process.

```sh
cd backend
uv run pytest tests/test_judge_case_quality.py tests/test_coding_judge.py tests/test_coding_runner.py
```

From the repository root, with Docker and the reviewed executor image available:

```sh
CODING_RUNNER_INTEGRATION=1 CODING_EXECUTOR_IMAGE=interview-code-executor:issue80 uv run --project backend pytest coding-runner/test_judge_references.py -q
```

Before promoting a new version, review the written input contract and expected
output independently, run the offline checks, then execute all reference
language combinations in the sandbox. Record the commit, image ID, commands,
results and any skipped combinations in QA evidence. Keep hidden fixtures out
of browser bundles and candidate-visible errors. A passing finite suite is
evidence of tested correctness, not a proof for every possible input.

### Execution results and judging outcomes

| Execution result | Judge outcome | Candidate explanation |
| --- | --- | --- |
| All stdout values exactly match expected strings | `passed` | All reviewed correctness checks passed |
| Successful execution with one or more unequal stdout strings | `failed` | Failed count and advice to review the contract/boundaries |
| Compiler rejection | `compile-error` | Solution could not be compiled |
| Non-successful program execution | `runtime-error` | Solution stopped with a runtime error |
| Execution timeout | `timeout` | Execution time limit exceeded |
| Memory/process/resource or output limit | `resource-limit` | Resource limit exceeded |
| Unsupported question/language, absent runner config, HTTP/invalid response, runner unavailable or total judge budget exhausted | `unavailable` | Correctness checking unavailable; static AI coaching remains available |

Comparison uses exact decoded stdout strings: the expected newline and
compact JSON formatting matter, and stdout debug logging causes a mismatch.
Compilation failure reports zero passed cases; other early failures retain
the number already passed. `total` remains the selected suite size. Public Run
uses only the public registry; submission uses the reviewed submission registry.
Candidate summaries expose counts/status, not hidden stdin, expected stdout,
stderr or compiler diagnostics. The backend's 45-second judging budget may mark
a slow multi-case/compiler run unavailable even when individual cases would
complete; this is infrastructure unavailability rather than a wrong answer.

### Coverage limits for future versions

The initial finite suites do not exhaust the stated contracts. Review additional
cases for count/token mismatch, extra tokens, over-limit counts/lengths, numeric
overflow after an early duplicate, unmatched open/close brackets, only the right
merge side populated, and near-limit performance. Introduce these through a
new reviewed version rather than changing scores for saved version-1 sessions.
Reference programs also need validation against any newly added malformed-input
cases before that version is approved. Coordinate performance fixtures with
runner limits and the total judging budget; avoid tests whose expected output
exceeds the runner output limit.
