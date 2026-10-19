from itertools import product
from typing import get_args

import pytest

from app.models import InterviewSetup, Role
from app.services.question_bank import BankError, load_bank, select_question, validate_coverage


@pytest.mark.parametrize('role,kind,level', list(product(get_args(Role), ['Behavioral', 'Role-specific'], ['Junior', 'Middle', 'Senior'])))
def test_workplace_coverage_and_candidate_suitability(role, kind, level):
    setup = InterviewSetup(role=role, level=level, type=kind, mode='Practice', questionCount=15,
                           input='Text', language='English')
    bank = load_bank()
    used = set()
    prompts = set()
    topics = set()
    for _ in range(15):
        question = select_question(bank, setup, used)
        rendered = question.candidate_prompt(role)
        assert question.levels == [level]
        assert question.reviewerNotes not in rendered
        assert 'Implement' not in rendered
        assert 'Constraints:' not in rendered and 'Examples:' not in rendered
        if kind == 'Behavioral':
            assert 'situation, your actions, the result' in rendered
        used.add(question.id)
        prompts.add(rendered)
        topics.add(question.topic)
    assert len(used) == len(prompts) == len(topics) == 15
    with pytest.raises(BankError):
        select_question(bank, setup, used)
    validate_coverage(bank, [setup])


def test_reusable_prompts_are_shared_records_and_ids_are_stable():
    bank = load_bank()
    assert [q.id for q in bank] == [q.id for q in load_bank()]
    assert len({q.id for q in bank}) == len(bank)
    behavioral = [q for q in bank if q.type == 'Behavioral']
    assert len(behavioral) == 45
    assert all(set(q.roles) == set(get_args(Role)) for q in behavioral)
    assert len({q.prompt for q in bank}) == len(bank)
