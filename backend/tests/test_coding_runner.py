from unittest.mock import Mock
import os

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

SETUP = {
    'role': 'Backend Developer', 'level': 'Junior', 'mode': 'Practice',
    'questionCount': 5, 'type': 'Technical', 'input': 'Text', 'language': 'English',
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv('CODING_RUNNER_URL', raising=False)
    monkeypatch.delenv('CODING_RUNNER_TOKEN', raising=False)
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "test.db"}')) as test_client:
        test_client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
        yield test_client


def start(client, **overrides):
    response = client.post('/api/interviews', json=SETUP | overrides)
    assert response.status_code == 201
    return response.json()


def test_runner_unavailable_keeps_static_answer_review_available(client, monkeypatch):
    from app.models import AnswerEvaluation
    monkeypatch.setattr('app.services.ai_service.evaluate_answer', lambda *a, **kw:
        AnswerEvaluation(accuracy=7, completeness=7, clarity=7, structure=7,
                         went_well='Explained the approach.', missing='Explain complexity.',
                         stronger_answer='Describe the stack invariant.'))
    interview = start(client)
    path = f"/api/interviews/{interview['id']}"
    unavailable = client.post(path + '/run', json={'language': 'Python', 'code': 'print(1)'})
    assert unavailable.status_code == 200
    assert unavailable.json()['status'] == 'unavailable'
    assert 'Static AI review remains available' in unavailable.json()['stderr']
    submitted = client.post(path + '/messages', json={'selectedLanguage': 'Python', 'text': 'def solution(): return 1'})
    assert submitted.status_code == 200
    assert submitted.json()['answeredCount'] == 1
    assert submitted.json()['lastAnswerFeedback']['accuracy'] == 7
    assert submitted.json()['lastCodingJudge']['status'] == 'unavailable'


def test_runner_is_only_available_to_active_coding_interviews(client, monkeypatch):
    interview = start(client, role='QA Engineer', type='Behavioral')
    response = client.post(f"/api/interviews/{interview['id']}/run", json={'language': 'Python', 'code': 'print(1)'})
    assert response.status_code == 409
    coding = start(client)
    client.post(f"/api/interviews/{coding['id']}/end")
    response = client.post(f"/api/interviews/{coding['id']}/run", json={'language': 'Python', 'code': 'print(1)'})
    assert response.status_code == 409


def test_runner_rejects_non_owners_and_unsupported_languages(client):
    interview = start(client)
    invalid = client.post(
        f"/api/interviews/{interview['id']}/run",
        json={'language': 'Ruby', 'code': 'puts 1'},
    )
    assert invalid.status_code == 400
    client.post('/api/auth/register', json={'name': 'Other User', 'email': 'other@example.com', 'password': 'secret'})
    hidden = client.post(
        f"/api/interviews/{interview['id']}/run",
        json={'language': 'Python', 'code': 'print(1)'},
    )
    assert hidden.status_code == 404


def test_runner_forwards_only_public_examples_with_private_token(client, monkeypatch):
    interview = start(client)
    monkeypatch.setenv('CODING_RUNNER_URL', 'https://runner.internal')
    monkeypatch.setenv('CODING_RUNNER_TOKEN', 'private-runner-token')
    calls = []
    def post(url, **kwargs):
        calls.append((url, kwargs))
        stdin = kwargs['json']['stdin']
        return Mock(status_code=200, raise_for_status=lambda: None,
                    json=lambda: {'status': 'success', 'stdout': 'true\n' if stdin == '([])\n' else 'false\n', 'stderr': ''})
    monkeypatch.setattr('app.routers.interviews.httpx.post', post)
    response = client.post(f"/api/interviews/{interview['id']}/run", json={'language': 'Python', 'code': 'solution'})
    assert response.status_code == 200
    assert response.json()['status'] == 'passed'
    assert response.json()['stdout'] == '2 of 2 public examples passed.'
    assert {kwargs['json']['stdin'] for _, kwargs in calls} == {'([])\n', '([)]\n'}
    assert all(url == 'https://runner.internal/run' for url, _ in calls)
    assert all(kwargs['headers'] == {'Authorization': 'Bearer private-runner-token'} for _, kwargs in calls)
    assert all(kwargs['json']['code'] == 'solution' for _, kwargs in calls)
    assert client.get(f"/api/interviews/{interview['id']}").json() == interview



def test_runner_failure_is_clear_and_does_not_break_session(client, monkeypatch):
    interview = start(client)
    monkeypatch.setenv('CODING_RUNNER_URL', 'https://runner.internal')
    monkeypatch.setenv('CODING_RUNNER_TOKEN', 'private-runner-token')
    monkeypatch.setattr('app.routers.interviews.httpx.post', Mock(side_effect=__import__('httpx').ConnectError('offline')))
    response = client.post(
        f"/api/interviews/{interview['id']}/run",
        json={'language': 'Python', 'code': 'print(1)'},
    )
    assert response.status_code == 200
    assert response.json()['status'] == 'unavailable'
    assert 'temporarily unavailable' in response.json()['stderr']
    assert client.get(f"/api/interviews/{interview['id']}").status_code == 200


@pytest.mark.parametrize('field, value', [('codingQuestionVersion', 99), ('codingJudgeSpecVersion', 99),
    ('codingJudgeSpecKey', 'unreviewed'), ('codingQuestionId', 'unknown')])
def test_unreviewed_or_historical_mismatch_does_not_execute(client, monkeypatch, field, value):
    interview = start(client)
    with client.app.state.store.transaction() as repository:
        saved = repository.find('demo-user', interview['id'])
        setattr(saved.messages[0], field, value)
        repository.save(saved)
    post = Mock(side_effect=AssertionError('Unreviewed specifications must not execute'))
    monkeypatch.setattr('app.routers.interviews.httpx.post', post)
    response = client.post(f"/api/interviews/{interview['id']}/run", json={'language': 'Python', 'code': 'print(1)'})
    assert response.status_code == 200 and response.json()['status'] == 'unavailable'
    assert 'no reviewed execution specification' in response.json()['stderr']
    submitted = client.post(f"/api/interviews/{interview['id']}/messages", json={
        'text': 'def solve(): return 1', 'selectedLanguage': 'Python'})
    assert submitted.status_code == 200 and submitted.json()['lastCodingJudge'] is None
    post.assert_not_called()


def test_ai_generated_questions_use_only_static_review(client, monkeypatch):
    interview = start(client, level='Middle')
    post = Mock(side_effect=AssertionError('An AI question must not invoke the runner'))
    monkeypatch.setattr('app.routers.interviews.httpx.post', post)
    assert client.post(f"/api/interviews/{interview['id']}/run", json={
        'language': 'Python', 'code': 'print(1)'}).json()['status'] == 'unavailable'
    submitted = client.post(f"/api/interviews/{interview['id']}/messages", json={
        'text': 'def solve(): return 1', 'selectedLanguage': 'Python'})
    assert submitted.status_code == 200 and submitted.json()['answeredCount'] == 1
    post.assert_not_called()


def test_incorrect_public_examples_have_a_failed_verdict(client, monkeypatch):
    interview = start(client)
    monkeypatch.setenv('CODING_RUNNER_URL', 'http://runner')
    monkeypatch.setenv('CODING_RUNNER_TOKEN', 'private-token')
    monkeypatch.setattr('app.routers.interviews.httpx.post', lambda *a, **kw: Mock(
        status_code=200, raise_for_status=lambda: None,
        json=lambda: {'status': 'success', 'stdout': 'wrong\n', 'stderr': ''}))
    response = client.post(f"/api/interviews/{interview['id']}/run", json={'language': 'Python', 'code': 'print("wrong")'})
    assert response.json()['status'] == 'failed'
    assert response.json()['stdout'] == '0 of 2 public examples passed.'


def test_source_limit_is_bytes_not_unicode_characters(client):
    interview = start(client)
    response = client.post(f"/api/interviews/{interview['id']}/run", json={
        'language': 'Python', 'code': '#' + 'я' * 30_000})
    assert response.status_code == 400


@pytest.mark.skipif(not os.getenv('CODING_RUNNER_E2E_URL'), reason='requires a live private coding-runner gateway')
def test_api_executes_code_through_live_private_runner(tmp_path, monkeypatch):
    monkeypatch.setenv('CODING_RUNNER_URL', os.environ['CODING_RUNNER_E2E_URL'])
    monkeypatch.setenv('CODING_RUNNER_TOKEN', os.environ['CODING_RUNNER_E2E_TOKEN'])
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "runner-e2e.db"}')) as live_client:
        live_client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
        interview = start(live_client)
        result = live_client.post(
            f"/api/interviews/{interview['id']}/run",
            json={'language': 'Python', 'code': "s=input(); stack=[]; pairs={')':'(',']':'[','}':'{'}; ok=True\nfor c in s:\n if c in '([{': stack.append(c)\n elif not stack or stack.pop()!=pairs.get(c): ok=False\nprint(str(ok and not stack).lower())"},
        )
        assert result.status_code == 200
        assert result.json() == {'status': 'passed', 'stdout': '2 of 2 public examples passed.', 'stderr': ''}
        assert live_client.get(f"/api/interviews/{interview['id']}").json() == interview
