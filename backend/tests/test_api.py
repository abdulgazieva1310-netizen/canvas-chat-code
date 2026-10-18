from datetime import timedelta
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from jsonschema import Draft4Validator, RefResolver

from app.auth import hasher, token_key
from app.main import create_app
from app.database import TokenRecord, UserRecord
from app.store import now

SETUP = dict(role='Backend Developer', level='Middle', mode='Practice', questionCount=5,
             type='Technical', input='Text', language='English')


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "test.db"}')) as client:
        yield client


def login(client):
    response = client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
    assert response.status_code == 200
    return response


def start(client, **overrides):
    response = client.post('/api/interviews', json=SETUP | overrides)
    assert response.status_code == 201
    return response.json()


def test_authentication_and_seed(client):
    assert client.get('/api/interviews').status_code == 401
    assert client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'wrong'}).status_code == 401
    response = login(client)
    assert set(response.json()) == {'id', 'name', 'email', 'targetRole', 'level', 'preferredLanguage'}
    assert 'HttpOnly' in response.headers['set-cookie']
    assert 'Path=/api' in response.headers['set-cookie']
    token = response.headers['authorization'].split()[1]
    store = client.app.state.store
    with store.sessions() as session:
        assert session.get(TokenRecord, token) is None
        assert session.get(TokenRecord, token_key(token)) is not None
        password_hash = session.get(UserRecord, 'demo-user').password_hash
        assert hasher.verify('demo-password', password_hash)
        assert password_hash != 'demo-password'
    history = client.get('/api/interviews').json()
    assert len(history) == 2
    assert history[0]['startedAt'] > history[1]['startedAt']
    assert client.get('/api/interviews', headers={'Authorization': 'Bearer invalid'}).status_code == 401
    client.cookies.clear()
    assert client.get('/api/interviews', headers={'Authorization': f'Bearer {token}'}).status_code == 200
    with store.sessions.begin() as session:
        session.get(TokenRecord, token_key(token)).expires_at = (now() - timedelta(seconds=1)).timestamp()
    assert client.get('/api/interviews', headers={'Authorization': f'Bearer {token}'}).status_code == 401


def test_register_and_ownership(client):
    login(client)
    ident = start(client)['id']
    response = client.post('/api/auth/register', json={'name': ' New User ', 'email': 'NEW@example.com', 'password': 'secret'})
    assert response.status_code == 201
    assert response.json()['targetRole'] == 'Frontend Developer'
    assert response.json()['name'] == 'New User'
    assert client.get('/api/interviews').json() == []
    for suffix in ['', '/report']:
        assert client.get(f'/api/interviews/{ident}{suffix}').status_code == 404
    for suffix, body in [('/messages', {'text': 'answer'}), ('/hint', None), ('/end', None)]:
        assert client.post(f'/api/interviews/{ident}{suffix}', json=body).status_code == 404
    assert client.post('/api/auth/register', json={'name': 'Other', 'email': 'new@example.com', 'password': 'x'}).status_code == 409
    assert client.post('/api/auth/login', json={'email': 'new@example.com', 'password': 'secret'}).status_code == 200


@pytest.mark.parametrize('mode', ['Practice', 'Real Interview'])
def test_complete_lifecycle(client, mode):
    login(client)
    interview = start(client, mode=mode)
    path = '/api/interviews/' + interview['id']
    assert interview['answeredCount'] == 0
    assert interview['endedAt'] is None and interview['lastFeedback'] is None
    assert len(interview['messages']) == 1
    assert client.get(path).json() == interview
    assert client.get(path + '/report').status_code == 409
    assert client.post(path + '/hint').status_code == (200 if mode == 'Practice' else 409)
    for index in range(5):
        response = client.post(path + '/messages', json={'text': '  A concrete example  '})
        assert response.status_code == 200
        interview = response.json()
        assert interview['answeredCount'] == index + 1
        assert (interview['lastFeedback'] is None) == (mode == 'Real Interview')
    assert interview['status'] == 'complete' and interview['endedAt']
    assert len([m for m in interview['messages'] if m['from'] == 'ai']) == 5
    assert client.post(path + '/messages', json={'text': 'extra'}).status_code == 409
    assert client.post(path + '/hint').status_code == 409
    assert client.post(path + '/end').json() == interview
    report = client.get(path + '/report').json()
    assert len(report['feedback']['questions']) == 5
    assert report['feedback']['questions'][0]['answer'] == 'A concrete example'
    assert report['feedback']['scores'] is not None
    assert interview in client.get('/api/interviews').json()


def test_empty_report_and_early_end(client):
    login(client)
    interview = start(client)
    path = '/api/interviews/' + interview['id']
    assert interview not in client.get('/api/interviews').json()
    ended = client.post(path + '/end').json()
    assert ended['status'] == 'incomplete'
    assert client.post(path + '/end').json() == ended
    feedback = client.get(path + '/report').json()['feedback']
    assert feedback == dict(interviewId=interview['id'], overall=None, scores=None, strengths=[], gaps=[], questions=[])


@pytest.mark.parametrize('body', [{}, SETUP | {'questionCount': 3}, SETUP | {'questionCount': True},
                                 SETUP | {'mode': 'invalid'}, SETUP | {'jobDescription': None}])
def test_invalid_setup(client, body):
    login(client)
    response = client.post('/api/interviews', json=body)
    assert response.status_code == 400
    assert set(response.json()) == {'message'}


def test_validation_and_missing(client):
    login(client)
    path = '/api/interviews/' + start(client)['id']
    for text in ['', '   ', '\n\t']:
        assert client.post(path + '/messages', json={'text': text}).status_code == 400
    assert client.get(path).json()['answeredCount'] == 0
    assert client.get('/api/interviews/missing').status_code == 404
    assert client.post('/api/interviews', content='{', headers={'Content-Type': 'application/json'}).status_code == 400
    for body in [{'name': ' ', 'email': 'a@example.com', 'password': 'x'},
                 {'name': 'A', 'email': 'invalid', 'password': 'secret'},
                 {'name': 'A', 'email': 'a@example.com', 'password': ''}]:
        response = client.post('/api/auth/register', json=body)
        assert response.status_code == 400 and 'secret' not in response.text


def test_responses_match_contract(client):
    spec = yaml.safe_load((Path(__file__).resolve().parents[2] / 'openapi.yaml').read_text())
    # OpenAPI 3.0 nullable is not a JSON Schema keyword: convert it for validation.
    def convert(node):
        if isinstance(node, list):
            return [convert(item) for item in node]
        if not isinstance(node, dict):
            return node
        result = {key: convert(value) for key, value in node.items() if key != 'nullable'}
        return {'anyOf': [result, {'type': 'null'}]} if node.get('nullable') else result
    spec = convert(spec)
    def validate(name, data):
        Draft4Validator(spec['components']['schemas'][name], resolver=RefResolver.from_schema(spec)).validate(data)
    validate('User', login(client).json())
    interview = start(client)
    validate('Interview', interview)
    client.post('/api/interviews/' + interview['id'] + '/end')
    validate('InterviewReport', client.get('/api/interviews/' + interview['id'] + '/report').json())
    for saved in client.get('/api/interviews').json():
        validate('Interview', saved)
        validate('InterviewReport', client.get('/api/interviews/' + saved['id'] + '/report').json())


def test_secure_cookie_and_cors():
    with TestClient(create_app(secure_cookies=True, database_url='sqlite:///:memory:')) as client:
        assert 'Secure' in login(client).headers['set-cookie']
        for origin in ['http://localhost:5173', 'http://localhost:8080', 'http://127.0.0.1:8080']:
            response = client.options('/api/interviews', headers={'Origin': origin,
                'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'X-Custom-Header'})
            assert response.status_code == 200
            assert response.headers['access-control-allow-origin'] == origin
            assert response.headers['access-control-allow-credentials'] == 'true'
            assert 'PUT' in response.headers['access-control-allow-methods']
            assert response.headers['access-control-allow-headers'] == 'X-Custom-Header'


def test_create_returns_created_interview(client):
    login(client)
    response = client.post('/api/interviews', json=SETUP, headers={'Origin': 'http://localhost:8080'})
    assert response.status_code == 201
    created = response.json()
    assert isinstance(created['id'], str) and created['id'].strip()
    assert all(created['setup'][key] == value for key, value in SETUP.items())
    assert created['status'] == 'active'
    assert created['messages'][0]['interviewId'] == created['id']
    assert response.headers['access-control-allow-origin'] == 'http://localhost:8080'
    assert client.get('/api/interviews/' + created['id']).json() == created


def test_persistence_and_shared_database(tmp_path, monkeypatch):
    url = f'sqlite:///{tmp_path / "persistent.db"}'
    monkeypatch.setenv('DATABASE_URL', url)
    with TestClient(create_app(seed=False)) as first:
        registered = first.post('/api/auth/register', json={
            'name': 'Persistent', 'email': 'persistent@example.com', 'password': 'secret'})
        assert registered.status_code == 201
        headers = {'Authorization': registered.headers['authorization']}
        interview = start(first)
        path = '/api/interviews/' + interview['id']
        first.post(path + '/hint')
        first.post(path + '/messages', json={'text': 'Stored answer'})
        with TestClient(create_app(seed=False)) as second:
            saved = second.get(path, headers=headers).json()
            assert saved['answeredCount'] == 1
            assert any(m['from'] == 'hint' for m in saved['messages'])
            ended = second.post(path + '/end', headers=headers).json()
            assert first.get(path).json() == ended
    with TestClient(create_app(seed=False)) as restarted:
        assert restarted.get(path, headers=headers).json() == ended
        assert restarted.get('/api/interviews', headers=headers).json() == [ended]
        report = restarted.get(path + '/report', headers=headers).json()
        assert report['feedback']['questions'][0]['answer'] == 'Stored answer'
        assert restarted.post('/api/auth/login', json={
            'email': 'persistent@example.com', 'password': 'secret'}).status_code == 200


def test_seed_is_idempotent(tmp_path):
    url = f'sqlite:///{tmp_path / "seed.db"}'
    with TestClient(create_app(database_url=url)) as first:
        login(first)
        history = first.get('/api/interviews').json()
    with TestClient(create_app(database_url=url)) as second:
        login(second)
        assert second.get('/api/interviews').json() == history


def test_transaction_rollback_and_concurrent_updates(tmp_path):
    from fastapi import HTTPException
    from app.store import Store
    from app.models import InterviewSetup

    store = Store(database_url=f'sqlite:///{tmp_path / "transactions.db"}')
    with store.transaction() as repository:
        interview = repository.start('demo-user', InterviewSetup(**SETUP))
    with pytest.raises(RuntimeError):
        with store.transaction() as repository:
            repository.answer(repository.find('demo-user', interview.id), 'Rolled back')
            raise RuntimeError('abort')
    with store.transaction() as repository:
        assert repository.find('demo-user', interview.id).answeredCount == 0
    with pytest.raises(HTTPException) as error:
        with store.transaction() as stale:
            old = stale.find('demo-user', interview.id)
            with store.transaction() as current:
                current.answer(current.find('demo-user', interview.id), 'Committed')
            stale.answer(old, 'Stale update')
    assert error.value.status_code == 409
    with store.transaction() as repository:
        assert repository.find('demo-user', interview.id).answeredCount == 1
    store.engine.dispose()


def test_dynamic_questions_and_final_answer(client, monkeypatch):
    from app.services import ai_service
    calls = []
    def generate(role, level, previous_messages, **context):
        calls.append((role, level, list(previous_messages), context))
        return f'Dynamic question {len(calls)}?'
    monkeypatch.setattr(ai_service, 'generate_question', generate)
    login(client)
    interview = start(client, type='Behavioral', jobDescription='Team leadership')
    path = '/api/interviews/' + interview['id']
    assert interview['messages'][0]['text'] == 'Dynamic question 1?'
    assert calls[0] == ('Backend Developer', 'Middle', [],
                        {'interview_type': 'Behavioral', 'job_description': 'Team leadership'})
    for index in range(5):
        result = client.post(path + '/messages', json={'text': f' Answer {index} '})
        assert result.status_code == 200
        if index < 4:
            assert result.json()['messages'][-1]['text'] == f'Dynamic question {index + 2}?'
            assert calls[-1][2][-1].text == f'Answer {index}'
            assert calls[-1][2][-1].sender == 'you'
    assert len(calls) == 5
    assert result.json()['status'] == 'complete'
    assert client.post(path + '/messages', json={'text': 'extra'}).status_code == 409
    assert len(calls) == 5
    assert client.get(path).json() == result.json()


def test_question_fallback_during_api_outage(client, monkeypatch):
    import httpx
    from app.services import ai_service
    from app.models import InterviewSetup
    from app.store import question
    monkeypatch.setenv('AI_API_KEY', 'test-secret')
    def unavailable(*args, **kwargs):
        raise httpx.ConnectError('unavailable')
    client_class = httpx.Client
    monkeypatch.setattr(ai_service.httpx, 'Client', lambda **kwargs: client_class(
        transport=httpx.MockTransport(unavailable), **kwargs))
    login(client)
    interview = start(client, type='Behavioral')
    setup = InterviewSetup(**(SETUP | {'type': 'Behavioral'}))
    assert interview['messages'][0]['text'] == question(setup, 0)
    response = client.post('/api/interviews/' + interview['id'] + '/messages', json={'text': 'Answer'})
    assert response.status_code == 200
    assert response.json()['messages'][-1]['text'] == question(setup, 1)
