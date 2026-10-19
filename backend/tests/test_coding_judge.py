from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from app.main import create_app

from app.models import AnswerEvaluation
from app.routers.interviews import JUDGE_CASES, judge_code
from app.services import ai_service


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "judge.db"}')) as test_client:
        yield test_client


def test_reviewed_cases_include_normal_boundary_and_invalid_input():
    cases = JUDGE_CASES['balanced-brackets-v1']
    assert {case[0] for case in cases} == {'normal', 'boundary', 'invalid-input'}
    assert len(cases) >= 5


def test_judge_keeps_private_cases_out_of_summary(monkeypatch):
    from app.routers import interviews

    calls = []

    def fake_post(_url, *, json, **_kwargs):
        calls.append(json['stdin'])
        output = 'true\n' if json['stdin'] in {'{}[]\n', '\n', '(((())))\n'} else 'false\n'
        return SimpleNamespace(status_code=200, raise_for_status=lambda: None,
                               json=lambda: {'status': 'success', 'stdout': output, 'stderr': ''})

    monkeypatch.setenv('CODING_RUNNER_URL', 'http://runner')
    monkeypatch.setenv('CODING_RUNNER_TOKEN', 'x' * 32)
    monkeypatch.setattr(interviews.httpx, 'post', fake_post)
    result = judge_code('Python', 'solution', 'balanced-brackets-v1')
    assert result['status'] == 'passed'
    assert result['passed'] == result['total'] == 5
    assert len(calls) == 5
    assert all(value not in result['summary'] for value in calls)


def test_judge_reports_compile_error_without_private_case_details(monkeypatch):
    from app.routers import interviews

    monkeypatch.setenv('CODING_RUNNER_URL', 'http://runner')
    monkeypatch.setenv('CODING_RUNNER_TOKEN', 'x' * 32)
    monkeypatch.setattr(interviews.httpx, 'post', lambda *_a, **_k: SimpleNamespace(
        status_code=200, raise_for_status=lambda: None,
        json=lambda: {'status': 'compile-error', 'stdout': '', 'stderr': 'bad source'}))
    result = judge_code('Python', 'invalid', 'balanced-brackets-v1')
    assert result['status'] == 'compile-error'
    assert result['passed'] == 0
    assert '\n' not in result['summary']


@pytest.mark.parametrize(('runner_status', 'judge_status'), [
    ('runtime-error', 'runtime-error'), ('timeout', 'timeout'),
])
def test_judge_preserves_runtime_and_timeout_classification(monkeypatch, runner_status, judge_status):
    from app.routers import interviews

    monkeypatch.setenv('CODING_RUNNER_URL', 'http://runner')
    monkeypatch.setenv('CODING_RUNNER_TOKEN', 'x' * 32)
    monkeypatch.setattr(interviews.httpx, 'post', lambda *_a, **_k: SimpleNamespace(
        status_code=200, raise_for_status=lambda: None,
        json=lambda: {'status': runner_status, 'stdout': '', 'stderr': 'private details'}))
    result = judge_code('Python', 'invalid', 'balanced-brackets-v1')
    assert result['status'] == judge_status
    assert 'private details' not in result['summary']


def test_judged_question_persists_summary_and_keeps_ai_coaching(client, monkeypatch):
    from app.services import ai_service
    from app.routers import interviews

    evaluation = AnswerEvaluation(accuracy=7, completeness=7, clarity=7, structure=7,
        went_well='Good explanation.', missing='Mention complexity.', stronger_answer='A stronger explanation.')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: evaluation)
    monkeypatch.setattr(interviews, 'judge_code', lambda *_args: {
        'status': 'failed', 'passed': 4, 'total': 5, 'summary': '1 reviewed correctness check failed.'})
    client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
    started = client.post('/api/interviews', json={
        'role': 'Backend Developer', 'level': 'Junior', 'mode': 'Practice',
        'questionCount': 5, 'type': 'Technical', 'input': 'Text', 'language': 'English'})
    assert started.status_code == 201
    interview = started.json()
    question = interview['messages'][0]
    assert question['codingQuestionId'] == 'coding-junior-balanced'
    assert 'read one line from standard input' in question['text'].lower()
    result = client.post(f"/api/interviews/{interview['id']}/messages",
                         json={'text': 'code', 'expectedQuestionId': question['id']})
    assert result.status_code == 200
    assert result.json()['lastAnswerFeedback']['went_well'] == 'Good explanation.'
    assert result.json()['messages'][1]['codingJudge']['status'] == 'failed'
    client.post(f"/api/interviews/{interview['id']}/end")
    report = client.get(f"/api/interviews/{interview['id']}/report").json()
    assert report['feedback']['questions'][0]['codingJudge']['passed'] == 4
    serialized = str(report)
    assert '(((())))' not in serialized and '(a)' not in serialized
