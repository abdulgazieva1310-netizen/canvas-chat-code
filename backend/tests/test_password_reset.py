from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import token_key
from app.database import PasswordResetRecord
from app.main import create_app
from app.services.email_service import LocalMailbox


def test_smtp_adapter_uses_tls_and_configured_sender(monkeypatch):
    from app.services.email_service import SMTPDelivery, email_delivery
    calls = []

    class SMTPStub:
        def __init__(self, host, port, timeout):
            calls.append((host, port, timeout))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def starttls(self, *, context):
            assert context.check_hostname
            calls.append('tls')

        def login(self, username, password):
            calls.append((username, password))

        def send_message(self, message):
            calls.append(message)

    for key, value in {'EMAIL_ADAPTER': 'smtp', 'SMTP_HOST': 'smtp.example.com',
                       'SMTP_FROM': 'sender@example.com', 'SMTP_USERNAME': 'user',
                       'SMTP_PASSWORD': 'secret'}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv('SMTP_PORT', raising=False)
    monkeypatch.setattr('app.services.email_service.smtplib.SMTP', SMTPStub)
    adapter = email_delivery()
    assert isinstance(adapter, SMTPDelivery)
    adapter.send_reset('recipient@example.com', 'https://example.com/reset?token=test')
    assert calls[:3] == [('smtp.example.com', 587, 10), 'tls', ('user', 'secret')]
    assert calls[3]['To'] == 'recipient@example.com'
    assert calls[3]['From'] == 'sender@example.com'
    assert 'https://example.com/reset?token=test' in calls[3].get_content()


def reset_token(mailbox):
    return parse_qs(urlparse(mailbox.messages[-1]['link']).query)['token'][0]


def test_recovery_revokes_sessions_and_all_reset_links(tmp_path):
    mailbox = LocalMailbox()
    app = create_app(database_url=f'sqlite:///{tmp_path / "reset.db"}', mailer=mailbox)
    with TestClient(app) as client:
        login = client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
        old_auth = login.headers['authorization']
        for _ in range(2):
            known = client.post('/api/auth/password-reset/request', json={'email': 'DEMO@example.com'})
        unknown = client.post('/api/auth/password-reset/request', json={'email': 'unknown@example.com'})
        assert known.status_code == unknown.status_code == 202
        assert known.content == unknown.content
        assert len(mailbox.messages) == 2
        token = reset_token(mailbox)
        with app.state.store.sessions() as session:
            assert session.get(PasswordResetRecord, token) is None
            assert session.get(PasswordResetRecord, token_key(token)) is not None
        result = client.post('/api/auth/password-reset/confirm', json={'token': token, 'password': 'replacement'})
        assert result.status_code == 204
        assert client.get('/api/auth/me', headers={'Authorization': old_auth}).status_code == 401
        for message in mailbox.messages:
            token = parse_qs(urlparse(message['link']).query)['token'][0]
            assert client.post('/api/auth/password-reset/confirm', json={
                'token': token, 'password': 'another'}).status_code == 400
        assert client.post('/api/auth/login', json={
            'email': 'demo@example.com', 'password': 'demo-password'}).status_code == 401
        assert client.post('/api/auth/login', json={
            'email': 'demo@example.com', 'password': 'replacement'}).status_code == 200


def test_expired_invalid_and_delivery_failure(tmp_path):
    mailbox = LocalMailbox()
    app = create_app(database_url=f'sqlite:///{tmp_path / "expiry.db"}', mailer=mailbox)
    with TestClient(app) as client:
        client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'})
        token = reset_token(mailbox)
        with app.state.store.sessions.begin() as session:
            session.get(PasswordResetRecord, token_key(token)).expires_at = 0
        for value in (token, 'invalid'):
            response = client.post('/api/auth/password-reset/confirm', json={'token': value, 'password': 'new'})
            assert response.status_code == 400
            assert 'new' not in response.text

        class FailedDelivery:
            def send_reset(self, email, link):
                raise RuntimeError('provider failed')

        app.state.mailer = FailedDelivery()
        known = client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'})
        unknown = client.post('/api/auth/password-reset/request', json={'email': 'absent@example.com'})
        assert known.status_code == unknown.status_code == 202
        assert known.content == unknown.content
        with app.state.store.sessions() as session:
            assert len(session.scalars(select(PasswordResetRecord)).all()) == 1  # Only the expired link.


def test_new_link_invalidates_previous_link_before_consumption(tmp_path):
    mailbox = LocalMailbox()
    app = create_app(database_url=f'sqlite:///{tmp_path / "replacement.db"}', mailer=mailbox)
    with TestClient(app) as client:
        client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'})
        previous = reset_token(mailbox)
        client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'})
        current = reset_token(mailbox)
        assert previous != current
        assert client.post('/api/auth/password-reset/confirm', json={
            'token': previous, 'password': 'obsolete-password'}).status_code == 400
        assert client.post('/api/auth/password-reset/confirm', json={
            'token': current, 'password': 'current-password'}).status_code == 204


def test_concurrent_reset_consumption_has_one_winner(tmp_path):
    from concurrent.futures import ThreadPoolExecutor

    mailbox = LocalMailbox()
    app = create_app(database_url=f'sqlite:///{tmp_path / "concurrent.db"}', mailer=mailbox)
    with TestClient(app) as client:
        client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'})
        token = reset_token(mailbox)
        def consume(index):
            return client.post('/api/auth/password-reset/confirm', json={
                'token': token, 'password': f'replacement-{index}'}).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(consume, range(2))) == [204, 400]


def test_reset_expiry_is_exactly_thirty_minutes(tmp_path, monkeypatch):
    from datetime import datetime, timezone
    from app.routers import auth

    instant = datetime(2026, 1, 1, tzinfo=timezone.utc)
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant
    monkeypatch.setattr(auth, 'datetime', Clock)
    mailbox = LocalMailbox()
    app = create_app(database_url=f'sqlite:///{tmp_path / "boundary.db"}', mailer=mailbox)
    with TestClient(app) as client:
        client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'})
        token = reset_token(mailbox)
        with app.state.store.sessions() as session:
            expiry = session.get(PasswordResetRecord, token_key(token)).expires_at
        assert expiry == instant.timestamp() + 1800
        instant = datetime.fromtimestamp(expiry, timezone.utc)
        assert client.post('/api/auth/password-reset/confirm', json={
            'token': token, 'password': 'replacement'}).status_code == 400
