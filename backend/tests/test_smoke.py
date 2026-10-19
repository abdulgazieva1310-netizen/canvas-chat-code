"""Dependency baseline: no application imports, database, or external services."""
from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_asgi_baseline():
    application = FastAPI()

    @application.get('/health')
    def health():
        return {'status': 'ok'}

    with TestClient(application) as client:
        response = client.get('/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}
