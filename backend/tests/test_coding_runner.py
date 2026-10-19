from unittest.mock import Mock
import os

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

SETUP = {
    'role': 'Backend Developer', 'level': 'Middle', 'mode': 'Practice',
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
    interview = start(client)
    path = f"/api/interviews/{interview['id']}"
    unavailable = client.post(path + '/run', json={'language': 'Python', 'code': 'print(1)'})
    assert unavailable.status_code == 200
    assert unavailable.json()['status'] == 'unavailable'
    assert 'Static AI review remains available' in unavailable.json()['stderr']
    submitted = client.post(path + '/messages', json={'selectedLanguage': 'Python', 'text': 'def solution(): return 1'})
    assert submitted.status_code == 200
    assert submitted.json()['answeredCount'] == 1


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


def test_runner_forwards_only_supported_submission_with_private_token(client, monkeypatch):
    interview = start(client)
    monkeypatch.setenv('CODING_RUNNER_URL', 'https://runner.internal')
    monkeypatch.setenv('CODING_RUNNER_TOKEN', 'private-runner-token')
    response_value = Mock(status_code=200)
    response_value.json.return_value = {'status': 'success', 'stdout': '3\n', 'stderr': ''}
    response_value.raise_for_status.return_value = None
    post = Mock(return_value=response_value)
    monkeypatch.setattr('app.routers.interviews.httpx.post', post)

    response = client.post(
        f"/api/interviews/{interview['id']}/run",
        json={'language': 'Python', 'code': 'print(1 + 2)'},
    )
    assert response.status_code == 200
    assert response.json() == {'status': 'success', 'stdout': '3\n', 'stderr': ''}
    assert post.call_args.args[0] == 'https://runner.internal/run'
    assert post.call_args.kwargs['headers'] == {'Authorization': 'Bearer private-runner-token'}
    assert post.call_args.kwargs['json'] == {'language': 'Python', 'code': 'print(1 + 2)'}
    assert post.call_args.kwargs['timeout'].connect == 2.0


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


@pytest.mark.skipif(not os.getenv('CODING_RUNNER_E2E_URL'), reason='requires a live private coding-runner gateway')
def test_api_executes_code_through_live_private_runner(tmp_path, monkeypatch):
    monkeypatch.setenv('CODING_RUNNER_URL', os.environ['CODING_RUNNER_E2E_URL'])
    monkeypatch.setenv('CODING_RUNNER_TOKEN', os.environ['CODING_RUNNER_E2E_TOKEN'])
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "runner-e2e.db"}')) as live_client:
        live_client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
        interview = start(live_client)
        result = live_client.post(
            f"/api/interviews/{interview['id']}/run",
            json={'language': 'Python', 'code': 'print(42)'},
        )
        assert result.status_code == 200
        assert result.json() == {'status': 'success', 'stdout': '42\n', 'stderr': ''}
        assert live_client.get(f"/api/interviews/{interview['id']}").json() == interview
