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
    # One completed interview per mode cannot form repeated evidence across modes.
    assert summary['suggestions'] == []
    assert all(group['suggestions'] == [] for group in summary['groups'])
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


def test_learning_plan_evidence_is_scoped_to_role_type_mode_and_level(client):
    from datetime import datetime, timezone
    from app.database import AnswerEvaluationRecord, InterviewRecord
    from app.models import Interview, InterviewSetup, Message

    owner = login(client).json()['id']
    instant = datetime(2026, 10, 20, tzinfo=timezone.utc)

    def add(ident, topics, *, role='Backend Developer', kind='Technical', mode='Practice',
            level='Middle', status='complete', user=owner, scored=True):
        setup = InterviewSetup(role=role, type=kind, mode=mode, level=level, input='Text',
                               questionCount=5, language='English')
        messages = []
        for index, topic in enumerate(topics):
            messages.append(Message(id=f'{ident}-q{index}', interviewId=ident,
                **{'from': 'ai'}, text='A question', createdAt=instant))
            messages.append(Message(id=f'{ident}-a{index}', interviewId=ident,
                **{'from': 'you'}, text='An answer', createdAt=instant))
        interview = Interview(id=ident, setup=setup, status=status, startedAt=instant,
            answeredCount=len(topics), messages=messages, lastFeedback=None)
        with client.app.state.store.sessions.begin() as session:
            session.add(InterviewRecord(id=ident, owner_id=user, started_at=instant.timestamp(),
                status=status, version=1, payload=interview.model_dump(mode='json', by_alias=True)))
            session.flush()
            for index, topic in enumerate(topics):
                evaluation = AnswerEvaluation(accuracy=7 if scored else None, completeness=None,
                    clarity=None, structure=None, went_well='Clear reasoning',
                    missing=topic, practice_topic=topic, stronger_answer='A stronger example.')
                session.add(AnswerEvaluationRecord(answer_id=f'{ident}-a{index}', interview_id=ident,
                    question_id=f'{ident}-q{index}', result=evaluation.model_dump(mode='json')))

    # Four topics consume the account-wide top-three limit; another group's plan must still exist.
    add('backend-1', ['integration', 'dynamic import', 'hashing', 'testing'])
    add('backend-2', ['integration', 'dynamic import', 'hashing', 'testing'])
    add('backend-3', ['integration', 'dynamic import', 'hashing', 'testing'])
    add('data-single', ['integration', 'integration'], role='Data Analyst', kind='Behavioral')
    add('type-single', ['dynamic import'], kind='Behavioral')
    add('mode-single', ['integration'], mode='Real Interview')
    add('level-single', ['integration'], level='Senior')
    add('data-repeat-1', ['cohort analysis'], role='Data Analyst', kind='Behavioral', level='Junior')
    add('data-repeat-2', ['Cohort   analysis'], role='Data Analyst', kind='Behavioral', level='Junior')
    # Two interviews alone do not suffice when their topics differ.
    add('data-distinct-1', ['sampling'], role='Data Analyst', kind='Behavioral', level='Senior')
    add('data-distinct-2', ['cohorts'], role='Data Analyst', kind='Behavioral', level='Senior')
    add('partial', ['integration'], mode='Real Interview', status='incomplete')
    add('unscored', ['integration'], mode='Real Interview', scored=False)
    add('active', ['integration'], mode='Real Interview', status='active')
    other = client.post('/api/auth/register', json={
        'name': 'Other', 'email': 'other@example.com', 'password': 'secret'}).json()['id']
    add('foreign', ['integration'], mode='Real Interview', user=other)
    client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
    summary = client.get('/api/dashboard/summary').json()
    groups = {(g['role'], g['type'], g['mode'], g['level']): g for g in summary['groups']}
    backend = groups[('Backend Developer', 'Technical', 'Practice', 'Middle')]
    assert len(backend['suggestions']) == 3
    for suggestion in backend['suggestions']:
        assert {s['interviewId'] for s in suggestion['sources']} == {'backend-1', 'backend-2', 'backend-3'}
    data = groups[('Data Analyst', 'Behavioral', 'Practice', 'Junior')]
    assert [s['topic'] for s in data['suggestions']] == ['cohort analysis']
    assert {s['interviewId'] for s in data['suggestions'][0]['sources']} == {'data-repeat-1', 'data-repeat-2'}
    assert 'cohort analysis' not in [s['topic'] for s in summary['suggestions']]
    for key, group in groups.items():
        if key not in [('Backend Developer', 'Technical', 'Practice', 'Middle'),
                       ('Data Analyst', 'Behavioral', 'Practice', 'Junior')]:
            assert group['suggestions'] == [], key
    # Real-mode evidence can form a plan, but its Start practice action still starts Practice.
    add('real-second', ['integration'], mode='Real Interview')
    groups = client.get('/api/dashboard/summary').json()['groups']
    real = next(g for g in groups if g['role'] == 'Backend Developer' and g['mode'] == 'Real Interview')
    assert real['suggestions'][0]['setup']['mode'] == 'Practice'
    assert {s['interviewId'] for s in real['suggestions'][0]['sources']} == {'mode-single', 'real-second'}
