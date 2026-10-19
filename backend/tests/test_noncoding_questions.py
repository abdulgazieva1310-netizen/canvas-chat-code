from itertools import product

import pytest

from app.models import InterviewSetup
from app.services.question_bank import BankError, load_bank, select_question, validate_coverage

ROLES = ['Frontend Developer', 'QA Engineer', 'Data Analyst', 'DevOps Engineer']


@pytest.mark.parametrize('role,level', list(product(ROLES, ['Junior', 'Middle', 'Senior'])))
def test_noncoding_technical_selection(role, level):
    setup = InterviewSetup(role=role, level=level, type='Technical', mode='Practice', questionCount=15,
                           input='Text', language='English')
    bank = load_bank()
    used, prompts, topics = set(), set(), set()
    for _ in range(15):
        entry = select_question(bank, setup, used)
        prompt = entry.candidate_prompt(role)
        assert entry.roles == [role] and entry.levels == [level]
        assert entry.reviewerNotes not in prompt
        assert 'Examples:' not in prompt and 'Constraints:' not in prompt
        assert len(prompt) >= 90 and len(entry.reviewerNotes) >= 70
        used.add(entry.id)
        prompts.add(prompt)
        topics.add(entry.topic)
    assert len(used) == len(prompts) == len(topics) == 15
    with pytest.raises(BankError):
        select_question(bank, setup, used)


def test_entire_mvp_bank_has_full_coverage_and_distinct_original_prompts():
    bank = load_bank()
    assert len(bank) == 495
    assert len({entry.prompt for entry in bank}) == len(bank)
    validate_coverage(bank)
    for role in ROLES:
        rows = [q for q in bank if q.roles == [role] and q.type == 'Technical']
        assert len(rows) == 45
        for topic in {q.topic for q in rows}:
            versions = [q for q in rows if q.topic == topic]
            assert len(versions) == 3
            assert len({q.prompt for q in versions}) == 3
