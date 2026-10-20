from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.auth import token_key
from app.database import TokenRecord
from app.main import create_app


def test_login_reload_expiry_and_generic_credentials(tmp_path, monkeypatch):
    from app import auth
    instant = datetime(2026, 10, 19, tzinfo=timezone.utc)
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant
    monkeypatch.setattr(auth, 'datetime', Clock)
    monkeypatch.setattr('app.store.now', lambda: instant)
    app = create_app(database_url=f'sqlite:///{tmp_path / "sessions.db"}')
    with TestClient(app) as client:
        bad = client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'wrong'})
        unknown = client.post('/api/auth/login', json={'email': 'absent@example.com', 'password': 'wrong'})
        assert bad.status_code == unknown.status_code == 401
        assert bad.json() == unknown.json()
        assert 'authorization' not in bad.headers and 'set-cookie' not in bad.headers
        assert client.get('/api/auth/me').status_code == 401
        good = client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
        token = good.headers['authorization']
        with app.state.store.sessions() as session:
            assert session.get(TokenRecord, token_key(token.split()[1])).expires_at == instant.timestamp() + 86400
        # A fresh browser context can restore using the existing server credential.
        with TestClient(app) as reloaded:
            assert reloaded.get('/api/auth/me', headers={'Authorization': token}).json() == good.json()
        with app.state.store.sessions.begin() as session:
            session.get(TokenRecord, token_key(token.split()[1])).expires_at = 0
        assert client.get('/api/auth/me').status_code == 401
        assert client.get('/api/auth/me', headers={'Authorization': token}).status_code == 401
