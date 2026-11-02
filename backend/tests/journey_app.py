"""Test-only ASGI entry. Never import this module in a deployed service."""
import re

from app.main import create_app
from app.models import AnswerEvaluation, StudyPlanDraft, StudyPlanDraftItem
from app.services import ai_service
from app.routers import interviews


def question(role, level, previous_messages, **kwargs):
    if kwargs.get('interview_language') == 'Russian':
        if not previous_messages:
            return 'Расскажите о конкретной ситуации, когда вы нашли важную ошибку?'
        return None
    count = sum(message.sender == 'ai' and message.kind == 'main'
                for message in previous_messages)
    return f'Fixture question {count + 1}: Describe a concrete testing decision and its outcome.'


def evaluation(*args, **kwargs):
    return AnswerEvaluation(accuracy=8.0, completeness=7.0, clarity=8.0, structure=7.0,
                            went_well='FIXTURE_FEEDBACK: concrete example',
                            missing='FIXTURE_FEEDBACK: quantify the result and test boundary cases',
                            stronger_answer='FIXTURE_FEEDBACK: explain the measurable outcome',
                            practice_topic='Boundary testing')


def translate_question(question):
    match = re.search(r'Fixture question (\d+)', question)
    number = match.group(1) if match else '1'
    return f'Опишите конкретное решение при тестировании и его результат, вариант {number}?'


def study_plan(evidence, _comparison_group):
    first_ref = evidence[0]['ref']
    first_report = first_ref.split('Q', 1)[0]
    second_ref = next(item['ref'] for item in evidence
                      if item['ref'].split('Q', 1)[0] != first_report)
    refs = [first_ref, second_ref]
    return StudyPlanDraft(items=[
        StudyPlanDraftItem(topic='Boundary testing',
            rationale='Reports show that boundary coverage can be more explicit.',
            action='Write tests for empty, minimum, maximum, and invalid inputs.', sourceRefs=refs),
        StudyPlanDraftItem(topic='Measuring outcomes',
            rationale='Reports can state the impact of decisions more clearly.',
            action='Add one measurable result to each practice answer.', sourceRefs=refs),
    ])


ai_service.generate_question = question
ai_service.evaluate_answer = evaluation
ai_service.generate_hint = lambda *args, **kwargs: 'Fixture hint: identify the goal first.'
ai_service.provider_supports_language = lambda language: language == 'Russian'
ai_service.translate_question_to_russian = translate_question
ai_service.generate_study_plan = study_plan


def coding_judge(language, code, judge_key, *, public_only=False):
    """Return deterministic public-example outcomes without requiring a runner service."""
    correct = (
        language == 'Python'
        and judge_key == 'balanced-brackets-v1'
        and "pairs = {')': '(', ']': '[', '}': '{'}" in code
        and "print(str(valid and not stack).lower())" in code
    )
    passed = 2 if correct else 0
    status = 'passed' if correct else 'failed'
    return {
        'status': status,
        'passed': passed,
        'total': 2,
        'summary': 'All reviewed public examples passed.' if correct else
            'The submitted code did not pass the reviewed public examples.',
    }


interviews.judge_code = coding_judge
app = create_app(seed=False)


@app.get('/api/__test__/mailbox')
def test_mailbox(email: str):
    """Expose only test-runner recovery messages; this route is never in the production app."""
    messages = getattr(app.state.mailer, 'messages', [])
    return {'messages': [message for message in messages if message['to'] == email]}
