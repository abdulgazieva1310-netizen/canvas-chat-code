from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SetupPresetRecord
from app.main import create_app
from app.services import ai_service


def test_setup_presets_are_private_normalized_limited_and_snapshot_safe(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **k: 'Describe a project?')
    monkeypatch.setattr(ai_service, 'provider_supports_language', lambda _language: False)
    app = create_app(seed=False, database_url=f'sqlite:///{tmp_path / "presets.db"}')
    with TestClient(app) as client:
        client.post('/api/auth/register', json={'name': 'Owner', 'email': 'presets@example.com', 'password': 'secret'})
        preset_data = {'name': '  QA  Practice  ', 'role': 'QA Engineer', 'level': 'Senior',
            'type': 'Role-specific', 'mode': 'Practice', 'input': 'Text', 'questionCount': 10,
            'language': 'English'}
        created = client.post('/api/setup-presets', json=preset_data)
        assert created.status_code == 201
        preset = created.json()
        assert preset['name'] == 'QA Practice'
        assert client.get('/api/setup-presets').json()['items'] == [preset]
        assert client.get(f"/api/setup-presets/{preset['id']}").json() == preset
        duplicate = client.post('/api/setup-presets', json={**preset_data, 'name': 'qa   practice'})
        assert duplicate.status_code == 409
        assert client.post('/api/setup-presets', json={**preset_data, 'name': '  '}).status_code == 400
        assert client.post('/api/setup-presets', json={**preset_data, 'name': 'x' * 81}).status_code == 400
        assert client.post('/api/setup-presets', json={**preset_data, 'questionCount': 7}).status_code == 400
        assert client.post('/api/setup-presets', json={**preset_data, 'role': 'Invented role'}).status_code == 400

        setup = dict(role=preset['role'], level=preset['level'], mode=preset['mode'],
            questionCount=preset['questionCount'], type=preset['type'], input=preset['input'],
            language=preset['language'], jobDescription='From separate target', practiceTopic='Flaky tests')
        interview = client.post('/api/interviews', json=setup).json()
        interview_path = f"/api/interviews/{interview['id']}"
        updated_data = {**preset_data, 'name': 'Renamed and updated', 'role': 'Backend Developer', 'level': 'Middle'}
        updated = client.put(f"/api/setup-presets/{preset['id']}", json=updated_data).json()
        assert updated['name'] == 'Renamed and updated'
        assert client.get(interview_path).json()['setup'] == setup

        client.post('/api/auth/register', json={'name': 'Other', 'email': 'other-presets@example.com', 'password': 'secret'})
        other_preset = client.post('/api/setup-presets', json=preset_data)
        assert other_preset.status_code == 201
        foreign = client.get(f"/api/setup-presets/{preset['id']}")
        missing = client.get('/api/setup-presets/not-a-preset')
        assert foreign.status_code == missing.status_code == 404
        assert foreign.json() == missing.json()
        assert client.put(f"/api/setup-presets/{preset['id']}", json=preset_data).status_code == 404
        assert client.delete(f"/api/setup-presets/{preset['id']}").status_code == 404
        assert [item['name'] for item in client.get('/api/setup-presets').json()['items']] == ['QA Practice']
        assert client.get('/api/auth/me/export').json()['setupPresets'][0]['id'] == other_preset.json()['id']

        owner_token = client.post('/api/auth/login', json={'email': 'presets@example.com', 'password': 'secret'}).headers['authorization']
        client.cookies.clear()
        client.headers['Authorization'] = owner_token
        archive = client.get('/api/auth/me/export').json()
        assert archive['setupPresets'][0]['name'] == 'Renamed and updated'
        assert client.get(interview_path).json()['setup'] == setup

        russian = client.post('/api/setup-presets', json={**preset_data, 'name': 'Russian preview', 'language': 'Russian'}).json()
        assert russian['language'] == 'Russian'
        unavailable = client.post('/api/interviews', json={**setup, 'language': russian['language']})
        assert unavailable.status_code == 503

        for index in range(18):
            assert client.post('/api/setup-presets', json={**preset_data, 'name': f'Preset {index}'}).status_code == 201
        assert client.post('/api/setup-presets', json={**preset_data, 'name': 'At limit'}).status_code == 409
        assert client.get('/api/setup-presets').json()['limit'] == 20
        assert client.delete(f"/api/setup-presets/{updated['id']}").status_code == 204
        assert client.get(interview_path).json()['setup'] == setup
        with app.state.store.sessions() as session:
            assert len(session.scalars(select(SetupPresetRecord)).all()) == 20
            assert session.get(SetupPresetRecord, updated['id']) is None
