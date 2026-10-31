import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.services import ai_service
from app.main import create_app
from app.store import practice_topics


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setenv('AI_API_KEY', 'test-key')
    monkeypatch.setenv('AI_MODEL', 'openai/gpt-oss-120b')
    monkeypatch.setenv('ENABLE_RUSSIAN_INTERVIEWS', 'true')
    client_class = httpx.Client

    def install(handler):
        monkeypatch.setattr(ai_service.httpx, 'Client', lambda **kwargs: client_class(
            transport=httpx.MockTransport(handler), **kwargs))

    return install


def completion(content, finish='stop'):
    return httpx.Response(200, json={'choices': [{
        'finish_reason': finish, 'message': {'content': json.dumps(content, ensure_ascii=False)
                                           if isinstance(content, dict) else content}}]})


@pytest.mark.parametrize('verdict', [{'valid': False}, {'valid': 'true'}, {'valid': 1}, {}, [], None])
def test_unapproved_or_malformed_review_cannot_release_content(provider, verdict):
    provider(lambda request: completion(verdict))
    assert not ai_service._russian_content_is_relevant('hint', {'question': 'Вопрос?'}, 'Подсказка')


def test_review_outage_rejects_content(provider):
    provider(lambda request: httpx.Response(503))
    assert not ai_service._russian_content_is_relevant('question', {}, 'Вопрос?')


def test_contradictory_coding_question_is_not_returned(provider):
    calls = []

    def handler(request):
        payload = json.loads(request.content)
        calls.append(payload)
        if len(calls) == 1:
            return completion('Условие: выберите точки внутри отрезков. Ограничения: один отрезок. '
                              'Пример: покройте каждый отрезок. Реализуйте функцию на Python.')
        assert 'quantifiers' in calls[0]['messages'][0]['content']
        assert 'EVERY INTERVAL' in calls[0]['messages'][0]['content']
        assert 'Reject contradictions' in payload['messages'][0]['content']
        assert 'JSON' in payload['messages'][0]['content']
        assert json.loads(payload['messages'][1]['content'])['kind'] == 'question'
        return completion({'valid': False})

    provider(handler)
    assert ai_service.generate_question('Python Developer', 'Middle', [], interview_language='Russian') is None
    assert len(calls) == 2


def test_behavioral_command_tutorial_is_not_saved_as_coaching(provider):
    calls = []
    def handler(request):
        calls.append(request)
        return completion(evaluation_payload(
            stronger_answer='Исправьте конфликт командами git merge и git add.'))
    provider(handler)
    assert ai_service.evaluate_answer('Опишите конфликт приоритетов в команде?',
        'Я обсудил причину ошибки с командой.', interview_language='Russian') is None
    assert len(calls) == 2


def test_off_topic_hint_rejected_and_approved_hint_kept(provider):
    for valid in [False, True]:
        calls = []

        def handler(request):
            payload = json.loads(request.content)
            calls.append(payload)
            assert request.extensions['timeout']['read'] == 30
            if len(calls) == 1:
                assert payload['max_completion_tokens'] == 4096
                return completion('Сначала отсортируйте отрезки по правой границе.')
            assert json.loads(payload['messages'][1]['content'])['kind'] == 'hint'
            return completion({'valid': valid})

        provider(handler)
        hint = ai_service.generate_hint('Покройте каждый отрезок точкой.', [], role='Python Developer',
                                       level='Middle', interview_type='Technical', interview_language='Russian')
        assert bool(hint) is valid


@pytest.mark.parametrize('language, code', [
    ('Python', 'def solve(values: list[int]) -> int | None:\n    """Возвращает первое повторяющееся число."""\n    seen = set()\n    for value in values:\n        if value in seen:\n            return value\n        seen.add(value)\n    return None'),
    ('Java', '```java\n// Возвращает первое повторяющееся число в массиве.\nInteger solve(int[] values) { return null; }\n```'),
])
def test_russian_coding_annotations_are_not_rejected_as_english(provider, language, code):
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return completion({'accuracy': 8, 'completeness': 8, 'clarity': 8, 'structure': 8,
                               'went_well': 'Использовано множество для поиска повторений.',
                               'missing': 'Не описано поведение для пустого списка.',
                               'stronger_answer': code, 'practice_topic': 'Граничные случаи'})
        return completion({'valid': True})

    provider(handler)
    result = ai_service.evaluate_answer('Найдите первое повторяющееся число.', code,
                                         language=language, interview_language='Russian')
    assert result is not None and result.stronger_answer == code
    assert len(calls) == 1


def test_english_only_code_feedback_is_still_rejected():
    assert not ai_service.has_russian_code_feedback('def solve(values):\n    """Find a duplicate."""\n    return None')


def test_no_russian_gaps_does_not_create_a_practice_recommendation():
    assert practice_topics('Конкретных пробелов не выявлено.', None) == []


@pytest.mark.parametrize('observation, expected', [
    ('Кандидат разрешил конфликт приоритетов.', ''),
    ('Я обсудил причину ошибки с командой.', 'Я обсудил причину ошибки с командой.'),
    ('def solve(values):', ''),
])
def test_russian_strength_cannot_attribute_an_unstated_achievement(provider, observation, expected):
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return completion({'accuracy': 3, 'completeness': 2, 'clarity': 5, 'structure': 3,
                               'went_well': observation,
                               'missing': 'Не описаны разногласия и действия по согласованию приоритетов.',
                               'stronger_answer': 'Сначала я выслушал обе стороны и согласовал приоритеты.',
                               'practice_topic': 'Управление конфликтами'})
        pytest.fail('Scoring must not make a second model review request')

    provider(handler)
    result = ai_service.evaluate_answer('Опишите конфликт приоритетов в команде?',
                                         'Я обсудил причину ошибки с командой. def solve(values):', interview_language='Russian')
    assert result is not None and result.went_well == expected


def evaluation_payload(**overrides):
    return dict(accuracy=8, completeness=8, clarity=8, structure=8, went_well='',
                missing='Не указаны граничные случаи.',
                stronger_answer='Сначала уточните граничные случаи и проверьте пустой список.',
                practice_topic='Граничные случаи') | overrides


@pytest.mark.parametrize('first_failure', ['schema', 'language', 'context'])
def test_russian_evaluation_repairs_rejected_output_once(provider, first_failure):
    bad = evaluation_payload(missing='') if first_failure == 'schema' else (
        evaluation_payload(missing='No boundary cases explained.') if first_failure == 'language'
        else evaluation_payload(stronger_answer='Исправьте конфликт командой git merge.'))
    responses = [bad, evaluation_payload()]
    calls = []

    def handler(request):
        payload = json.loads(request.content)
        calls.append(payload)
        content = responses.pop(0)
        if len(responses) == 0:
            assert 'previous output failed' in payload['messages'][0]['content']
        return completion(content)

    provider(handler)
    result = ai_service.evaluate_answer('Опишите конфликт приоритетов в команде?', 'Я проверил список.', interview_language='Russian')
    assert result is not None and result.accuracy == 8
    assert responses == []


def test_second_invalid_evaluation_does_not_retry_forever(provider):
    calls = []

    def handler(request):
        calls.append(request)
        return completion(evaluation_payload(missing=''))

    provider(handler)
    assert ai_service.evaluate_answer('Вопрос?', 'Ответ.', interview_language='Russian') is None
    assert len(calls) == 2


def test_provider_outage_is_not_retried_as_a_content_repair(provider):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503)

    provider(handler)
    assert ai_service.evaluate_answer('Вопрос?', 'Ответ.', interview_language='Russian') is None
    assert len(calls) == 1


@pytest.mark.parametrize('language, source', [
    ('Python', 'def solve(values):\n    return len(set(values))'),
    ('Python', 'def solve(values):\n    return len(values) // 2'),
    ('Java', '```java\nint solve(int[] values) { return values.length; }\n```'),
    ('C++', '```cpp\nint solve(vector<int> values) { return values.size(); }\n```'),
    ('C++', '```cpp\n#include <vector>\nint solve(std::vector<int> values) { return values.size(); }\n```'),
])
def test_code_only_example_and_optional_english_topic_do_not_discard_scores(provider, language, source):
    responses = [evaluation_payload(stronger_answer=source, practice_topic='HashSet')]

    def handler(request):
        return completion(responses.pop(0))

    provider(handler)
    result = ai_service.evaluate_answer('Подсчитайте уникальные значения.', source,
                                       language=language, interview_language='Russian')
    assert result is not None and result.accuracy == 8
    assert result.stronger_answer == source and result.practice_topic is None
    assert responses == []


def test_endpoint_saves_repaired_scores_and_report_without_duplicate_answers(provider, monkeypatch, tmp_path):
    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **kw: 'Как проверить пустой список?')
    monkeypatch.setattr(ai_service, 'generate_followup', lambda *a, **kw: None)
    responses = [evaluation_payload(missing=''), evaluation_payload()]
    provider(lambda request: completion(responses.pop(0)))
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "scoring.db"}')) as client:
        assert client.post('/api/auth/login', json={
            'email': 'demo@example.com', 'password': 'demo-password'}).status_code == 200
        interview = client.post('/api/interviews', json={
            'role': 'QA Engineer', 'level': 'Middle', 'type': 'Behavioral', 'mode': 'Practice',
            'questionCount': 5, 'input': 'Text', 'language': 'Russian'}).json()
        body = {'text': 'Я проверю список.', 'expectedQuestionId': interview['messages'][-1]['id']}
        response = client.post(f"/api/interviews/{interview['id']}/messages", json=body)
        assert response.status_code == 200
        retried = client.post(f"/api/interviews/{interview['id']}/messages", json=body)
        assert retried.status_code == 200 and retried.json()['answeredCount'] == 1
        saved = client.get(f"/api/interviews/{interview['id']}").json()
        assert saved['answeredCount'] == 1
        assert len([m for m in saved['messages'] if m['from'] == 'you']) == 1
        assert saved['lastAnswerFeedback']['accuracy'] == 8
        assert client.post(f"/api/interviews/{interview['id']}/end").status_code == 200
        report = client.get(f"/api/interviews/{interview['id']}/report").json()
        assert report['feedback']['overall'] == 8
        assert report['feedback']['questions'][0]['miss'] == 'Не указаны граничные случаи.'
        assert responses == []


def test_valid_russian_scores_do_not_depend_on_another_ai_review(provider, monkeypatch):
    calls = []
    def unexpected_review(*args, **kwargs):
        pytest.fail('A secondary AI review must not block valid scores')
    monkeypatch.setattr(ai_service, '_russian_content_is_relevant', unexpected_review)
    def handler(request):
        calls.append(request)
        payload = json.loads(request.content)
        assert payload['max_completion_tokens'] == 2048
        assert len(payload['messages'][0]['content']) < 3000
        return completion(evaluation_payload())
    provider(handler)
    result = ai_service.evaluate_answer('Как проверить список?', 'Я проверю пустой список.',
                                        interview_language='Russian')
    assert result is not None and result.accuracy == 8
    assert len(calls) == 1


def test_untranslated_improved_example_does_not_discard_actual_scores(provider):
    provider(lambda request: completion(evaluation_payload(stronger_answer='Here is an improved solution.')))
    result = ai_service.evaluate_answer('Как проверить список?', 'Я проверил список.', interview_language='Russian')
    assert result is not None and result.accuracy == 8
    assert result.missing == 'Не указаны граничные случаи.'
    assert 'временно недоступен' in result.stronger_answer
    assert 'Here is' not in result.stronger_answer


def test_next_question_failure_cannot_rollback_saved_russian_scores(provider, monkeypatch, tmp_path):
    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **kw: 'Как проверить список?')
    followups = []
    monkeypatch.setattr(ai_service, 'generate_followup', lambda *a, **kw: followups.append(True) or None)
    calls = []
    def handler(request):
        calls.append(request)
        return completion(evaluation_payload())
    provider(handler)
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "pending.db"}')) as client:
        client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
        interview = client.post('/api/interviews', json={
            'role': 'QA Engineer', 'level': 'Middle', 'type': 'Behavioral', 'mode': 'Practice',
            'questionCount': 5, 'input': 'Text', 'language': 'Russian'}).json()
        path = f"/api/interviews/{interview['id']}"
        body = {'text': 'Я проверю список.', 'expectedQuestionId': interview['messages'][-1]['id']}
        answer = client.post(path + '/messages', json=body)
        assert answer.status_code == 200 and answer.json()['lastAnswerFeedback']['accuracy'] == 8
        assert answer.json()['messages'][-1]['from'] == 'you'
        assert followups == []  # No question-provider calls block the scoring transaction.
        assert client.post(path + '/hint').status_code == 409
        monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **kw: None)
        failed = client.post(path + '/next-question')
        assert failed.status_code == 503 and 'saved' in failed.json()['message']
        saved = client.get(path).json()
        assert saved['answeredCount'] == 1 and saved['lastAnswerFeedback']['accuracy'] == 8
        assert client.post(path + '/messages', json=body).status_code == 200
        assert client.post(path + '/messages', json=body | {'text': 'Другой ответ.'}).status_code == 409
        assert len(calls) == 1
        monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **kw: 'Как проверить границы?')
        continued = client.post(path + '/next-question')
        assert continued.status_code == 200 and continued.json()['messages'][-1]['from'] == 'ai'
        assert client.post(path + '/next-question').json() == continued.json()
        assert len(calls) == 1
        client.post('/api/auth/logout')
        assert client.post(path + '/next-question').status_code == 401
        client.post('/api/auth/register', json={
            'name': 'Other user', 'email': 'other@example.com', 'password': 'other-password'})
        assert client.post(path + '/next-question').status_code == 404


def test_deferred_final_question_finishes_without_followups(provider, monkeypatch, tmp_path):
    questions = []
    def question(*args, **kwargs):
        questions.append(True)
        return f'Вопрос {len(questions)}?'
    monkeypatch.setattr(ai_service, 'generate_question', question)
    monkeypatch.setattr(ai_service, 'generate_followup', lambda *args, **kwargs:
                        pytest.fail('Interviews must not generate follow-up questions'))
    provider(lambda request: completion(evaluation_payload()))
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "last-question.db"}')) as client:
        client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
        interview = client.post('/api/interviews', json={
            'role': 'QA Engineer', 'level': 'Middle', 'type': 'Behavioral', 'mode': 'Practice',
            'questionCount': 5, 'input': 'Text', 'language': 'Russian'}).json()
        path = f"/api/interviews/{interview['id']}"
        for count in range(1, 6):
            result = client.post(path + '/messages', json={
                'text': 'Я проверил гипотезу.', 'expectedQuestionId': interview['messages'][-1]['id']})
            assert result.status_code == 200 and result.json()['answeredCount'] == count
            interview = result.json()
            if interview['status'] == 'active':
                interview = client.post(path + '/next-question').json()
        assert interview['status'] == 'complete' and interview['answeredCount'] == 5
        assert len(questions) == 5
        assert client.get(path + '/report').json()['feedback']['overall'] == 8


@pytest.mark.parametrize('headers, message, expected', [
    ({'Retry-After': '0.1'}, 'Rate limited', .35),
    ({}, 'Please try again in 375ms.', .625),
    ({'Retry-After': '1'}, 'Please try again in 1.1175s.', 1.3675),
    ({}, 'Please try again in 26.235s.', 26.485),
])
def test_short_rate_limit_is_retried_without_losing_evaluation(provider, monkeypatch, headers, message, expected):
    sleeps = []
    monkeypatch.setattr(ai_service.time, 'sleep', sleeps.append)
    responses = [httpx.Response(429, headers=headers, json={'error': {'message': message}}),
                 completion(evaluation_payload())]
    provider(lambda request: responses.pop(0))
    result = ai_service.evaluate_answer('Вопрос?', 'Ответ.', interview_language='Russian')
    assert result is not None and result.accuracy == 8
    assert sleeps == [pytest.approx(expected)] and responses == []


@pytest.mark.parametrize('delay, attempts', [('0', 3), ('60', 1), ('unknown', 1)])
def test_rate_limit_retry_is_bounded(provider, monkeypatch, delay, attempts):
    calls = []
    monkeypatch.setattr(ai_service.time, 'sleep', lambda _: None)

    def handler(request):
        calls.append(request)
        return httpx.Response(429, headers={'Retry-After': delay}, json={'error': {'message': 'Rate limited'}})

    provider(handler)
    assert ai_service.evaluate_answer('Вопрос?', 'Ответ.', interview_language='Russian') is None
    assert len(calls) == attempts
