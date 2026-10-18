import pytest


@pytest.fixture(autouse=True)
def disable_live_ai(monkeypatch):
    # Tests never use a developer's real key or make billable requests.
    monkeypatch.delenv('AI_API_KEY', raising=False)
