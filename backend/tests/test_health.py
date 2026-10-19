from fastapi.testclient import TestClient
from app.main import create_app


def test_health_is_public_liveness_without_provider_or_database_queries(tmp_path, monkeypatch):
    app = create_app(seed=False, database_url=f'sqlite:///{tmp_path / "health.db"}')
    def forbidden(*args, **kwargs):
        raise AssertionError('Liveness must not consult services')
    monkeypatch.setattr(app.state.store, 'transaction', forbidden)
    monkeypatch.setattr(app.state.mailer, 'send_reset', forbidden)
    monkeypatch.setattr('app.services.ai_service.generate_question', forbidden)
    with TestClient(app) as client:
        response = client.get('/api/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}
    assert response.headers['cache-control'] == 'no-store'
