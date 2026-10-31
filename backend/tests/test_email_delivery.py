"""Capture SMTP output locally through a fake service; never contact a recipient."""
from email import policy
from email.parser import BytesParser
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.email_service import ConsoleDelivery, SMTPDelivery, email_delivery, password_reset_url


@pytest.fixture(autouse=True)
def clear_mail_configuration(monkeypatch):
    for name in ('EMAIL_ADAPTER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_USERNAME',
                 'SMTP_PASSWORD', 'SMTP_FROM', 'PASSWORD_RESET_URL'):
        monkeypatch.delenv(name, raising=False)


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
            assert (username, password) == ('accounts@example.test', 'private-credential')
        def send_message(self, message):
            messages.append(BytesParser(policy=policy.default).parsebytes(message.as_bytes()))
    for key, value in dict(EMAIL_ADAPTER='smtp', SMTP_HOST='smtp.example.test',
                           SMTP_PORT='2525', SMTP_FROM='accounts@example.test',
                           SMTP_USER='accounts@example.test', SMTP_PASSWORD='private-credential',
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


def test_url_defaults_to_local_frontend_when_not_set(monkeypatch):
    monkeypatch.setenv('EMAIL_ADAPTER', 'smtp')
    monkeypatch.delenv('PASSWORD_RESET_URL', raising=False)
    assert password_reset_url() == 'http://localhost:8080/reset-password'


@pytest.mark.parametrize('url', ['relative', 'ftp://app.test/reset', 'https://u:p@app.test/reset', 'https://app.test/reset#fragment'])
def test_invalid_reset_url(monkeypatch, url):
    monkeypatch.setenv('PASSWORD_RESET_URL', url)
    with pytest.raises(ValueError):
        password_reset_url()


def test_smtp_auto_selection_with_smtp_user_and_default_sender(tmp_path, smtp_capture, monkeypatch):
    monkeypatch.delenv('EMAIL_ADAPTER')
    monkeypatch.delenv('SMTP_FROM')
    app = create_app(database_url=f'sqlite:///{tmp_path / "auto.db"}')
    assert isinstance(app.state.mailer, SMTPDelivery)
    with TestClient(app) as client:
        response = client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'})
        assert response.status_code == 202
        message, = smtp_capture
        assert message['From'] == 'accounts@example.test'
        link = next(line for line in message.get_content().splitlines() if line.startswith('https://'))
        token, = parse_qs(urlsplit(link).query)['token']
        assert token not in response.text
        assert client.post('/api/auth/password-reset/confirm', json={
            'token': token, 'password': 'replacement-password'}).status_code == 204
        assert client.post('/api/auth/login', json={
            'email': 'demo@example.com', 'password': 'replacement-password'}).status_code == 200


def test_unconfigured_smtp_logs_a_usable_reset_link(tmp_path, monkeypatch, capsys):
    def unexpected_smtp(*args, **kwargs):
        pytest.fail('Console fallback must not open an SMTP connection')
    monkeypatch.setattr('app.services.email_service.smtplib.SMTP', unexpected_smtp)
    app = create_app(database_url=f'sqlite:///{tmp_path / "console.db"}')
    assert isinstance(app.state.mailer, ConsoleDelivery)
    with TestClient(app) as client:
        unknown = client.post('/api/auth/password-reset/request', json={'email': 'absent@example.com'})
        assert 'Local password reset link' not in capsys.readouterr().out
        known = client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'})
        assert known.status_code == unknown.status_code == 202
        assert known.content == unknown.content
        link = app.state.mailer.messages[-1]['link']
        assert link in capsys.readouterr().out
        assert 'localhost:8080/reset-password' in link
        token, = parse_qs(urlsplit(link).query)['token']
        assert token not in known.text
        assert client.post('/api/auth/password-reset/confirm', json={
            'token': token, 'password': 'console-password'}).status_code == 204


def test_port_465_uses_implicit_tls(smtp_capture, monkeypatch):
    calls = []
    class SSLConnection:
        def __init__(self, host, port, *, timeout, context):
            assert (host, port, timeout) == ('smtp.example.test', 465, 10)
            assert context.check_hostname
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def starttls(self, **kwargs):
            pytest.fail('Implicit TLS must not also negotiate STARTTLS')
        def login(self, user, password):
            calls.append((user, password))
        def send_message(self, message):
            calls.append(message)
    monkeypatch.setenv('SMTP_PORT', '465')
    monkeypatch.setattr('app.services.email_service.smtplib.SMTP_SSL', SSLConnection)
    email_delivery().send_reset('demo@example.com', 'https://app.example.test/reset?token=test')
    assert calls[0] == ('accounts@example.test', 'private-credential')
    assert calls[1]['To'] == 'demo@example.com'


def test_configured_smtp_failure_never_logs_console_link(tmp_path, smtp_capture, monkeypatch, caplog):
    def fail(*args, **kwargs):
        raise OSError('private-credential')
    monkeypatch.setattr('app.services.email_service.smtplib.SMTP', fail)
    app = create_app(database_url=f'sqlite:///{tmp_path / "failed-smtp.db"}')
    with TestClient(app) as client:
        assert client.post('/api/auth/password-reset/request', json={'email': 'demo@example.com'}).status_code == 202
    assert 'Password recovery email delivery failed' in caplog.text
    assert 'Local password reset link' not in caplog.text
    assert 'private-credential' not in caplog.text
