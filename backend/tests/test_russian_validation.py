import json
import sys
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import AnswerEvaluation
from app.services import ai_service
from app.validation import russian


@pytest.fixture
def localized_provider(monkeypatch):
    calls = []
    monkeypatch.setattr(ai_service, 'provider_supports_language', lambda language: language == 'Russian')

    def question(role, level, previous, **kwargs):
        calls.append(('question', kwargs.get('interview_language')))
        return next(case.question for case in russian.load_cases()
                    if case.role == role and case.interview_type == kwargs['interview_type'])

    def evaluation(question, answer, **kwargs):
        calls.append(('evaluation', kwargs.get('interview_language')))
        code = kwargs.get('language')
        return AnswerEvaluation(accuracy=8, completeness=8, clarity=8, structure=8, went_well='',
            missing='Не описаны дополнительные способы проверки результата.',
            stronger_answer=('Проверьте результат и опишите влияние выбранного подхода.' if not code
                             else '# Проверьте пустой список и случай без повторений.\n' + answer),
            practice_topic='Проверка результатов')

    def followup(*args, **kwargs):
        calls.append(('followup', kwargs.get('interview_language')))
        return 'Почему вы выбрали этот подход и как проверили результат?'

    def hint(*args, **kwargs):
        calls.append(('hint', kwargs.get('interview_language')))
        return 'Сначала уточните требуемый результат и подходящую структуру данных.'

    monkeypatch.setattr(ai_service, 'generate_question', question)
    monkeypatch.setattr(ai_service, 'evaluate_answer', evaluation)
    monkeypatch.setattr(ai_service, 'generate_followup', followup)
    monkeypatch.setattr(ai_service, 'generate_hint', hint)
    return calls


def test_fixture_matrix_covers_content_types_and_requires_human_review(localized_provider, monkeypatch):
    monkeypatch.setenv('AI_API_KEY', 'never-include-this-secret-in-artifacts')
    cases = russian.load_cases()
    assert {case.interview_type for case in cases} == {'Technical', 'Behavioral', 'Role-specific'}
    result = russian.validate(cases)
    assert result['automatedPassed'] is True
    assert result['releaseApproved'] is False
    assert len(result['checks']) == 1 + 6 * len(cases)
    assert all(case['humanReviewChecks'] for case in result['artifacts'])
    assert all(language == 'Russian' for _, language in localized_provider)
    assert 'never-include-this-secret' not in json.dumps(result)
    assert result['recognitionLocale'] == result['synthesisLocale'] == 'ru-RU'


def test_unavailable_combination_fails_preflight_without_provider_calls(localized_provider, monkeypatch):
    monkeypatch.setattr(ai_service, 'provider_supports_language', lambda language: False)
    result = russian.validate(russian.load_cases())
    assert not result['automatedPassed'] and not result['releaseApproved']
    assert result['checks'] == [{'case': None, 'stage': 'provider-matrix', 'passed': False,
                                'reason': 'Configured Russian preview and allowlisted provider/model are required.'}]
    assert localized_provider == []


def test_validation_flags_mixed_language_instead_of_approving_release(localized_provider, monkeypatch):
    monkeypatch.setattr(ai_service, 'generate_hint', lambda *a, **kw:
        'Сначала уточните результат, проверьте требования и внимательно сравните варианты решения. '
        'Could you explain your solution?')
    result = russian.validate(russian.load_cases()[:1])
    assert not result['automatedPassed']
    assert any(check['stage'] == 'hint' and not check['passed'] for check in result['checks'])
    assert not result['releaseApproved']


def test_cli_requires_explicit_live_opt_in(monkeypatch, tmp_path):
    probe = Mock(side_effect=AssertionError('No provider use without opt-in'))
    monkeypatch.setattr(russian, 'validate', probe)
    monkeypatch.setattr(sys, 'argv', ['russian', '--output', str(tmp_path / 'report.json')])
    with pytest.raises(SystemExit) as error:
        russian.main()
    assert error.value.code == 2
    probe.assert_not_called()


@pytest.mark.parametrize('prose', [
    'Сравните SQL, NoSQL, REST, GraphQL, HTTP и JSON. Как выбрать подход для проекта?',
    'Объясните решение и оцените сложность. ```python\nfor value in values:\n    print(value)\n```',
])
def test_technical_terms_and_code_are_not_mistaken_for_english_prose(prose):
    assert ai_service.has_russian_text(prose)


@pytest.mark.parametrize('english_clause', ['Could you explain your approach?', 'The candidate missed the point.',
                                          'You should provide more examples.'])
def test_russian_majority_does_not_hide_an_english_coaching_sentence(english_clause):
    assert not ai_service.has_russian_text(
        'Вы последовательно описали ситуацию, уточнили требования, проверили результаты и согласовали план с командой. '
        + english_clause)


@pytest.mark.parametrize('question, kind', [
    ('Расскажите, какие проверки необходимы для новой функции и как определить их приоритет?', 'Role-specific'),
    ('Расскажите, как вы организуете процесс проверки требований?', 'Role-specific'),
    ('Приведите пример использования индекса в базе данных и объясните его ограничения?', 'Technical'),
])
def test_russian_workflow_leadins_are_not_mistaken_for_personal_history(question, kind):
    assert ai_service._compatible_question(question, 'QA Engineer', kind, 'Russian')


@pytest.mark.parametrize('kind', ['Technical', 'Role-specific'])
def test_explicit_personal_history_is_still_rejected_outside_behavioral(kind):
    assert not ai_service._compatible_question('Расскажите о случае, когда вы разрешили конфликт в команде?',
                                            'QA Engineer', kind, 'Russian')


@pytest.mark.parametrize('case', russian.load_cases(), ids=lambda case: case.id)
@pytest.mark.parametrize('interaction', ['Text', 'Voice'])
def test_api_journey_preserves_russian_after_profile_changes(tmp_path, localized_provider, case, interaction):
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "journey.db"}')) as client:
        assert client.post('/api/auth/login', json={
            'email': 'demo@example.com', 'password': 'demo-password'}).status_code == 200
        profile = client.get('/api/auth/me').json()
        profile_update = {name: profile[name] for name in ('name', 'targetRole', 'level')}
        assert client.patch('/api/auth/me', json=profile_update | {'preferredLanguage': 'Russian'}).status_code == 200
        started = client.post('/api/interviews', json={'role': case.role, 'level': 'Middle',
            'type': case.interview_type, 'mode': 'Practice', 'questionCount': 5,
            'input': interaction, 'language': 'Russian'})
        assert started.status_code == 201
        interview = started.json()
        path = f"/api/interviews/{interview['id']}"
        assert client.patch('/api/auth/me', json=profile_update | {'preferredLanguage': 'English'}).status_code == 200
        assert client.get('/api/auth/me').json()['preferredLanguage'] == 'English'
        hinted = client.post(path + '/hint')
        assert hinted.status_code == 200 and ai_service.has_russian_text(hinted.json()['messages'][-1]['text'])
        body = {'text': case.answer, 'expectedQuestionId': interview['messages'][0]['id']}
        if case.coding_language:
            body['selectedLanguage'] = case.coding_language
        scored = client.post(path + '/messages', json=body)
        assert scored.status_code == 200 and scored.json()['lastAnswerFeedback']['accuracy'] == 8
        continued = client.post(path + '/next-question')
        assert continued.status_code == 200
        assert continued.json()['messages'][-1]['kind'] == 'main'
        assert continued.json()['answeredCount'] == 1
        assert client.post(path + '/end').status_code == 200
        saved = client.get(path + '/report').json()
        assert saved['interview']['setup']['language'] == 'Russian'
        assert saved['interview']['setup']['input'] == interaction
        assert saved['feedback']['questions'][0]['answer'] == case.answer
        assert saved['feedback']['questions'][0]['scores']['accuracy'] == 8
        assert ai_service.has_russian_text(saved['feedback']['questions'][0]['miss'])
        assert all(language == 'Russian' for _, language in localized_provider)
