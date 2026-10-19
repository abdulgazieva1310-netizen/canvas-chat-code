import json
from itertools import product

import pytest
from pydantic import ValidationError

from app.models import CODING_ROLES, InterviewSetup, Role
from app.services.question_bank import (
    BankError, BankQuestion, load_bank, select_question, validate_coverage,
)


def setup(role='Python Developer', level='Junior', **overrides):
    return InterviewSetup(**(dict(role=role, level=level, mode='Practice',
                                 questionCount=15, type='Technical', input='Text',
                                 language='English') | overrides))


@pytest.mark.parametrize('role,level', list(product(sorted(CODING_ROLES), ['Junior', 'Middle', 'Senior'])))
def test_fifteen_distinct_compatible_questions(role, level):
    bank = load_bank()
    config = setup(role, level)
    used = set()
    prompts = set()
    for _ in range(15):
        question = select_question(bank, config, used)
        assert question == select_question(list(reversed(bank)), config, used)
        assert question.levels == [level]
        assert role in question.roles
        assert question.type == 'Technical'
        rendered = question.candidate_prompt(role)
        assert 'Implement' in rendered and 'complexity' in rendered
        assert question.reviewerNotes not in rendered
        assert 'Examples:' in rendered and 'Constraints:' in rendered
        language = {'Java Developer': 'Java', 'Python Developer': 'Python', 'C++ Developer': 'C++'}.get(role)
        assert (f'Use {language}.' if language else 'Use your selected programming language.') in rendered
        used.add(question.id)
        prompts.add(question.prompt)
    assert len(used) == len(prompts) == 15
    with pytest.raises(BankError, match='No unused compatible'):
        select_question(bank, config, used)


def test_full_coding_coverage():
    bank = load_bank()
    assert len(bank) == 45
    validate_coverage(bank, [setup(role, level) for role, level in
                           product(sorted(CODING_ROLES), ['Junior', 'Middle', 'Senior'])])
    with pytest.raises(BankError):
        validate_coverage(bank[:-1], [setup(level='Senior')])


def test_default_coverage_validator_checks_all_role_type_level_combinations():
    levels = ['Junior', 'Middle', 'Senior']
    roles = list(Role.__args__)
    questions = []
    for kind in ('Technical', 'Behavioral', 'Role-specific'):
        for index in range(15):
            questions.append(BankQuestion(
                id=f'{kind.lower()}-{index:02}', version=1, roles=roles, levels=levels,
                type=kind, topic=f'{kind} topic {index}',
                prompt=('Implement a function and analyze its complexity.' if kind == 'Technical' else
                        'Tell me about a time you handled a challenging situation?' if kind == 'Behavioral' else
                        'How would you handle this role-specific workplace scenario?'),
                examples=['Input: [1, 2]. Output: 3.'] if kind == 'Technical' else [],
                constraints='1 <= n <= 100' if kind == 'Technical' else '',
                reviewerNotes=f'Expected concepts for {kind} prompt {index}.',
            ))
    validate_coverage(questions)
    with pytest.raises(BankError, match='No unused compatible'):
        validate_coverage(questions[:-1])


def test_incompatible_role_type_and_empty_bank():
    for config in [setup(role='QA Engineer'), setup(type='Behavioral'), setup(type='Role-specific')]:
        with pytest.raises(BankError):
            select_question(load_bank(), config, set())
    with pytest.raises(BankError):
        select_question([], setup(), set())
    with pytest.raises(BankError):
        load_bank()[0].candidate_prompt('QA Engineer')


@pytest.mark.parametrize('change', [dict(roles=['Unknown']), dict(levels=['Expert']),
                                    dict(examples=[]), dict(constraints=''), dict(version=2)])
def test_invalid_entries(change):
    with pytest.raises(ValidationError):
        BankQuestion.model_validate(load_bank()[0].model_dump() | change)


@pytest.mark.parametrize('kind', ['duplicate', 'version', 'malformed', 'missing'])
def test_invalid_bank(tmp_path, kind):
    path = tmp_path / 'bank.json'
    row = load_bank()[0].model_dump()
    if kind == 'duplicate':
        path.write_text(json.dumps(dict(version=1, questions=[row, row])))
    elif kind == 'version':
        path.write_text(json.dumps(dict(version=2, questions=[row])))
    elif kind == 'malformed':
        path.write_text('!')
    with pytest.raises(BankError):
        load_bank(path)
