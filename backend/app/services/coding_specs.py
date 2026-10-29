"""Immutable, reviewed execution contracts; never inferred from AI question text."""
from types import MappingProxyType

from ..models import Message

LANGUAGES = frozenset({'Python', 'Java', 'C++', 'JavaScript', 'TypeScript'})
REVIEWED_QUESTIONS = frozenset({
    ('coding-junior-balanced', 1, 'balanced-brackets-v1', 1),
    ('coding-junior-first-repeat', 1, 'first-repeat-v1', 1),
    ('coding-junior-runs', 1, 'runs-v1', 1),
    ('coding-junior-merge-sorted', 1, 'merge-sorted-v1', 1),
})


def reviewed_judge_key(question: Message, language: str) -> str | None:
    identity = (question.codingQuestionId, question.codingQuestionVersion,
                question.codingJudgeSpecKey, question.codingJudgeSpecVersion)
    return question.codingJudgeSpecKey if (question.kind == 'main' and language in LANGUAGES
                                          and identity in REVIEWED_QUESTIONS) else None


JUDGE_CASES = {
    'balanced-brackets-v1': [
        ('normal', '{}[]\n', 'true\n'),
        ('normal', '{[}]\n', 'false\n'),
        ('boundary', '\n', 'true\n'),
        ('boundary', '(((())))\n', 'true\n'),
        ('invalid-input', '(a)\n', 'false\n'),
    ],
    'first-repeat-v1': [
        ('normal', '4 4 2 4 2\n', '4\n'),
        ('normal', '3 1 2 3\n', 'null\n'),
        ('boundary', '0\n', 'null\n'),
        ('boundary', '3 -2147483648 0 -2147483648\n', '-2147483648\n'),
        ('boundary', '2 7 7\n', '7\n'),
        ('invalid-input', '-1\n', 'null\n'),
        ('invalid-input', '2 x 1\n', 'null\n'),
    ],
    'runs-v1': [
        ('normal', '4 2 2 3 2\n', '[[2,2],[3,1],[2,1]]\n'),
        ('normal', '3 5 5 5\n', '[[5,3]]\n'),
        ('boundary', '0\n', '[]\n'),
        ('boundary', '2 -2147483648 2147483647\n', '[[-2147483648,1],[2147483647,1]]\n'),
        ('boundary', '1 0\n', '[[0,1]]\n'),
        ('invalid-input', '-1\n', '[]\n'),
        ('invalid-input', '2 1 x\n', '[]\n'),
    ],
    'merge-sorted-v1': [
        ('normal', '2 2 1 3 2 3\n', '[1,2,3,3]\n'),
        ('normal', '3 0 1 2 3\n', '[1,2,3]\n'),
        ('boundary', '0 0\n', '[]\n'),
        ('boundary', '1 1 -2147483648 2147483647\n', '[-2147483648,2147483647]\n'),
        ('boundary', '2 2 1 1 1 1\n', '[1,1,1,1]\n'),
        ('invalid-input', '-1 0\n', '[]\n'),
        ('invalid-input', '2 1 3 1 2\n', '[]\n'),
    ],
}

# Public cases are deliberately separate: Run examples must never execute hidden cases.
PUBLIC_CASES = {
    'balanced-brackets-v1': [('public', '([])\n', 'true\n'), ('public', '([)]\n', 'false\n')],
    'first-repeat-v1': [('public', '4 4 2 4 2\n', '4\n'), ('public', '3 1 2 3\n', 'null\n')],
    'runs-v1': [('public', '4 2 2 3 2\n', '[[2,2],[3,1],[2,1]]\n'), ('public', '0\n', '[]\n')],
    'merge-sorted-v1': [('public', '2 2 1 3 2 3\n', '[1,2,3,3]\n'), ('public', '0 0\n', '[]\n')],
}

# Reviewed versions are append-only. A contract change needs a new version/key.
JUDGE_CASES = MappingProxyType({key: tuple(cases) for key, cases in JUDGE_CASES.items()})
PUBLIC_CASES = MappingProxyType({key: tuple(cases) for key, cases in PUBLIC_CASES.items()})
