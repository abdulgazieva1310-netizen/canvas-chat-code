"""Opt-in HTTP integration coverage for the root Docker Compose stack."""
import os
import re
import subprocess
import time
from pathlib import Path
from uuid import uuid4

import httpx
import pytest


if os.getenv("COMPOSE_INTEGRATION") != "1":
    pytest.skip("Set COMPOSE_INTEGRATION=1 to test the running Docker Compose stack", allow_module_level=True)


ROOT = Path(__file__).resolve().parents[3]
COMPOSE_FILE = ROOT / "docker-compose.yaml"
APP_URL = os.getenv("COMPOSE_APP_URL", "http://localhost:8000").rstrip("/")
TIMEOUT = httpx.Timeout(5.0, connect=2.0)


def wait_for_app(client: httpx.Client, timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    last_error = "no response"
    while time.monotonic() < deadline:
        try:
            response = client.get("/api/health")
            if response.status_code == 200:
                return
            last_error = f"health endpoint returned {response.status_code}"
        except httpx.HTTPError as exc:
            last_error = str(exc)
        time.sleep(1)
    pytest.fail(f"Compose app did not become healthy within {timeout:g}s: {last_error}")


@pytest.fixture
def api():
    with httpx.Client(base_url=APP_URL, timeout=TIMEOUT) as client:
        wait_for_app(client)
        yield client


@pytest.fixture
def account(api):
    password = "compose-integration-password"
    email = f"compose-{uuid4().hex}@example.test"
    response = api.post("/api/auth/register", json={
        "name": "Compose Integration",
        "email": email,
        "password": password,
    })
    assert response.status_code == 201, response.text
    user = response.json()
    authorization = response.headers["authorization"]
    yield {"email": email, "password": password, "user": user, "authorization": authorization}

    deleted = api.request("DELETE", "/api/auth/me", headers={"Authorization": authorization},
                          json={"password": password, "confirmation": "DELETE"})
    assert deleted.status_code == 204, f"Failed to delete disposable test account: {deleted.text}"


@pytest.mark.parametrize("origin", [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:8100",
])
def test_frontend_origins_pass_cors_preflight(api, origin):
    response = api.options("/api/interviews", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"


def test_postgres_interview_json_round_trip_and_transcript_search(api, account):
    headers = {"Authorization": account["authorization"], "Idempotency-Key": uuid4().hex}
    setup = {
        "role": "Backend Developer",
        "level": "Junior",
        "mode": "Practice",
        "questionCount": 5,
        "type": "Technical",
        "input": "Text",
        "language": "English",
        "jobDescription": "Compose PostgreSQL persistence check",
    }

    started = api.post("/api/interviews", headers=headers, json=setup)
    assert started.status_code == 201, started.text
    interview = started.json()
    interview_id = interview["id"]
    question = next(message for message in reversed(interview["messages"])
                    if message["from"] == "ai")

    ended = api.post(f"/api/interviews/{interview_id}/end", headers=headers)
    assert ended.status_code == 200, ended.text
    reread = api.get(f"/api/interviews/{interview_id}", headers=headers)
    assert reread.status_code == 200, reread.text
    assert reread.json()["messages"] == interview["messages"]

    word = re.search(r"[A-Za-z]{3,}", question["text"])
    assert word, f"Expected a searchable word in the generated question: {question['text']!r}"
    results = api.get("/api/interviews", headers=headers, params={
        "searchMode": "transcript",
        "search": word.group(0).swapcase(),
    })
    assert results.status_code == 200, results.text
    page = results.json()
    assert page["total"] == 1
    assert [item["id"] for item in page["items"]] == [interview_id]
    assert any(match["id"] == question["id"] for match in page["matches"][interview_id])


def test_profile_and_session_survive_compose_app_restart(api, account):
    headers = {"Authorization": account["authorization"]}
    updated_profile = {
        "name": "Persisted Compose User",
        "targetRole": "Backend Developer",
        "level": "Senior",
        "preferredLanguage": "English",
        "interviewerAvatar": "sage",
    }
    updated = api.patch("/api/auth/me", headers=headers, json=updated_profile)
    assert updated.status_code == 200, updated.text

    restarted = subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), "restart", "app"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert restarted.returncode == 0, restarted.stderr or restarted.stdout
    wait_for_app(api)

    after_restart = api.get("/api/auth/me", headers=headers)
    assert after_restart.status_code == 200, after_restart.text
    persisted = after_restart.json()
    assert {key: persisted[key] for key in updated_profile} == updated_profile
    assert persisted["id"] == account["user"]["id"]
    assert persisted["email"] == account["email"]

    login = api.post("/api/auth/login", json={"email": account["email"], "password": account["password"]})
    assert login.status_code == 200, login.text
    assert login.json()["name"] == updated_profile["name"]
