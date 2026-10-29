"""Review the stored answers independently of runner mocks and AI generation."""
import hashlib
import json
from collections import Counter
from itertools import groupby

import pytest

from app.services.coding_specs import JUDGE_CASES, PUBLIC_CASES

REVIEWED_DIGESTS = {
    'balanced-brackets-v1': 'd0f4e9cb29b2a3fdeef9b417d599ae483a0d133f248bd347105e258cb5aabb81',
    'first-repeat-v1': 'c25ac6d86be14caa737f6c46b887908ce73aea9b93a4f1f0fb57550c0e5936da',
    'runs-v1': 'ff3ceef78778f1483133ac5d7793eba0f4e7060e568859a6b7a9da319884d1e9',
    'merge-sorted-v1': 'f6acf0205613c8dc352d0c882fd98eb71283b2992d20a59786b032c456433ae3',
}


def test_published_case_versions_remain_unchanged():
    # Include order and public/hidden partition: both affect candidate outcomes.
    for key, digest in REVIEWED_DIGESTS.items():
        payload = [PUBLIC_CASES[key], JUDGE_CASES[key]]
        actual = hashlib.sha256(json.dumps(payload, separators=(',', ':')).encode()).hexdigest()
        assert actual == digest, f'{key}: publish a new version instead of editing reviewed cases'


def oracle(key, text):
    if key == 'balanced-brackets-v1':
        # Repeatedly remove innermost pairs, independently of stack references.
        value = text.removesuffix('\n')
        if len(value) > 100000:
            return 'false\n'
        while True:
            reduced = value.replace('()', '').replace('[]', '').replace('{}', '')
            if reduced == value:
                return ('true' if not value else 'false') + '\n'
            value = reduced
    sentinel = 'null\n' if key == 'first-repeat-v1' else '[]\n'
    try:
        tokens = [int(token) for token in text.split()]
        sizes = tokens[:2] if key == 'merge-sorted-v1' else tokens[:1]
        if len(sizes) != (2 if key == 'merge-sorted-v1' else 1):
            return sentinel
        values = tokens[len(sizes):]
        if (any(n < 0 or n > 100000 for n in sizes) or sum(sizes) > 100000
                or len(values) != sum(sizes)
                or any(x < -2147483648 or x > 2147483647 for x in values)):
            return sentinel
        if key == 'first-repeat-v1':
            output = next((x for i, x in enumerate(values) if x in values[:i]), None)
        elif key == 'runs-v1':
            output = [[value, len(list(run))] for value, run in groupby(values)]
        else:
            left, right = values[:sizes[0]], values[sizes[0]:]
            if left != sorted(left) or right != sorted(right):
                return sentinel
            output = sorted(values)
        return json.dumps(output, separators=(',', ':')) + '\n'
    except ValueError:
        return sentinel


@pytest.mark.parametrize('key', list(JUDGE_CASES))
def test_reviewed_expected_results_match_independent_oracle(key):
    for category, stdin, expected in (*PUBLIC_CASES[key], *JUDGE_CASES[key]):
        assert stdin.endswith('\n') and expected.endswith('\n')
        assert oracle(key, stdin) == expected, (key, category, stdin)


@pytest.mark.parametrize('key', list(JUDGE_CASES))
def test_cases_reject_plausible_algorithm_mistakes(key):
    def mistaken_result(text):
        if key == 'balanced-brackets-v1':
            value = text.strip()
            return json.dumps(all(value.count(a) == value.count(b)
                                  for a, b in [('(', ')'), ('[', ']'), ('{', '}')])) + '\n'
        tokens = list(map(int, text.split()))
        values = tokens[2:] if key == 'merge-sorted-v1' else tokens[1:]
        if key == 'first-repeat-v1':
            # Wrong: smallest duplicate rather than first second occurrence.
            out = next((x for x in sorted(set(values)) if values.count(x) > 1), None)
        elif key == 'runs-v1':
            # Wrong: combine disjoint runs of the same value.
            out = list(map(list, Counter(values).items()))
        else:
            # Wrong: discard duplicate values while merging.
            out = sorted(set(values))
        return json.dumps(out, separators=(',', ':')) + '\n'

    distinguishing = [stdin for category, stdin, expected in JUDGE_CASES[key]
                      if category == 'normal' and mistaken_result(stdin) != expected]
    assert distinguishing, f'{key} must distinguish a plausible incorrect algorithm'
