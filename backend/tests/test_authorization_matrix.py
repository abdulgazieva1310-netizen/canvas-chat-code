from fastapi.testclient import TestClient

from app.main import create_app


def test_private_operations_require_identity_and_hide_other_owners(tmp_path, monkeypatch):
    from app.services import ai_service
    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **kw: 'Describe a trade-off.')
    app = create_app(database_url=f'sqlite:///{tmp_path / "owners.db"}')
    with TestClient(app) as client:
        client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
        owner_profile = client.get('/api/auth/me').json()
        interview = client.post('/api/interviews', json=dict(role='QA Engineer', level='Middle',
            mode='Practice', questionCount=5, type='Technical', input='Text', language='English')).json()
        operations = [('GET', '', None), ('GET', '/report', None), ('POST', '/messages', {'text': 'answer'}),
                      ('POST', '/hint', None), ('POST', '/end', None), ('POST', '/resume', None),
                      ('DELETE', '', None)]
        client.cookies.clear()
        for method, suffix, body in operations:
            assert client.request(method, '/api/interviews/' + interview['id'] + suffix, json=body).status_code == 401
        for path in ['/api/auth/me', '/api/interviews', '/api/dashboard/summary']:
            assert client.get(path).status_code == 401
        client.post('/api/auth/register', json={'name': 'Other', 'email': 'other@example.com', 'password': 'secret'})
        for method, suffix, body in operations:
            foreign = client.request(method, '/api/interviews/' + interview['id'] + suffix, json=body)
            absent = client.request(method, '/api/interviews/absent' + suffix, json=body)
            assert foreign.status_code == absent.status_code == 404
            assert foreign.json() == absent.json()
        assert client.get('/api/interviews', params={'ownerId': 'demo-user'}).json()['items'] == []
        assert client.get('/api/auth/me', params={'ownerId': 'demo-user'}).json()['id'] != owner_profile['id']
        client.patch('/api/auth/me', json={'name': 'Other renamed'})
        client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
        assert client.get('/api/auth/me').json() == owner_profile
        assert client.get('/api/interviews/' + interview['id']).json() == interview
