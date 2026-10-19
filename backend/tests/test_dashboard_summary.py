import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import AnswerEvaluation
from app.services import ai_service


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(seed=False, database_url=f'sqlite:///{tmp_path / "dashboard.db"}')) as test_client:
        yield test_client


def login(client):
    response = client.post('/api/auth/register', json={
        'name': 'Primary', 'email': 'demo@example.com', 'password': 'demo-password'})
    assert response.status_code == 201
    return response


def test_dashboard_summary_aggregates_owner_scoped_completed_scored_sessions(client, monkeypatch):
    evaluations = iter([
        AnswerEvaluation(accuracy=8, completeness=6, clarity=10, structure=4,
            went_well='Clear explanations', missing='Add concrete examples', stronger_answer='Example.'),
        AnswerEvaluation(accuracy=6, completeness=8, clarity=8, structure=6,
            went_well='Clear explanations', missing='Add concrete examples', stronger_answer='Example.'),
    ] * 5)
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: next(evaluations))
    login(client)

    first = client.post('/api/interviews', json={
        'role': 'QA Engineer', 'level': 'Junior', 'mode': 'Practice', 'questionCount': 5,
        'type': 'Behavioral', 'input': 'Text', 'language': 'English',
    }).json()
    first_path = f"/api/interviews/{first['id']}"
    for i in range(5):
        response = client.post(first_path + '/messages', json={'text': f'answer {i}'})
        assert response.status_code == 200

    second = client.post('/api/interviews', json={
        'role': 'QA Engineer', 'level': 'Junior', 'mode': 'Real Interview', 'questionCount': 5,
        'type': 'Behavioral', 'input': 'Text', 'language': 'English',
    }).json()
    for i in range(5):
        assert client.post(f"/api/interviews/{second['id']}/messages", json={'text': f'real {i}'}).status_code == 200

    # Equal timestamps exercise stable ordering by interview ID.
    from app.database import InterviewRecord
    from datetime import datetime, timezone
    tied = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with client.app.state.store.sessions.begin() as session:
        for ident in (first['id'], second['id']):
            record = session.get(InterviewRecord, ident)
            record.started_at = tied.timestamp()
            record.payload['startedAt'] = tied.isoformat().replace('+00:00', 'Z')

    # A completed but unscored session has a group with null averages and no trend.
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: None)
    unscored = client.post('/api/interviews', json={
        'role': 'Data Analyst', 'level': 'Junior', 'mode': 'Practice', 'questionCount': 5,
        'type': 'Behavioral', 'input': 'Text', 'language': 'English',
    }).json()
    for i in range(5):
        assert client.post(f"/api/interviews/{unscored['id']}/messages", json={'text': f'unscored {i}'}).status_code == 200

    partial_evaluation = AnswerEvaluation(accuracy=6, completeness=8, clarity=8, structure=6,
        went_well='Clear explanations', missing='Add concrete examples', stronger_answer='Example.')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: partial_evaluation)
    incomplete = client.post('/api/interviews', json={
        'role': 'Backend Developer', 'level': 'Senior', 'mode': 'Real Interview', 'questionCount': 5,
        'type': 'Technical', 'input': 'Text', 'language': 'English',
    }).json()
    client.post(f"/api/interviews/{incomplete['id']}/messages", json={'text': 'partial'})
    client.post(f"/api/interviews/{incomplete['id']}/end")

    summary = client.get('/api/dashboard/summary').json()
    assert summary['completedCount'] == 3
    assert summary['recentActivity'][0]['id'] == incomplete['id']
    assert summary['recentActivity'][0]['status'] == 'incomplete'
    activity_ids = [item['id'] for item in summary['recentActivity']]
    assert activity_ids.index(min(first['id'], second['id'])) < activity_ids.index(max(first['id'], second['id']))
    scored = next(g for g in summary['groups'] if g['role'] == 'QA Engineer' and g['mode'] == 'Practice')
    other_group = next(g for g in summary['groups'] if g['role'] == 'QA Engineer' and g['mode'] == 'Real Interview')
    empty = next(g for g in summary['groups'] if g['role'] == 'Data Analyst')
    assert scored['scoredCount'] == 1
    assert scored['overall'] == 7
    assert scored['scores'] == {'accuracy': 7.2, 'completeness': 6.8, 'clarity': 9.2, 'structure': 4.8}
    assert len(scored['trends']) == 1 and scored['trends'][0]['interviewId'] == first['id']
    assert other_group['scoredCount'] == 1 and other_group['trends'][0]['interviewId'] == second['id']
    assert empty['scoredCount'] == 0 and empty['overall'] is None
    assert empty['scores'] == {'accuracy': None, 'completeness': None, 'clarity': None, 'structure': None}
    assert empty['trends'] == []
    assert summary['strengths'] == [{'text': 'Clear explanations', 'sources': summary['strengths'][0]['sources']}]
    assert len(summary['strengths'][0]['sources']) == 11
    assert len(summary['weaknesses'][0]['sources']) == 11
    assert summary['suggestions'][0]['topic'] == 'Add concrete examples'
    assert summary['suggestions'][0]['setup']['mode'] == 'Practice'
    assert len({source['interviewId'] for source in summary['suggestions'][0]['sources']}) == 2
    assert len(summary['suggestions'][0]['sources']) == 10
    assert not any(g['role'] == 'Backend Developer' for g in summary['groups'])

    # The same records are private to the first account.
    client.post('/api/auth/register', json={'name': 'Other', 'email': 'other@example.com', 'password': 'secret'})
    assert client.get('/api/dashboard/summary').json()['completedCount'] == 0


def test_dashboard_summary_averages_only_available_categories(client, monkeypatch):
    evaluations = iter([
        AnswerEvaluation(accuracy=8, completeness=None, clarity=6, structure=None,
            went_well='Useful reasoning', missing='State assumptions', stronger_answer='Example one.'),
        AnswerEvaluation(accuracy=None, completeness=10, clarity=None, structure=8,
            went_well='Useful reasoning', missing='State assumptions', stronger_answer='Example two.'),
        None, None, None,
    ])
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: next(evaluations))
    login(client)
    interview = client.post('/api/interviews', json={
        'role': 'QA Engineer', 'level': 'Middle', 'mode': 'Practice', 'questionCount': 5,
        'type': 'Behavioral', 'input': 'Text', 'language': 'English',
    }).json()
    for index in range(5):
        client.post(f"/api/interviews/{interview['id']}/messages", json={'text': f'answer {index}'})
    group = client.get('/api/dashboard/summary').json()['groups'][0]
    assert group['scores'] == {'accuracy': 8, 'completeness': 10, 'clarity': 6, 'structure': 8}
    assert group['overall'] == 8
    assert group['scoredCount'] == 1


def test_dashboard_summary_withholds_topics_seen_in_only_one_interview(client, monkeypatch):
    evaluations = iter([
        AnswerEvaluation(accuracy=7, completeness=7, clarity=7, structure=7,
            went_well='Clear response', missing='Include boundary cases', stronger_answer='Example.'),
        AnswerEvaluation(accuracy=7, completeness=7, clarity=7, structure=7,
            went_well='Clear response', missing='Explain test isolation', stronger_answer='Example.'),
        None, None, None,
        AnswerEvaluation(accuracy=7, completeness=7, clarity=7, structure=7,
            went_well='Clear response', missing='Describe deployment rollback', stronger_answer='Example.'),
        AnswerEvaluation(accuracy=7, completeness=7, clarity=7, structure=7,
            went_well='Clear response', missing='Explain test isolation', stronger_answer='Example.'),
        None, None, None,
    ])
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: next(evaluations))
    login(client)
    ids = []
    for _ in range(2):
        interview = client.post('/api/interviews', json={
            'role': 'QA Engineer', 'level': 'Junior', 'mode': 'Practice', 'questionCount': 5,
            'type': 'Behavioral', 'input': 'Text', 'language': 'English',
        }).json()
        ids.append(interview['id'])
        for index in range(5):
            assert client.post(f"/api/interviews/{interview['id']}/messages",
                               json={'text': f'answer {index}'}).status_code == 200

    suggestions = client.get('/api/dashboard/summary').json()['suggestions']
    assert len(suggestions) == 1
    assert suggestions[0]['topic'] == 'test isolation'
    assert {source['interviewId'] for source in suggestions[0]['sources']} == set(ids)


def test_dashboard_summary_refreshes_after_deletion(client, monkeypatch):
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: None)
    login(client)
    interview = client.post('/api/interviews', json={
        'role': 'QA Engineer', 'level': 'Junior', 'mode': 'Practice', 'questionCount': 5,
        'type': 'Behavioral', 'input': 'Text', 'language': 'English',
    }).json()
    for i in range(5):
        assert client.post(f"/api/interviews/{interview['id']}/messages", json={'text': f'answer {i}'}).status_code == 200
    assert client.get('/api/dashboard/summary').json()['completedCount'] == 1
    assert client.delete(f"/api/interviews/{interview['id']}").status_code == 204
    summary = client.get('/api/dashboard/summary').json()
    assert summary['completedCount'] == 0
    assert interview['id'] not in [item['id'] for item in summary['recentActivity']]
