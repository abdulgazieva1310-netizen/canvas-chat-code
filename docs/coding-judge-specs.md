# Reviewed coding judge specifications

These specs belong to the existing question bank entries. Question text and judge
contracts are versioned separately. Interview transcripts save the question ID,
question version, judge key, and judge spec version with the question message.
Reports show those same values. Updating a bank entry therefore cannot change an
existing interview or the meaning of an earlier judge result.

All three programs read whitespace-separated tokens from standard input and
write one result line to standard output. Arrays contain signed 32-bit integers.
Implementations must reject malformed input according to the sentinel below.
The judge reveals only the number of failed cases and a generic coaching summary;
inputs and expected outputs remain server-side.

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
TypeScript. The runner retains its existing CPU, memory, process, filesystem,
network, source-size, output-size, and timeout limits. Compilation errors,
runtime errors, timeouts, unavailable runner infrastructure, and incorrect
outputs keep distinct judge statuses. Static AI coaching still runs when
automated execution is unavailable.

No judge case input or expected output is included in candidate-visible API
summaries or report feedback.
