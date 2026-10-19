import pytest

from app.models import AnswerEvaluation
from app.services.difficulty import transition
from app.services.question_bank import BankQuestion


def evaluation(accuracy, completeness=None, clarity=None, structure=None):
    return AnswerEvaluation(accuracy=accuracy, completeness=completeness, clarity=clarity,
        structure=structure, went_well='Good evidence.', missing='Add details.',
        stronger_answer='A concrete example.')


@pytest.mark.parametrize(('level', 'value', 'expected'), [
    ('Middle', 8, 'Senior'),
    ('Middle', 4, 'Junior'),
    ('Middle', 7.9, 'Middle'),
    ('Middle', 4.1, 'Middle'),
    ('Junior', 4, 'Junior'),
    ('Senior', 8, 'Senior'),
    ('Middle', 7.95, 'Middle'),
])
def test_difficulty_thresholds_and_level_bounds(level, value, expected):
    effective, average, reason = transition(level, evaluation(value))
    assert effective == expected
    assert average == round(value, 1)
    assert reason


def test_difficulty_averages_only_applicable_categories():
    effective, average, reason = transition('Middle', evaluation(10, None, 6, None))
    assert (effective, average) == ('Senior', 8)
    assert 'at least 8' in reason


@pytest.mark.parametrize('evaluation_value', [None, evaluation(None, None, None, None)])
def test_missing_or_unscored_evaluations_keep_the_level(evaluation_value):
    level, average, reason = transition('Middle', evaluation_value)
    assert level == 'Middle'
    assert average is None
    assert 'kept Middle' in reason


def test_curated_practice_question_selection_uses_effective_level(monkeypatch):
    from app.models import InterviewSetup
    from app.store import question
    from app import store as store_module
    rows = [
        BankQuestion(id='junior', version=1, roles=['Python Developer'], levels=['Junior'],
            type='Technical', topic='hashing', prompt='Junior hash question', examples=['a'],
            constraints='n >= 0', reviewerNotes='notes'),
        BankQuestion(id='senior', version=1, roles=['Python Developer'], levels=['Senior'],
            type='Technical', topic='hashing', prompt='Senior hash question', examples=['a'],
            constraints='n >= 0', reviewerNotes='notes'),
    ]
    monkeypatch.setattr(store_module, 'load_bank', lambda: rows)
    setup = InterviewSetup(role='Python Developer', level='Middle', mode='Practice', questionCount=5,
        type='Technical', input='Text', language='English', practiceTopic='hashing')
    assert question(setup, 0, effective_level='Senior') == rows[1].candidate_prompt('Python Developer')
