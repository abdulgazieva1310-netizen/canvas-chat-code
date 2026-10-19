import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import ai_service


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(seed=False, database_url=f'sqlite:///{tmp_path / "targeted.db"}')) as test_client:
        response = test_client.post('/api/auth/register', json={
            'name': 'Candidate', 'email': 'candidate@example.com', 'password': 'secret'})
        assert response.status_code == 201
        yield test_client


def setup(**overrides):
    return {
        'role': 'Backend Developer', 'level': 'Junior', 'mode': 'Practice', 'questionCount': 5,
        'type': 'Technical', 'input': 'Text', 'language': 'English', **overrides,
    }


def test_topic_reaches_ai_and_matching_curated_questions(client, monkeypatch):
    calls = []

    def unavailable(role, level, previous, **context):
        calls.append(context.get('practice_topic'))
        return None

    monkeypatch.setattr(ai_service, 'generate_question', unavailable)
    response = client.post('/api/interviews', json=setup(practiceTopic='hashing'))
    assert response.status_code == 201
    interview = response.json()
    assert interview['setup']['practiceTopic'] == 'hashing'
    assert 'first integer encountered for a second time' in interview['messages'][0]['text']
    assert 'reviewerNotes' not in interview['messages'][0]['text']

    response = client.post(f"/api/interviews/{interview['id']}/messages", json={'text': 'Use a set.'})
    assert response.status_code == 200
    assert response.json()['setup']['practiceTopic'] == 'hashing'
    assert calls == ['hashing', 'hashing']


def test_topic_mismatch_falls_back_transparently_to_role_compatible_question(client, monkeypatch):
    monkeypatch.setattr(ai_service, 'generate_question', lambda *args, **kwargs: None)
    response = client.post('/api/interviews', json=setup(
        role='QA Engineer', type='Behavioral', practiceTopic='conflict resolution'))
    assert response.status_code == 201
    interview = response.json()
    assert interview['setup']['practiceTopic'] == 'conflict resolution'
    assert 'No matching curated questions' in interview['messages'][0]['text']
    assert 'role-compatible behavioral practice question' in interview['messages'][0]['text']


def test_practice_topic_has_bounded_nonempty_validation(client):
    for topic in ('  ', 'x' * 121):
        response = client.post('/api/interviews', json=setup(practiceTopic=topic))
        assert response.status_code == 400
    assert client.post('/api/interviews', json=setup(mode='Real Interview', practiceTopic='hashing')).status_code == 400


def test_retry_preserves_source_and_idempotency_includes_the_selected_topic(client, monkeypatch):
    monkeypatch.setattr(ai_service, 'generate_question', lambda *args, **kwargs: None)
    original = client.post('/api/interviews', json=setup(mode='Real Interview')).json()
    client.post(f"/api/interviews/{original['id']}/messages", json={'text': 'A saved answer'})
    client.post(f"/api/interviews/{original['id']}/end")
    before = client.get(f"/api/interviews/{original['id']}").json()
    report = client.get(f"/api/interviews/{original['id']}/report").json()

    headers = {'Idempotency-Key': 'targeted-retry'}
    targeted_setup = {**setup(mode='Practice'), 'practiceTopic': 'hashing'}
    first = client.post('/api/interviews', json=targeted_setup, headers=headers)
    repeated = client.post('/api/interviews', json=targeted_setup, headers=headers)
    assert first.status_code == repeated.status_code == 201
    assert first.json()['id'] == repeated.json()['id'] != original['id']
    assert first.json()['setup'] == {**targeted_setup, 'jobDescription': ''}
    assert client.post('/api/interviews', json={**targeted_setup, 'practiceTopic': 'arrays'},
                       headers=headers).status_code == 409
    assert client.get(f"/api/interviews/{original['id']}").json() == before
    assert client.get(f"/api/interviews/{original['id']}/report").json() == report
