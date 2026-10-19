"""Capture SMTP output locally through a fake service; never contact a recipient."""
from email import policy
from email.parser import BytesParser
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.email_service import SMTPDelivery, password_reset_url


@pytest.fixture
def smtp_capture(monkeypatch):
    messages = []
    class Capture:
        def __init__(self, host, port, timeout):
            assert (host, port, timeout) == ('smtp.example.test', 2525, 10)
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def starttls(self, *, context):
            assert context.check_hostname
        def login(self, username, password):
            assert (username, password) == ('account', 'private-credential')
        def send_message(self, message):
            messages.append(BytesParser(policy=policy.default).parsebytes(message.as_bytes()))
    for key, value in dict(EMAIL_ADAPTER='smtp', SMTP_HOST='smtp.example.test',
                           SMTP_PORT='2525', SMTP_FROM='accounts@example.test',
                           SMTP_USERNAME='account', SMTP_PASSWORD='private-credential',
                           PASSWORD_RESET_URL='https://app.example.test/reset-password?source=email&token=old').items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr('app.services.email_service.smtplib.SMTP', Capture)
    return messages


def test_rendered_smtp_reset_email_and_single_use(tmp_path, smtp_capture):
    app = create_app(database_url=f'sqlite:///{tmp_path / "smtp.db"}')
    with TestClient(app) as client:
        assert client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'}).status_code == 202
        message, = smtp_capture
        assert message['To'] == 'demo@example.com'
        assert message['From'] == 'accounts@example.test'
        assert message['Subject'] == 'Reset your Interview Mirror password'
        text = message.get_content()
        assert '30 minutes' in text
        link = next(line for line in text.splitlines() if line.startswith('https://'))
        parsed = urlsplit(link)
        assert parsed.netloc == 'app.example.test'
        assert parse_qs(parsed.query)['source'] == ['email']
        token, = parse_qs(parsed.query)['token']
        assert token != 'old'
        body = {'token': token, 'password': 'new-password'}
        assert client.post('/api/auth/password-reset/confirm', json=body).status_code == 204
        assert client.post('/api/auth/password-reset/confirm', json=body).status_code == 400


@pytest.mark.parametrize('failure', [TimeoutError, OSError])
def test_smtp_failure_is_private_and_bounded(tmp_path, smtp_capture, monkeypatch, caplog, failure):
    app = create_app(database_url=f'sqlite:///{tmp_path / "fail.db"}')
    def fail(host, port, timeout):
        assert timeout == 10
        raise failure('private-credential secret-token https://private-reset-link')
    monkeypatch.setattr('app.services.email_service.smtplib.SMTP', fail)
    with TestClient(app) as client:
        known = client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'})
        unknown = client.post('/api/auth/password-reset/request', json={'email': 'absent@example.com'})
        assert known.status_code == unknown.status_code == 202
        assert known.content == unknown.content
    assert 'Password recovery email delivery failed' in caplog.text
    for secret in ['private-credential', 'secret-token', 'private-reset-link', 'demo@example.com']:
        assert secret not in caplog.text
        assert secret not in known.text
    assert not smtp_capture


def test_url_required_for_smtp(monkeypatch):
    monkeypatch.setenv('EMAIL_ADAPTER', 'smtp')
    monkeypatch.delenv('PASSWORD_RESET_URL', raising=False)
    with pytest.raises(ValueError, match='required'):
        password_reset_url()


@pytest.mark.parametrize('url', ['relative', 'ftp://app.test/reset', 'https://u:p@app.test/reset', 'https://app.test/reset#fragment'])
def test_invalid_reset_url(monkeypatch, url):
    monkeypatch.setenv('PASSWORD_RESET_URL', url)
    with pytest.raises(ValueError):
        password_reset_url()
