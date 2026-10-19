import time

import pytest
from fastapi.testclient import TestClient

from app.database import InterviewMediaRecord
from app.main import create_app
from app.media_storage import media_path, media_root


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('INTERVIEW_MEDIA_DIR', str(tmp_path / 'private-media'))
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "media.db"}')) as test_client:
        yield test_client


def login(client, email='demo@example.com', password='demo-password'):
    response = client.post('/api/auth/login', json={'email': email, 'password': password})
    assert response.status_code == 200
    return response


def start_interview(client):
    response = client.post('/api/interviews', json={
        'role': 'Frontend Developer', 'level': 'Middle', 'mode': 'Practice',
        'questionCount': 5, 'type': 'Technical', 'input': 'Text', 'language': 'English'})
    assert response.status_code == 201
    return response.json()['id']


def test_media_requires_consent_and_owner_can_play_and_delete(client):
    login(client)
    interview_id = start_interview(client)
    upload = client.post(f'/api/interviews/{interview_id}/media',
                         content=b'private-recording', headers={'Content-Type': 'audio/webm'})
    assert upload.status_code == 409
    assert not media_root().exists()

    consent = client.post(f'/api/interviews/{interview_id}/media/consent', json={'consented': True})
    assert consent.status_code == 204
    upload = client.post(f'/api/interviews/{interview_id}/media', content=b'private-recording',
                         headers={'Content-Type': 'audio/webm'})
    assert upload.status_code == 201
    item = upload.json()
    assert item['mediaType'] == 'audio/webm' and item['sizeBytes'] == len(b'private-recording')
    assert item['expiresAt'] > item['createdAt']
    storage_file = media_path(item['id'])
    assert storage_file.read_bytes() == b'private-recording'
    assert storage_file.stat().st_mode & 0o777 == 0o600

    listing = client.get(f'/api/interviews/{interview_id}/media')
    assert listing.json()['retentionDays'] == 30
    assert [record['id'] for record in listing.json()['media']] == [item['id']]
    playback = client.get(f'/api/interviews/{interview_id}/media/{item["id"]}')
    assert playback.content == b'private-recording'
    assert playback.headers['cache-control'] == 'private, no-store'

    client.post('/api/auth/register', json={'name': 'Second User', 'email': 'second@example.com', 'password': 'another-password'})
    denied = client.get(f'/api/interviews/{interview_id}/media/{item["id"]}')
    assert denied.status_code == 404
    assert client.delete(f'/api/interviews/{interview_id}/media/{item["id"]}').status_code == 404

    login(client)
    assert client.delete(f'/api/interviews/{interview_id}/media/{item["id"]}').status_code == 204
    assert not storage_file.exists()
    assert client.get(f'/api/interviews/{interview_id}/media').json()['media'] == []
    client.post(f'/api/interviews/{interview_id}/end')
    assert client.get(f'/api/interviews/{interview_id}/report').status_code == 200


def test_expired_media_is_removed_and_missing_playback_does_not_remove_report(client):
    login(client)
    interview_id = start_interview(client)
    client.post(f'/api/interviews/{interview_id}/media/consent', json={'consented': True})
    item = client.post(f'/api/interviews/{interview_id}/media', content=b'expiring',
                       headers={'Content-Type': 'video/webm'}).json()
    path = media_path(item['id'])
    with client.app.state.store.transaction() as store:
        record = store.session.get(InterviewMediaRecord, item['id'])
        record.expires_at = time.time() - 1
    assert client.get(f'/api/interviews/{interview_id}/media').json()['media'] == []
    assert not path.exists()

    missing = client.get(f'/api/interviews/{interview_id}/media/{item["id"]}')
    assert missing.status_code == 404
    client.post(f'/api/interviews/{interview_id}/end')
    assert client.get(f'/api/interviews/{interview_id}/report').status_code == 200


def test_consent_revocation_and_interview_deletion_remove_stored_files(client):
    login(client)
    interview_id = start_interview(client)
    client.post(f'/api/interviews/{interview_id}/media/consent', json={'consented': True})
    item = client.post(f'/api/interviews/{interview_id}/media', content=b'revoke-me',
                       headers={'Content-Type': 'audio/mp4'}).json()
    path = media_path(item['id'])
    assert path.exists()
    assert client.post(f'/api/interviews/{interview_id}/media/consent',
                       json={'consented': False}).status_code == 204
    assert not path.exists()
    assert client.post(f'/api/interviews/{interview_id}/media', content=b'no-consent',
                       headers={'Content-Type': 'audio/mp4'}).status_code == 409

    client.post(f'/api/interviews/{interview_id}/media/consent', json={'consented': True})
    item = client.post(f'/api/interviews/{interview_id}/media', content=b'delete-session',
                       headers={'Content-Type': 'audio/mp4'}).json()
    path = media_path(item['id'])
    assert client.delete(f'/api/interviews/{interview_id}').status_code == 204
    assert not path.exists()
