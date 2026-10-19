"""Test-only ASGI entry. Never import this module in a deployed service."""
from app.main import create_app
from app.models import AnswerEvaluation
from app.services import ai_service


def question(role, level, previous_messages, **kwargs):
    count = sum(message.sender == 'you' for message in previous_messages)
    return f'Fixture question {count + 1}: Describe a concrete testing decision and its outcome.'


def evaluation(*args, **kwargs):
    return AnswerEvaluation(accuracy=8.0, completeness=7.0, clarity=8.0, structure=7.0,
                            went_well='FIXTURE_FEEDBACK: concrete example',
                            missing='FIXTURE_FEEDBACK: quantify the result',
                            stronger_answer='FIXTURE_FEEDBACK: explain the measurable outcome')


ai_service.generate_question = question
ai_service.evaluate_answer = evaluation
ai_service.generate_hint = lambda *args, **kwargs: 'Fixture hint: identify the goal first.'
app = create_app(seed=False)
