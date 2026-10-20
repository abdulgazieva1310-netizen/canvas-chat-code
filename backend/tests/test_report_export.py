import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.services import ai_service


@pytest.mark.parametrize('mode', ['Practice', 'Real Interview'])
@pytest.mark.parametrize('complete', [False, True])
def test_report_export_ownership_privacy_and_saved_unicode(tmp_path, monkeypatch, mode, complete):
    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **k: 'Explain an example?')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *a, **k: None)
    monkeypatch.setattr(ai_service, 'generate_followup', lambda *a, **k: None)
    with TestClient(create_app(seed=False, database_url=f'sqlite:///{tmp_path / "export.db"}')) as client:
        client.post('/api/auth/register', json={'name':'Owner', 'email':'owner@example.com', 'password':'secret'})
        interview = client.post('/api/interviews', json=dict(role='QA Engineer',level='Junior',mode=mode,
            questionCount=5,type='Behavioral',input='Text',language='English')).json()
        path = '/api/interviews/' + interview['id']
        assert client.get(path+'/report/export').status_code == 409
        answer = 'Пример\n```python\n  print("hello")\n```\n````'
        client.post(path+'/messages', json={'text': answer})
        if complete:
            for _ in range(4):
                assert client.post(path+'/messages', json={'text': 'Another answer'}).status_code == 200
        else:
            client.post(path+'/end')
        def forbidden(*a, **k):
            raise AssertionError('Export must not call AI')
        for name in ['generate_question','evaluate_answer','generate_hint','generate_followup']:
            monkeypatch.setattr(ai_service, name, forbidden)
        before = client.get(path).json()
        result = client.get(path+'/report/export')
        assert result.status_code == 200
        assert result.headers['content-type'].startswith('text/markdown')
        assert 'attachment; filename="interview-report-' in result.headers['content-disposition']
        assert result.headers['cache-control'] == 'no-store'
        assert answer in result.text and '`````' in result.text
        assert ('Partial results' in result.text) == (not complete)
        assert 'Not scored' in result.text
        assert 'Interview language: English' in result.text and 'approximate AI coaching' in result.text
        for secret in ['password_hash','reviewerNotes','balanced-brackets-v1','storage_key','Bearer']:
            assert secret not in result.text
        assert client.get(path+'/report/export').content == result.content
        assert client.get(path).json() == before
        client.post('/api/auth/register', json={'name':'Other','email':'other@example.com','password':'secret'})
        foreign = client.get(path+'/report/export')
        absent = client.get('/api/interviews/missing/report/export')
        assert foreign.status_code == absent.status_code == 404 and foreign.json() == absent.json()
        client.cookies.clear()
        assert client.get(path+'/report/export').status_code == 401
