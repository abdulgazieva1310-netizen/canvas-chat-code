from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.database import AnswerEvaluationRecord, InterviewRecord
from app.main import create_app
from app.models import Interview, InterviewSetup


@pytest.fixture
def client(tmp_path):
    app = create_app(database_url=f'sqlite:///{tmp_path / "history.db"}', seed=False)
    with TestClient(app) as client:
        owner = client.post('/api/auth/register', json={'name': 'Owner', 'email': 'owner@example.com', 'password': 'secret'}).json()['id']
        other = client.post('/api/auth/register', json={'name': 'Other', 'email': 'other@example.com', 'password': 'secret'}).json()['id']
        client.post('/api/auth/login', json={'email': 'owner@example.com', 'password': 'secret'})
        rows = [('a', '19T00:00:00', 8, owner, 'complete'), ('b', '19T00:00:00', 8, owner, 'complete'),
                ('c', '19T23:59:59.999999', 6, owner, 'complete'), ('d', '20T00:00:00', None, owner, 'incomplete'),
                ('e', '18T23:59:59.999999', 9, owner, 'complete'),
                ('foreign', '19T12:00:00', 8, other, 'complete'), ('active', '19T12:00:00', None, owner, 'active')]
        with app.state.store.sessions.begin() as session:
            for ident, day, score, user, status in rows:
                instant = datetime.fromisoformat('2026-10-' + day).replace(tzinfo=timezone.utc)
                interview = Interview(id=ident, setup=InterviewSetup(role='QA Engineer', level='Middle', mode='Practice',
                    questionCount=5, type='Behavioral', input='Text', language='English',
                    jobDescription='Payments API' if ident in ['a', 'b', 'foreign'] else ''),
                    status=status, startedAt=instant, answeredCount=0, messages=[], lastFeedback=None)
                session.add(InterviewRecord(id=ident, owner_id=user, started_at=instant.timestamp(), status=status,
                    payload=interview.model_dump(mode='json', by_alias=True), version=1))
                session.flush()
                if score is not None:
                    session.add(AnswerEvaluationRecord(answer_id='answer-'+ident, interview_id=ident,
                        question_id='question-'+ident, result={'accuracy': score, 'clarity': score,
                        'completeness': None, 'structure': None}))
        yield client


def test_combined_filters_boundaries_ties_and_owner_total(client):
    query = dict(role='QA Engineer', type='Behavioral', startDate='2026-10-19', endDate='2026-10-19',
                 minScore=8, maxScore=8, search='pAyMeNtS aPi', pageSize=1)
    result = client.get('/api/interviews', params=query).json()
    assert result['total'] == 2 and result['pageSize'] == 1 and result['page'] == 1
    assert [item['id'] for item in result['items']] == ['a']
    result = client.get('/api/interviews', params=query | {'page': 2}).json()
    assert [item['id'] for item in result['items']] == ['b'] and result['total'] == 2
    assert client.get('/api/interviews', params=query | {'page': 3}).json()['items'] == []
    dates = client.get('/api/interviews', params={'startDate': '2026-10-19', 'endDate': '2026-10-19'}).json()
    assert [item['id'] for item in dates['items']] == ['c', 'a', 'b']
    assert client.get('/api/interviews', params={'search': 'qa engineer'}).json()['total'] == 5
    for search in ['%', '_', 'missing']:
        assert client.get('/api/interviews', params={'search': search}).json()['total'] == 0
    assert client.get('/api/interviews', params={'role': 'Data Analyst'}).json()['total'] == 0
    assert client.get('/api/interviews', params={'type': 'Technical'}).json()['total'] == 0


def test_transcript_search_returns_owner_scoped_message_matches_and_database_pages(client):
    with client.app.state.store.sessions.begin() as session:
        for ident, message_id, sender, text in [
            ('a', 'question-a', 'ai', 'Explain the café protocol for 50%_ready queues? ' + 'detail ' * 50),
            ('a', 'answer-a', 'you', 'We retry safely; café is a Unicode word.'),
            ('a', 'hint-a', 'hint', 'café hint is not a question or submitted answer'),
            ('b', 'question-b', 'ai', 'How does CAFÉ caching work?'),
            ('foreign', 'question-foreign', 'ai', 'Explain the café protocol for 50%_ready queues?'),
            ('active', 'question-active', 'ai', 'Explain the café protocol for 50%_ready queues?'),
        ]:
            record = session.get(InterviewRecord, ident)
            payload = dict(record.payload)
            messages = list(payload['messages'])
            messages.append({'id': message_id, 'interviewId': ident, 'from': sender, 'text': text,
                             'createdAt': '2026-10-19T00:00:00Z'})
            payload['messages'] = messages
            record.payload = payload

    statements = []
    def executed(conn, cursor, statement, parameters, context, many):
        statements.append(statement)
    event.listen(client.app.state.store.engine, 'before_cursor_execute', executed)
    try:
        result = client.get('/api/interviews', params={
            'searchMode': 'transcript', 'search': 'CAFÉ', 'pageSize': 1,
        }).json()
    finally:
        event.remove(client.app.state.store.engine, 'before_cursor_execute', executed)

    assert result['total'] == 2
    assert [item['id'] for item in result['items']] == ['a']
    assert [match['id'] for match in result['matches']['a']] == ['question-a', 'answer-a']
    assert len(result['matches']['a'][0]['snippet']) <= 240
    assert all(match['sender'] in ('ai', 'you') for match in result['matches']['a'])
    assert any('json_each' in sql.lower() and 'limit' in sql.lower() for sql in statements)
    assert client.get('/api/interviews', params={
        'searchMode': 'transcript', 'search': '50%_ready',
    }).json()['total'] == 1
    assert client.get('/api/interviews', params={
        'searchMode': 'transcript', 'search': 'CAFÉ', 'role': 'Data Analyst',
    }).json()['total'] == 0
    next_page = client.get('/api/interviews', params={
        'searchMode': 'transcript', 'search': 'CAFÉ', 'pageSize': 1, 'page': 2,
    }).json()
    assert [item['id'] for item in next_page['items']] == ['b']


@pytest.mark.parametrize('search', [None, '', 'x'])
def test_transcript_search_rejects_blank_and_one_character_queries(client, search):
    params = {'searchMode': 'transcript'}
    if search is not None:
        params['search'] = search
    response = client.get('/api/interviews', params=params)
    assert response.status_code == 400
    assert response.json()['message']


def test_unscored_defaults_database_pagination(client):
    statements = []
    def executed(conn, cursor, statement, parameters, context, many):
        statements.append(statement)
    event.listen(client.app.state.store.engine, 'before_cursor_execute', executed)
    try:
        page = client.get('/api/interviews').json()
    finally:
        event.remove(client.app.state.store.engine, 'before_cursor_execute', executed)
    assert page['total'] == 5 and page['pageSize'] == 20
    assert [item['id'] for item in page['items']] == ['d', 'c', 'a', 'b', 'e']
    assert any('LIMIT' in sql and 'OFFSET' in sql for sql in statements)
    assert any('count(' in sql.lower() for sql in statements)
    assert client.get('/api/interviews', params={'minScore': 1}).json()['total'] == 4
    assert client.get('/api/interviews', params={'maxScore': 10}).json()['total'] == 4
    assert client.get('/api/interviews', params={'pageSize': 100}).status_code == 200


@pytest.mark.parametrize('query', [dict(page=0), dict(page=-1), dict(page='1.5'), dict(pageSize=101),
    dict(pageSize=0), dict(minScore=0), dict(maxScore=11), dict(minScore=9, maxScore=2),
    dict(startDate='2026-10-20', endDate='2026-10-19'), dict(startDate='bad'), dict(role='Unknown'),
    dict(type='Unknown'), dict(minScore='NaN')])
def test_invalid_history_queries_fail_clearly(client, query):
    response = client.get('/api/interviews', params=query)
    assert response.status_code == 400
    assert response.json()['message']


def test_default_page_limits_large_history(client):
    with client.app.state.store.sessions.begin() as session:
        source = session.get(InterviewRecord, 'a')
        for index in range(25):
            ident = f'extra-{index:02}'
            session.add(InterviewRecord(id=ident, owner_id=source.owner_id,
                started_at=source.started_at, status=source.status, version=1,
                payload=source.payload | {'id': ident}))
    first = client.get('/api/interviews').json()
    second = client.get('/api/interviews', params={'page': 2}).json()
    assert first['total'] == second['total'] == 30
    assert len(first['items']) == 20 and len(second['items']) == 10
    assert not {i['id'] for i in first['items']} & {i['id'] for i in second['items']}
