"""Versioned curated content. Reviewer notes must never enter candidate prompts."""
import json
from pathlib import Path
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import CODING_LANGUAGES, CODING_ROLES, InterviewSetup, Level, Role


class BankError(ValueError):
    """Invalid content or exhausted compatible questions."""


class BankQuestion(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    id: str = Field(min_length=1)
    version: Literal[1]
    roles: list[Role] = Field(min_length=1)
    levels: list[Level] = Field(min_length=1)
    type: Literal['Technical', 'Behavioral', 'Role-specific']
    topic: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    examples: list[str] = Field(default_factory=list)
    constraints: str = ''
    reviewerNotes: str = Field(min_length=1)
    judgeKey: str | None = None
    judgeSpecVersion: int | None = None

    @model_validator(mode='after')
    def coding_details(self):
        if self.type == 'Technical' and CODING_ROLES.intersection(self.roles):
            if not self.examples or not self.constraints.strip():
                raise ValueError('Coding entries require examples and constraints')
        if bool(self.judgeKey) != bool(self.judgeSpecVersion):
            raise ValueError('Judged questions require a versioned judge specification')
        return self

    def candidate_prompt(self, role: str) -> str:
        if role not in self.roles:
            raise BankError('Question does not support this role')
        language = ''
        if self.type == 'Technical' and role in CODING_ROLES:
            language = f' Use {CODING_LANGUAGES[role]}.' if role in CODING_LANGUAGES else ' Use your selected programming language.'
        sections = [self.prompt + language]
        if self.examples:
            sections.append('Examples:\n' + '\n'.join(self.examples))
        if self.constraints:
            sections.append('Constraints: ' + self.constraints)
        if self.judgeKey:
            contracts = {
                'balanced-brackets-v1': 'Read one line from standard input and print exactly true or false.',
                'first-repeat-v1': ('Read n followed by n signed 32-bit integers from standard input. Print the '
                                    'first repeated integer, or null if none repeats. Print null for malformed input.'),
                'runs-v1': ('Read n followed by n signed 32-bit integers from standard input. Print compact JSON '
                            'run pairs [[value,count],...] in encounter order. Print [] for malformed input.'),
                'merge-sorted-v1': ('Read n, m, then n and m signed 32-bit integers from standard input. Print '
                                    'the merged array as compact JSON. Print [] for malformed or unsorted input.'),
            }
            sections.append('Program contract: ' + contracts[self.judgeKey])
        return '\n\n'.join(sections)


def load_bank(path: Path | None = None) -> list[BankQuestion]:
    if path is None:
        directory = Path(__file__).resolve().parents[1] / 'data'
        questions = [question for source in sorted(directory.glob('*_questions.v1.json'))
                     for question in load_bank(source)]
        if not questions or len({q.id for q in questions}) != len(questions):
            raise BankError('Empty bank or duplicate question IDs')
        return questions
    try:
        payload = json.loads(path.read_text())
        if payload['version'] != 1:
            raise ValueError('Unsupported bank version')
        questions = [BankQuestion.model_validate(row) for row in payload['questions']]
        if len({q.id for q in questions}) != len(questions):
            raise ValueError('Duplicate question IDs')
        return questions
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise BankError('Invalid question bank') from exc


def select_question(questions: list[BankQuestion], setup: InterviewSetup,
                    used_ids: set[str]) -> BankQuestion:
    matches = sorted((q for q in questions if q.id not in used_ids
                      and setup.role in q.roles and setup.level in q.levels
                      and setup.type == q.type), key=lambda q: q.id)
    if not matches:
        raise BankError('No unused compatible curated question remains')
    return matches[0]


def validate_coverage(questions: list[BankQuestion],
                      setups: list[InterviewSetup] | None = None) -> None:
    """Require 15 distinct compatible questions for each supplied or MVP setup."""
    if setups is None:
        roles = get_args(Role)
        setups = [InterviewSetup(role=role, level=level, mode='Practice', questionCount=15,
                   type=kind, input='Text', language='English')
                  for role in roles for kind in ('Technical', 'Behavioral', 'Role-specific')
                  for level in ('Junior', 'Middle', 'Senior')]
    for setup in setups:
        used: set[str] = set()
        for _ in range(setup.questionCount):
            used.add(select_question(questions, setup, used).id)
