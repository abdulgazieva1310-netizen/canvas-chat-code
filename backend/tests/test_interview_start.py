from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import InterviewRecord
from app.main import create_app

SETUP = dict(role='Backend Developer', level='Middle', mode='Practice', questionCount=5,
             type='Technical', input='Text', language='English', jobDescription='API engineer')


def test_creation_retry_is_durable_and_owner_scoped(tmp_path, monkeypatch):
    from app.services import ai_service
    monkeypatch.setattr(ai_service, 'generate_question', lambda *args, **kwargs: 'First question?')
    url = f'sqlite:///{tmp_path / "starts.db"}'
    with TestClient(create_app(seed=False, database_url=url)) as client:
        user = client.post('/api/auth/register', json={
            'name': 'Owner', 'email': 'owner@example.com', 'password': 'secret'})
        auth = user.headers['authorization']
        headers = {'Idempotency-Key': 'start-once', 'Authorization': auth}
        first = client.post('/api/interviews', json=SETUP, headers=headers)
        assert first.status_code == 201
        assert first.json()['setup'] == SETUP
        assert client.get('/api/auth/me').json() == user.json()
        assert client.get('/api/interviews/' + first.json()['id']).json() == first.json()
        assert client.post('/api/interviews', json=SETUP, headers=headers).json() == first.json()
        assert client.post('/api/interviews', json=SETUP | {'level': 'Senior'}, headers=headers).status_code == 409
        deliberate = client.post('/api/interviews', json=SETUP,
                                 headers={'Idempotency-Key': 'start-again', 'Authorization': auth})
        assert deliberate.status_code == 201
        assert deliberate.json()['id'] != first.json()['id']
        client.post('/api/auth/register', json={'name': 'Other', 'email': 'other@example.com', 'password': 'secret'})
        other = client.post('/api/interviews', json=SETUP, headers={'Idempotency-Key': 'start-once'})
        assert other.json()['id'] != first.json()['id']
        assert client.get('/api/interviews/' + first.json()['id']).status_code == 404
    with TestClient(create_app(seed=False, database_url=url)) as client:
        assert client.post('/api/interviews', json=SETUP, headers=headers).json() == first.json()
        assert client.delete('/api/interviews/' + first.json()['id'], headers={'Authorization': auth}).status_code == 204
        assert client.post('/api/interviews', json=SETUP, headers=headers).status_code == 409


def test_concurrent_start_requests_create_one_interview(tmp_path, monkeypatch):
    from app.services import ai_service
    monkeypatch.setattr(ai_service, 'generate_question', lambda *args, **kwargs: 'First question?')
    app = create_app(seed=False, database_url=f'sqlite:///{tmp_path / "race.db"}')
    with TestClient(app) as client:
        client.post('/api/auth/register', json={'name': 'Owner', 'email': 'owner@example.com', 'password': 'secret'})
        def start(_):
            return client.post('/api/interviews', json=SETUP, headers={'Idempotency-Key': 'concurrent'})
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(start, range(2)))
        assert [response.status_code for response in responses] == [201, 201]
        assert responses[0].json()['id'] == responses[1].json()['id']
        with app.state.store.sessions() as session:
            assert session.scalar(select(func.count()).select_from(InterviewRecord)) == 1
        for key in (' ', 'a' * 129):
            assert client.post('/api/interviews', json=SETUP, headers={'Idempotency-Key': key}).status_code == 400
