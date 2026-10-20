import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import ai_service
from app.models import AnswerEvaluation


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "languages.db"}')) as test_client:
        yield test_client


def login(client):
    assert client.post('/api/auth/login', json={
        'email': 'demo@example.com', 'password': 'demo-password'}).status_code == 200


def setup(language='Russian', **kwargs):
    return {'role': 'QA Engineer', 'level': 'Middle', 'mode': 'Practice',
            'questionCount': 5, 'type': 'Behavioral', 'input': 'Text',
            'language': language} | kwargs


def test_russian_session_persists_language_and_generates_content_in_that_language(client, monkeypatch):
    calls = []
    monkeypatch.setattr(ai_service, 'provider_supports_language', lambda language: language == 'Russian')

    def question(*args, **kwargs):
        calls.append(kwargs.get('interview_language'))
        return 'Расскажите о ситуации, когда вы нашли важную ошибку в проекте?'

    monkeypatch.setattr(ai_service, 'generate_question', question)
    login(client)
    response = client.post('/api/interviews', json=setup())
    assert response.status_code == 201
    interview = response.json()
    assert interview['setup']['language'] == 'Russian'
    assert interview['messages'][0]['text'].startswith('Расскажите')
    assert calls == ['Russian']


def test_russian_provider_failure_is_clear_and_does_not_use_english_fallback(client, monkeypatch):
    monkeypatch.setattr(ai_service, 'provider_supports_language', lambda _language: False)
    login(client)
    response = client.post('/api/interviews', json=setup())
    assert response.status_code == 503
    assert 'select English' in response.json()['message']
    assert client.get('/api/interviews').json()['total'] == 2


def test_russian_evaluation_failure_does_not_silently_save_an_unlocalized_answer(client, monkeypatch):
    monkeypatch.setattr(ai_service, 'provider_supports_language', lambda _language: True)
    monkeypatch.setattr(ai_service, 'generate_question', lambda *args, **kwargs:
                        'Расскажите о случае, когда вы решили сложную задачу?')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: None)
    login(client)
    interview = client.post('/api/interviews', json=setup()).json()
    response = client.post(f"/api/interviews/{interview['id']}/messages",
                           json={'text': 'Я проверил проблему и нашёл причину.'})
    assert response.status_code == 503
    assert 'answer was not saved' in response.json()['message']
    saved = client.get(f"/api/interviews/{interview['id']}").json()
    assert saved['answeredCount'] == 0 and len(saved['messages']) == 1


def test_russian_answer_feedback_and_hint_keep_the_selected_language(client, monkeypatch):
    evaluation = AnswerEvaluation(accuracy=8, completeness=8, clarity=8, structure=8,
        went_well='Вы системно проверили гипотезу.', missing='Не указали влияние исправления.',
        stronger_answer='Я проверил гипотезу и подтвердил результат метриками.',
        practice_topic='Проверка результатов')
    monkeypatch.setattr(ai_service, 'provider_supports_language', lambda _language: True)
    monkeypatch.setattr(ai_service, 'generate_question', lambda *args, **kwargs:
                        'Расскажите о случае, когда вы решили сложную задачу?')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: evaluation)
    followup_calls = []
    monkeypatch.setattr(ai_service, 'generate_followup', lambda *args, **kwargs:
                        followup_calls.append(kwargs.get('interview_language')) or None)
    monkeypatch.setattr(ai_service, 'generate_hint', lambda *args, **kwargs:
                        'Сначала уточните, как вы проверили исходную гипотезу.')
    login(client)
    interview = client.post('/api/interviews', json=setup()).json()
    hinted = client.post(f"/api/interviews/{interview['id']}/hint").json()
    assert hinted['messages'][-1]['text'].startswith('Сначала')
    answered = client.post(f"/api/interviews/{interview['id']}/messages",
                           json={'text': 'Я системно проверил гипотезу и подтвердил результат.'}).json()
    assert answered['lastAnswerFeedback']['went_well'].startswith('Вы')
    assert followup_calls == ['Russian']
    client.post(f"/api/interviews/{interview['id']}/end")
    report = client.get(f"/api/interviews/{interview['id']}/report").json()
    assert report['feedback']['questions'][0]['better'].startswith('Я проверил')


def test_groq_prompts_and_validates_russian_questions_hints_followups_and_feedback(monkeypatch):
    responses = [
        'Расскажите о ситуации, когда вы нашли важную ошибку? ',
        'Почему вы выбрали именно этот способ проверки?',
        {'accuracy': 8, 'completeness': 7, 'clarity': 8, 'structure': 7,
         'went_well': 'Вы последовательно проверили гипотезу.',
         'missing': 'Не указали влияние исправления.',
         'stronger_answer': 'Я проверил гипотезу и подтвердил результат.',
         'practice_topic': 'Проверка гипотез'},
        'Сначала уточните ожидаемое поведение до проверки.',
    ]
    prompts = []

    class Response:
        status_code = 200
        text = ''

        def __init__(self, content):
            self.content = content

        def raise_for_status(self):
            pass

        def json(self):
            import json
            content = json.dumps(self.content, ensure_ascii=False) if isinstance(self.content, dict) else self.content
            return {'choices': [{'finish_reason': 'stop', 'message': {'content': content}}]}

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def post(self, _url, *, json, **_kwargs):
            prompts.append(json['messages'][0]['content'])
            return Response(responses.pop(0))

    monkeypatch.setenv('AI_API_KEY', 'test-provider-key')
    monkeypatch.setenv('AI_MODEL', 'openai/gpt-oss-120b')
    monkeypatch.setattr(ai_service.httpx, 'Client', Client)
    question = ai_service.generate_question('QA Engineer', 'Middle', [],
        interview_type='Behavioral', interview_language='Russian')
    followup = ai_service.generate_followup('QA Engineer', 'Middle', 'Behavioral',
        question, 'Я провёл проверку.', interview_language='Russian')
    evaluation = ai_service.evaluate_answer(question, 'Я провёл проверку.', interview_language='Russian')
    hint = ai_service.generate_hint(question, [], role='QA Engineer', level='Middle',
        interview_type='Behavioral', interview_language='Russian')
    assert question and followup and evaluation and hint
    assert evaluation.missing.startswith('Не указали')
    assert all('Russian' in prompt for prompt in prompts)
    assert ai_service._compatible_question('Describe a time you found a defect?',
        'QA Engineer', 'Behavioral', 'Russian') is False


def test_russian_matrix_rejects_unreviewed_provider_model(monkeypatch):
    monkeypatch.setenv('AI_API_KEY', 'provider-key')
    monkeypatch.setenv('AI_MODEL', 'unsupported-model')
    assert not ai_service.provider_supports_language('Russian')
    assert ai_service.provider_supports_language('Klingon') is False


def test_russian_preview_requires_explicit_enablement_and_real_configuration(monkeypatch):
    monkeypatch.setenv('AI_API_KEY', 'test-key')
    monkeypatch.setenv('AI_MODEL', 'openai/gpt-oss-120b')
    monkeypatch.delenv('ENABLE_RUSSIAN_INTERVIEWS', raising=False)
    assert not ai_service.provider_supports_language('Russian')
    monkeypatch.setenv('ENABLE_RUSSIAN_INTERVIEWS', 'true')
    assert ai_service.provider_supports_language('Russian')
    monkeypatch.setenv('AI_API_KEY', 'your_api_key_here')
    assert not ai_service.provider_supports_language('Russian')


def test_profile_changes_do_not_change_saved_session_language(client, monkeypatch):
    monkeypatch.setattr(ai_service, 'provider_supports_language', lambda _language: True)
    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **kw: 'Расскажите о ситуации, когда вы исправили ошибку?')
    login(client)
    interview = client.post('/api/interviews', json=setup()).json()
    profile = client.get('/api/auth/me').json()
    client.patch('/api/auth/me', json={**profile, 'preferredLanguage': 'English'})
    assert client.get(f"/api/interviews/{interview['id']}").json()['setup']['language'] == 'Russian'
    assert client.post('/api/interviews', json=setup('Klingon')).status_code == 400


def test_question_and_hint_failures_do_not_mix_languages(client, monkeypatch):
    monkeypatch.setattr(ai_service, 'provider_supports_language', lambda _language: True)
    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **kw: 'Расскажите о ситуации, когда вы исправили ошибку?')
    login(client)
    interview = client.post('/api/interviews', json=setup()).json()
    monkeypatch.setattr(ai_service, 'generate_hint', lambda *a, **kw: None)
    assert client.post(f"/api/interviews/{interview['id']}/hint").status_code == 503
    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **kw: None)
    assert client.post('/api/interviews', json=setup()).status_code == 503
    saved = client.get(f"/api/interviews/{interview['id']}").json()
    assert saved['messages'] == interview['messages']
    # English remains an explicit choice with its normal curated fallback.
    english = client.post('/api/interviews', json=setup('English'))
    assert english.status_code == 201 and english.json()['setup']['language'] == 'English'


def test_russian_guard_rejects_english_with_token_cyrillic_and_preserves_code():
    assert not ai_service.has_russian_text('Explain the design and provide examples. Да.')
    assert ai_service.has_russian_text('Объясните решение и оцените сложность. ```python\ndef solve(items):\n return sorted(items)\n```')


def test_reasoning_model_receives_visible_output_budget_without_affecting_other_models(monkeypatch):
    monkeypatch.setenv('AI_MODEL','openai/gpt-oss-120b')
    assert ai_service.model_options(256)=={'model':'openai/gpt-oss-120b','reasoning_effort':'low','max_completion_tokens':2048}
    monkeypatch.setenv('AI_MODEL','test-model')
    assert ai_service.model_options(256)=={'model':'test-model','max_completion_tokens':256}
