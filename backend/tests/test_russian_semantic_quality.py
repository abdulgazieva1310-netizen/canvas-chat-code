import json

import httpx
import pytest

from app.services import ai_service
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
    question = 'Опишите ситуацию конфликта между членами команды из-за приоритетов задач?'
    answer = 'Я обсудил причину ошибки с командой.'

    def handler(request):
        payload = json.loads(request.content)
        calls.append(payload)
        if len(calls) == 1:
            prompt = payload['messages'][0]['content']
            assert 'NON-CODING' in prompt and 'not a git merge conflict' in prompt
            return completion({'accuracy': 3, 'completeness': 2, 'clarity': 4, 'structure': 3,
                               'went_well': '', 'missing': 'Не указаны команды воспроизведения конфликта.',
                               'stronger_answer': 'Сначала воспроизведите конфликт в командной строке, затем исправьте конфликт командами git merge и git add.',
                               'practice_topic': 'Конфликты командной строки'})
        context = json.loads(payload['messages'][1]['content'])
        assert context['context']['question'] == question
        assert context['context']['answer'] == answer
        assert context['context']['codingLanguage'] is None
        return completion({'valid': False})

    provider(handler)
    assert ai_service.evaluate_answer(question, answer, interview_language='Russian') is None
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


@pytest.mark.parametrize('code', [
    'def solve(values: list[int]) -> int | None:\n    """Возвращает первое повторяющееся число."""\n    seen = set()\n    for value in values:\n        if value in seen:\n            return value\n        seen.add(value)\n    return None',
    '```java\n// Возвращает первое повторяющееся число в массиве.\nInteger solve(int[] values) { return null; }\n```',
])
def test_russian_coding_annotations_are_not_rejected_as_english(provider, code):
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
                                         language='Python', interview_language='Russian')
    assert result is not None and result.stronger_answer == code
    assert len(calls) == 2


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
        reviewed = json.loads(json.loads(request.content)['messages'][1]['content'])
        assert reviewed['content']['went_well'] == expected
        return completion({'valid': True})

    provider(handler)
    result = ai_service.evaluate_answer('Опишите конфликт приоритетов в команде?',
                                         'Я обсудил причину ошибки с командой. def solve(values):', interview_language='Russian')
    assert result is not None and result.went_well == expected
