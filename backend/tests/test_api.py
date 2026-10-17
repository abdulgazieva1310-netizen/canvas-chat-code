from datetime import timedelta
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from jsonschema import Draft4Validator, RefResolver

from app.auth import hasher, token_key
from app.main import create_app
from app.store import now

SETUP = dict(role='Backend Developer', level='Middle', mode='Practice', questionCount=5,
             type='Technical', input='Text', language='English')


@pytest.fixture
def client():
    with TestClient(create_app()) as client:
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
    assert token not in store.tokens
    assert hasher.verify('demo-password', store.passwords['demo-user'])
    assert store.passwords['demo-user'] != 'demo-password'
    history = client.get('/api/interviews').json()
    assert len(history) == 2
    assert history[0]['startedAt'] > history[1]['startedAt']
    assert client.get('/api/interviews', headers={'Authorization': 'Bearer invalid'}).status_code == 401
    client.cookies.clear()
    assert client.get('/api/interviews', headers={'Authorization': f'Bearer {token}'}).status_code == 200
    store.tokens[token_key(token)] = ('demo-user', now() - timedelta(seconds=1))
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
    with TestClient(create_app(secure_cookies=True)) as client:
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
