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
