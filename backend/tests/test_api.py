import asyncio
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
import yaml
from fastapi import Request, Response
from fastapi.testclient import TestClient
from jsonschema import Draft4Validator, RefResolver

from app.auth import establish_session, hasher, token_key
from app.main import create_app
from app.database import TokenRecord, UserRecord
from app.store import now

SETUP = dict(role='Backend Developer', level='Middle', mode='Practice', questionCount=5,
             type='Technical', input='Text', language='English')


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(database_url=f'sqlite:///{tmp_path / "test.db"}')) as client:
        yield client


def login(client):
    response = client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'demo-password'})
    assert response.status_code == 200
    return response


def start(client, **overrides):
    response = client.post('/api/interviews', json=SETUP | overrides)
    assert response.status_code == 201
    return response.json()


def test_authentication_and_seed(client):
    assert client.get('/api/interviews').status_code == 401
    assert client.post('/api/auth/login', json={'email': 'demo@example.com', 'password': 'wrong'}).status_code == 401
    response = login(client)
    assert set(response.json()) == {'id', 'name', 'email', 'targetRole', 'level', 'preferredLanguage'}
    assert 'HttpOnly' in response.headers['set-cookie']
    assert 'Path=/api' in response.headers['set-cookie']
    token = response.headers['authorization'].split()[1]
    store = client.app.state.store
    with store.sessions() as session:
        assert session.get(TokenRecord, token) is None
        assert session.get(TokenRecord, token_key(token)) is not None
        password_hash = session.get(UserRecord, 'demo-user').password_hash
        assert hasher.verify('demo-password', password_hash)
        assert password_hash != 'demo-password'
    history = client.get('/api/interviews').json()['items']
    assert len(history) == 2
    assert history[0]['startedAt'] > history[1]['startedAt']
    assert client.get('/api/interviews', headers={'Authorization': 'Bearer invalid'}).status_code == 401
    client.cookies.clear()
    assert client.get('/api/interviews', headers={'Authorization': f'Bearer {token}'}).status_code == 200
    with store.sessions.begin() as session:
        session.get(TokenRecord, token_key(token)).expires_at = (now() - timedelta(seconds=1)).timestamp()
    assert client.get('/api/interviews', headers={'Authorization': f'Bearer {token}'}).status_code == 401


def test_register_and_ownership(client):
    login(client)
    ident = start(client)['id']
    response = client.post('/api/auth/register', json={'name': ' New User ', 'email': 'NEW@example.com', 'password': 'secret'})
    assert response.status_code == 201
    assert response.json()['targetRole'] == 'Frontend Developer'
    assert response.json()['name'] == 'New User'
    assert client.get('/api/interviews').json()['items'] == []
    for suffix in ['', '/report']:
        assert client.get(f'/api/interviews/{ident}{suffix}').status_code == 404
    for suffix, body in [('/messages', {'text': 'answer'}), ('/hint', None), ('/end', None), ('/resume', None)]:
        assert client.post(f'/api/interviews/{ident}{suffix}', json=body).status_code == 404
    assert client.post('/api/auth/register', json={'name': 'Other', 'email': 'new@example.com', 'password': 'x'}).status_code == 409
    assert client.post('/api/auth/login', json={'email': 'new@example.com', 'password': 'secret'}).status_code == 200


@pytest.mark.parametrize('mode', ['Practice', 'Real Interview'])
def test_complete_lifecycle(client, mode, monkeypatch):
    from app.services import ai_service
    from app.models import AnswerEvaluation
    evaluation = AnswerEvaluation(accuracy=8, completeness=7, clarity=9, structure=6,
        went_well='Clear example.', missing='Discuss trade-offs.', stronger_answer='Explain the result and trade-offs.')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: evaluation)
    login(client)
    interview = start(client, mode=mode)
    path = '/api/interviews/' + interview['id']
    assert interview['answeredCount'] == 0
    assert interview['endedAt'] is None and interview['lastFeedback'] is None
    assert len(interview['messages']) == 1
    assert client.get(path).json() == interview
    assert client.get(path + '/report').status_code == 409
    assert client.post(path + '/hint').status_code == (200 if mode == 'Practice' else 409)
    for index in range(5):
        response = client.post(path + '/messages', json={'text': '  A concrete example  '})
        assert response.status_code == 200
        interview = response.json()
        assert interview['answeredCount'] == index + 1
        assert (interview['lastFeedback'] is None) == (mode == 'Real Interview')
        assert (interview['lastAnswerFeedback'] is None) == (mode == 'Real Interview')
        if mode == 'Real Interview':
            assert 'Clear example.' not in response.text
    assert interview['status'] == 'complete' and interview['endedAt']
    assert len([m for m in interview['messages'] if m['from'] == 'ai']) == 5
    assert client.post(path + '/messages', json={'text': 'extra'}).status_code == 409
    assert client.post(path + '/hint').status_code == 409
    assert client.post(path + '/end').json() == interview
    report = client.get(path + '/report').json()
    assert len(report['feedback']['questions']) == 5
    assert report['feedback']['questions'][0]['answer'] == '  A concrete example  '
    first_question = next(message for message in interview['messages'] if message['from'] == 'ai')
    first_answer = next(message for message in interview['messages'] if message['from'] == 'you')
    assert report['feedback']['questions'][0]['questionId'] == first_question['id']
    assert report['feedback']['questions'][0]['answerId'] == first_answer['id']
    assert report['feedback']['scores'] is not None
    assert interview in client.get('/api/interviews').json()['items']


def test_empty_report_and_early_end(client):
    login(client)
    interview = start(client)
    path = '/api/interviews/' + interview['id']
    assert interview not in client.get('/api/interviews').json()['items']
    ended = client.post(path + '/end').json()
    assert ended['status'] == 'incomplete'
    assert client.post(path + '/end').json() == ended
    feedback = client.get(path + '/report').json()['feedback']
    assert feedback == dict(interviewId=interview['id'], answeredQuestions=0, selectedQuestions=5,
        overall=None, scores=None, strengths=[], gaps=[], questions=[])


def test_early_end_preserves_saved_evaluation_and_rejects_more_answers(client, monkeypatch):
    from app.models import AnswerEvaluation
    from app.services import ai_service
    evaluation = AnswerEvaluation(accuracy=8, completeness=7, clarity=9, structure=6,
        went_well='Clear example', missing='Add measurable impact',
        stronger_answer='I improved latency by 30 percent.')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: evaluation)
    login(client)
    path = '/api/interviews/' + start(client)['id']
    before_end = client.post(path + '/messages', json={'text': 'A saved answer'}).json()
    ended = client.post(path + '/end').json()
    assert ended['status'] == 'incomplete' and ended['endedAt']
    assert ended['messages'] == before_end['messages']
    assert client.post(path + '/messages', json={'text': 'Too late'}).status_code == 409
    feedback = client.get(path + '/report').json()['feedback']
    assert feedback['questions'][0]['answer'] == 'A saved answer'
    assert feedback['questions'][0]['scores'] == evaluation.category_scores().model_dump()
    assert feedback['strengths'] == ['Clear example']
    assert feedback['gaps'] == ['Add measurable impact']


@pytest.mark.parametrize('body', [{}, SETUP | {'questionCount': 3}, SETUP | {'questionCount': True},
                                 SETUP | {'mode': 'invalid'}, SETUP | {'jobDescription': None}])
def test_invalid_setup(client, body):
    login(client)
    response = client.post('/api/interviews', json=body)
    assert response.status_code == 400
    assert set(response.json()) == {'message'}


@pytest.mark.parametrize(('field', 'value'), [
    ('role', 'Product Manager'), ('level', 'Expert'), ('mode', 'Interview'),
    ('questionCount', 7), ('type', 'Culture fit'), ('input', 'Video'), ('language', 'Russian'),
])
def test_setup_rejects_every_unsupported_enum_and_question_count(client, field, value):
    login(client)
    response = client.post('/api/interviews', json=SETUP | {field: value})
    assert response.status_code == 400
    assert set(response.json()) == {'message'}


def test_validation_and_missing(client):
    login(client)
    path = '/api/interviews/' + start(client)['id']
    for text in ['', '   ', '\n\t']:
        assert client.post(path + '/messages', json={'text': text}).status_code == 400
    assert client.get(path).json()['answeredCount'] == 0
    assert client.get('/api/interviews/missing').status_code == 404
    assert client.post('/api/interviews', content='{', headers={'Content-Type': 'application/json'}).status_code == 400
    for body in [{'name': ' ', 'email': 'a@example.com', 'password': 'x'},
                 {'name': 'A', 'email': 'invalid', 'password': 'secret'},
                 {'name': 'A', 'email': 'a@example.com', 'password': ''}]:
        response = client.post('/api/auth/register', json=body)
        assert response.status_code == 400 and 'secret' not in response.text


def test_responses_match_contract(client):
    spec = yaml.safe_load((Path(__file__).resolve().parents[2] / 'openapi.yaml').read_text())
    # OpenAPI 3.0 nullable is not a JSON Schema keyword: convert it for validation.
    def convert(node):
        if isinstance(node, list):
            return [convert(item) for item in node]
        if not isinstance(node, dict):
            return node
        result = {key: convert(value) for key, value in node.items() if key != 'nullable'}
        return {'anyOf': [result, {'type': 'null'}]} if node.get('nullable') else result
    spec = convert(spec)
    def validate(name, data):
        Draft4Validator(spec['components']['schemas'][name], resolver=RefResolver.from_schema(spec)).validate(data)
    validate('User', login(client).json())
    interview = start(client)
    validate('Interview', interview)
    client.post('/api/interviews/' + interview['id'] + '/end')
    validate('InterviewReport', client.get('/api/interviews/' + interview['id'] + '/report').json())
    for saved in client.get('/api/interviews').json()['items']:
        validate('Interview', saved)
        validate('InterviewReport', client.get('/api/interviews/' + saved['id'] + '/report').json())


def test_secure_cookie_and_cors():
    app = create_app(seed=False, secure_cookies=True, database_url='sqlite:///:memory:')

    class TokenStore:
        def add_token(self, digest, user_id, expires_at):
            pass

    response = Response()
    establish_session(Request({'type': 'http', 'app': app}), response, 'test-user', TokenStore())
    assert 'Secure' in response.headers['set-cookie']

    async def assert_cors_preflights():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
            for origin in ['http://localhost:5173', 'http://localhost:8080', 'http://127.0.0.1:8080']:
                response = await client.options('/api/interviews', headers={'Origin': origin,
                    'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'X-Custom-Header'})
                assert response.status_code == 200
                assert response.headers['access-control-allow-origin'] == origin
                assert response.headers['access-control-allow-credentials'] == 'true'
                assert 'PUT' in response.headers['access-control-allow-methods']
                assert response.headers['access-control-allow-headers'] == 'X-Custom-Header'

    asyncio.run(assert_cors_preflights())


def test_create_returns_created_interview(client):
    login(client)
    response = client.post('/api/interviews', json=SETUP, headers={'Origin': 'http://localhost:8080'})
    assert response.status_code == 201
    created = response.json()
    assert isinstance(created['id'], str) and created['id'].strip()
    assert all(created['setup'][key] == value for key, value in SETUP.items())
    assert created['status'] == 'active'
    assert created['messages'][0]['interviewId'] == created['id']
    assert response.headers['access-control-allow-origin'] == 'http://localhost:8080'
    assert client.get('/api/interviews/' + created['id']).json() == created


def test_persistence_and_shared_database(tmp_path, monkeypatch):
    url = f'sqlite:///{tmp_path / "persistent.db"}'
    monkeypatch.setenv('DATABASE_URL', url)
    with TestClient(create_app(seed=False)) as first:
        registered = first.post('/api/auth/register', json={
            'name': 'Persistent', 'email': 'persistent@example.com', 'password': 'secret'})
        assert registered.status_code == 201
        headers = {'Authorization': registered.headers['authorization']}
        interview = start(first)
        path = '/api/interviews/' + interview['id']
        first.post(path + '/hint')
        first.post(path + '/messages', json={'text': 'Stored answer'})
        with TestClient(create_app(seed=False)) as second:
            saved = second.get(path, headers=headers).json()
            assert saved['answeredCount'] == 1
            assert any(m['from'] == 'hint' for m in saved['messages'])
            ended = second.post(path + '/end', headers=headers).json()
            assert first.get(path).json() == ended
    with TestClient(create_app(seed=False)) as restarted:
        assert restarted.get(path, headers=headers).json() == ended
        assert restarted.get('/api/interviews', headers=headers).json()['items'] == [ended]
        report = restarted.get(path + '/report', headers=headers).json()
        assert report['feedback']['questions'][0]['answer'] == 'Stored answer'
        assert restarted.post('/api/auth/login', json={
            'email': 'persistent@example.com', 'password': 'secret'}).status_code == 200


def test_seed_is_idempotent(tmp_path):
    url = f'sqlite:///{tmp_path / "seed.db"}'
    with TestClient(create_app(database_url=url)) as first:
        login(first)
        history = first.get('/api/interviews').json()['items']
    with TestClient(create_app(database_url=url)) as second:
        login(second)
        assert second.get('/api/interviews').json()['items'] == history


def test_transaction_rollback_and_concurrent_updates(tmp_path):
    from fastapi import HTTPException
    from app.store import Store
    from app.models import InterviewSetup

    store = Store(database_url=f'sqlite:///{tmp_path / "transactions.db"}')
    with store.transaction() as repository:
        interview = repository.start('demo-user', InterviewSetup(**SETUP))
    with pytest.raises(RuntimeError):
        with store.transaction() as repository:
            repository.answer(repository.find('demo-user', interview.id), 'Rolled back')
            raise RuntimeError('abort')
    with store.transaction() as repository:
        assert repository.find('demo-user', interview.id).answeredCount == 0
    with pytest.raises(HTTPException) as error:
        with store.transaction() as stale:
            old = stale.find('demo-user', interview.id)
            with store.transaction() as current:
                current.answer(current.find('demo-user', interview.id), 'Committed')
            stale.answer(old, 'Stale update')
    assert error.value.status_code == 409
    from app.database import AnswerEvaluationRecord
    from sqlalchemy import select
    with store.transaction() as repository:
        assert repository.find('demo-user', interview.id).answeredCount == 1
        rows = list(repository.session.scalars(select(AnswerEvaluationRecord).where(
            AnswerEvaluationRecord.interview_id == interview.id)))
        assert len(rows) == 1
    store.engine.dispose()


@pytest.mark.parametrize('question_count', [5, 10, 15])
def test_one_followup_per_main_preserves_question_limit_and_reloads(client, monkeypatch, question_count):
    from app.services import ai_service
    generated = []
    followups = []
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: None)
    monkeypatch.setattr(ai_service, 'generate_question', lambda role, level, previous, **context:
        generated.append((level, context['interview_type'])) or f'Main {len(generated)} ({level})?')
    monkeypatch.setattr(ai_service, 'generate_followup', lambda role, level, interview_type, question, answer:
        followups.append((level, interview_type, question, answer)) or f'Clarify answer {len(followups)}?')
    token = login(client).headers['authorization']
    interview = start(client, questionCount=question_count, type='Behavioral')
    path = '/api/interviews/' + interview['id']
    assert interview['messages'][0]['kind'] == 'main'
    for index in range(question_count):
        current = client.get(path).json()
        main_question = next(m for m in reversed(current['messages']) if m['from'] == 'ai')
        assert main_question['kind'] == 'main'
        response = client.post(path + '/messages', json={'text': f'Main answer {index + 1}'}).json()
        assert response['answeredCount'] == index + 1
        followup = response['messages'][-1]
        assert followup['kind'] == 'follow-up'
        assert followup['mainQuestionId'] == main_question['id']
        assert response['status'] == 'active'
        assert client.get(path).json() == response
        if index == 0:
            url = str(client.app.state.store.engine.url)
            with TestClient(create_app(database_url=url)) as restarted:
                assert restarted.get(path, headers={'Authorization': token}).json() == response
        after_followup = client.post(path + '/messages', json={'text': f'Clarification {index + 1}'}).json()
        assert after_followup['answeredCount'] == index + 1
        assert len(after_followup['difficultyDecisions']) == index + 1
        assert after_followup['messages'][-2]['kind'] == 'follow-up'
        assert after_followup['messages'][-1]['kind'] == ('main' if index + 1 < question_count else 'follow-up')
        if index + 1 == question_count:
            assert after_followup['status'] == 'complete'
            assert after_followup['endedAt']
        else:
            assert after_followup['status'] == 'active'
    assert len(followups) == question_count
    assert all(item[1] == 'Behavioral' for item in followups)
    assert len(generated) == question_count
    report = client.get(path + '/report').json()['feedback']
    assert report['answeredQuestions'] == question_count
    assert len(report['questions']) == question_count * 2


def test_failed_followup_provider_skips_to_next_main_question_and_early_end_keeps_exchange(client, monkeypatch):
    from app.services import ai_service
    monkeypatch.setattr(ai_service, 'generate_question', lambda *args, **kwargs: None)
    monkeypatch.setattr(ai_service, 'generate_followup', lambda *args, **kwargs: None)
    login(client)
    path = '/api/interviews/' + start(client)['id']
    first = client.post(path + '/messages', json={'text': 'Answer without follow-up'}).json()
    assert first['answeredCount'] == 1
    assert first['messages'][-1]['kind'] == 'main'
    ended = client.post(path + '/end').json()
    assert ended['status'] == 'incomplete'
    report = client.get(path + '/report').json()['feedback']
    assert report['answeredQuestions'] == 1
    assert report['questions'][0]['answer'] == 'Answer without follow-up'


def test_dynamic_questions_and_final_answer(client, monkeypatch):
    from app.services import ai_service
    calls = []
    def generate(role, level, previous_messages, **context):
        calls.append((role, level, list(previous_messages), context))
        return f'Dynamic question {len(calls)}?'
    monkeypatch.setattr(ai_service, 'generate_question', generate)
    login(client)
    interview = start(client, type='Behavioral', jobDescription='Team leadership')
    path = '/api/interviews/' + interview['id']
    assert interview['messages'][0]['text'] == 'Dynamic question 1?'
    assert calls[0] == ('Backend Developer', 'Middle', [],
                        {'interview_type': 'Behavioral', 'job_description': 'Team leadership',
                         'practice_topic': None})
    for index in range(5):
        result = client.post(path + '/messages', json={'text': f' Answer {index} '})
        assert result.status_code == 200
        if index < 4:
            assert result.json()['messages'][-1]['text'] == f'Dynamic question {index + 2}?'
            assert calls[-1][2][-1].text == f'Answer {index}'
            assert calls[-1][2][-1].sender == 'you'
            assert calls[-1][3]['used_questions'] == [
                f'Dynamic question {number}?' for number in range(1, index + 2)]
    assert len(calls) == 5
    assert result.json()['status'] == 'complete'
    assert client.post(path + '/messages', json={'text': 'extra'}).status_code == 409
    assert len(calls) == 5
    assert client.get(path).json() == result.json()


def test_expected_question_id_makes_retries_idempotent_and_stale_answers_conflict(client, monkeypatch):
    from app.services import ai_service
    calls = {'evaluate': 0, 'generate': 0}
    def evaluate(*args, **kwargs):
        calls['evaluate'] += 1
        return None
    def generate(*args, **kwargs):
        calls['generate'] += 1
        return f'Question {calls["generate"]}?'
    monkeypatch.setattr(ai_service, 'evaluate_answer', evaluate)
    monkeypatch.setattr(ai_service, 'generate_followup', lambda *args, **kwargs: None)
    monkeypatch.setattr(ai_service, 'generate_question', generate)
    login(client)
    interview = start(client)
    path = '/api/interviews/' + interview['id']
    first_question_id = interview['messages'][-1]['id']
    payload = {'text': 'Accepted answer', 'expectedQuestionId': first_question_id}
    accepted = client.post(path + '/messages', json=payload)
    assert accepted.status_code == 200
    accepted_state = accepted.json()
    assert accepted_state['answeredCount'] == 1
    assert [message['from'] for message in accepted_state['messages'][-2:]] == ['you', 'ai']

    retry = client.post(path + '/messages', json=payload)
    assert retry.status_code == 200
    assert retry.json() == accepted_state
    assert calls == {'evaluate': 1, 'generate': 2}

    stale = client.post(path + '/messages', json={
        'text': 'Competing stale answer', 'expectedQuestionId': first_question_id})
    assert stale.status_code == 409
    assert client.get(path).json() == accepted_state

    next_question_id = accepted_state['messages'][-1]['id']
    next_answer = client.post(path + '/messages', json={
        'text': 'Answer to pending question', 'expectedQuestionId': next_question_id})
    assert next_answer.status_code == 200
    assert next_answer.json()['answeredCount'] == 2


def test_question_fallback_during_api_outage(client, monkeypatch):
    import httpx
    from app.services import ai_service
    from app.models import InterviewSetup
    from app.store import question
    monkeypatch.setenv('AI_API_KEY', 'test-secret')
    def unavailable(*args, **kwargs):
        raise httpx.ConnectError('unavailable')
    client_class = httpx.Client
    monkeypatch.setattr(ai_service.httpx, 'Client', lambda **kwargs: client_class(
        transport=httpx.MockTransport(unavailable), **kwargs))
    login(client)
    interview = start(client, type='Behavioral')
    setup = InterviewSetup(**(SETUP | {'type': 'Behavioral'}))
    assert interview['messages'][0]['text'] == question(setup, 0)
    response = client.post('/api/interviews/' + interview['id'] + '/messages', json={'text': 'Answer'})
    assert response.status_code == 200
    assert response.json()['messages'][-1]['text'] == question(setup, 1)


@pytest.mark.parametrize('mode', ['Practice', 'Real Interview'])
def test_ai_feedback_persisted_and_report_averaged(tmp_path, monkeypatch, mode):
    from app.services import ai_service
    from app.models import AnswerEvaluation
    from app.database import AnswerEvaluationRecord
    from sqlalchemy import select
    values = [AnswerEvaluation(accuracy=2, completeness=4, clarity=6, structure=8,
                  went_well='First strength', missing='First gap', stronger_answer='First improved answer'),
              AnswerEvaluation(accuracy=8, completeness=10, clarity=8, structure=10,
                  went_well='Second strength', missing='Second gap', stronger_answer='Second improved answer')]
    calls = []
    def evaluate(question, answer, **context):
        calls.append((question, answer))
        return values[len(calls) - 1]
    monkeypatch.setattr(ai_service, 'evaluate_answer', evaluate)
    url = f'sqlite:///{tmp_path / "feedback.db"}'
    with TestClient(create_app(database_url=url)) as client:
        token = login(client).headers['authorization']
        interview = start(client, mode=mode)
        path = '/api/interviews/' + interview['id']
        for index, evaluation in enumerate(values):
            question = interview['messages'][-1]['text']
            interview = client.post(path + '/messages', json={'text': f' Answer {index} '}).json()
            assert calls[-1] == (question, f' Answer {index} ')
            assert interview['lastFeedback'] == (evaluation.category_scores().model_dump() if mode == 'Practice' else None)
            assert interview['lastAnswerFeedback'] == (evaluation.model_dump() if mode == 'Practice' else None)
            assert 'evaluations' not in interview
        with client.app.state.store.sessions() as session:
            records = list(session.scalars(select(AnswerEvaluationRecord).where(
                AnswerEvaluationRecord.interview_id == interview['id'])))
            assert len(records) == 2
            assert {r.result['went_well'] for r in records} == {'First strength', 'Second strength'}
            assert all(r.answer_id and r.question_id for r in records)
        client.post(path + '/end')
        report = client.get(path + '/report').json()['feedback']
        assert report['scores'] == dict(accuracy=5, completeness=7, clarity=7, structure=9)
        assert report['overall'] == 7
        assert [q['score'] for q in report['questions']] == [5, 9]
        assert report['questions'][0]['good'] == 'First strength'
        assert report['questions'][1]['better'] == 'Second improved answer'
        assert report['strengths'] == ['First strength', 'Second strength']
        assert report['gaps'] == ['First gap', 'Second gap']
    with TestClient(create_app(database_url=url)) as restarted:
        assert restarted.get(path + '/report', headers={'Authorization': token}).json()['feedback'] == report
    assert len(calls) == 2


def test_unavailable_evaluation_saves_unscored_answer(client, monkeypatch):
    from app.services import ai_service
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: None)
    login(client)
    interview = start(client)
    path = '/api/interviews/' + interview['id']
    response = client.post(path + '/messages', json={'text': 'My unscored answer'})
    assert response.status_code == 200
    assert response.json()['effectiveLevel'] == 'Middle'
    assert response.json()['difficultyDecisions'][0]['average'] is None
    assert 'No reliable evaluation' in response.json()['difficultyDecisions'][0]['reason']
    assert response.json()['lastFeedback'] is None
    client.post(path + '/end')
    report = client.get(path + '/report').json()['feedback']
    assert report['overall'] is None and report['scores'] is None
    assert report['questions'][0]['score'] is None
    assert report['questions'][0]['answer'] == 'My unscored answer'
    assert 'unavailable' in report['questions'][0]['good']


def test_difficulty_transition_persists_and_drives_ai_and_curated_next_question(tmp_path, monkeypatch):
    from app.models import AnswerEvaluation
    from app.services import ai_service
    url = f'sqlite:///{tmp_path / "difficulty.db"}'
    levels = []
    evaluation = AnswerEvaluation(accuracy=8, completeness=8, clarity=8, structure=8,
        went_well='Strong answer', missing='None', stronger_answer='Well-supported answer.')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: evaluation)
    monkeypatch.setattr(ai_service, 'generate_question', lambda role, level, *args, **kwargs:
        levels.append(level) or None)
    with TestClient(create_app(database_url=url)) as client:
        token = login(client).headers['authorization']
        interview = start(client, role='Backend Developer', level='Middle')
        path = '/api/interviews/' + interview['id']
        assert interview['effectiveLevel'] == 'Middle'
        updated = client.post(path + '/messages', json={'text': 'A strong answer'}).json()
        assert levels == ['Middle', 'Senior']
        assert updated['setup']['level'] == 'Middle'
        assert updated['effectiveLevel'] == 'Senior'
        assert updated['messages'][-1]['text'].startswith('Question 2 (Senior)')
        decision = updated['difficultyDecisions'][0]
        assert decision['questionId'] == interview['messages'][0]['id']
        assert decision['answerId'] == next(m['id'] for m in updated['messages'] if m['from'] == 'you')
        assert decision['average'] == 8
        assert 'increased from Middle to Senior' in decision['reason']
        assert client.get('/api/auth/me').json()['level'] == 'Middle'
    with TestClient(create_app(database_url=url)) as restarted:
        saved = restarted.get(path, headers={'Authorization': token}).json()
        assert saved['effectiveLevel'] == 'Senior'
        assert saved['difficultyDecisions'] == updated['difficultyDecisions']


def test_followup_for_an_already_adjusted_main_question_keeps_level(tmp_path):
    from app.models import AnswerEvaluation, InterviewSetup
    from app.store import Store, message
    store = Store(database_url=f'sqlite:///{tmp_path / "followup-difficulty.db"}')
    evaluation = AnswerEvaluation(accuracy=9, completeness=9, clarity=9, structure=9,
        went_well='Strong', missing='None', stronger_answer='Example.')
    with store.transaction() as repository:
        interview = repository.start('demo-user', InterviewSetup(**SETUP))
        main_id = interview.messages[0].id
        repository.answer(interview, 'Main answer', next_question='Next main question?', evaluation=evaluation)
        assert interview.effectiveLevel == 'Senior'
        followup = message(interview.id, 'ai', 'Follow-up question?', kind='follow-up',
            main_question_id=main_id)
        interview.messages.append(followup)
        repository.save(interview)
        repository.answer(interview, 'Follow-up answer', evaluation=evaluation)
        assert interview.effectiveLevel == 'Senior'
        assert len(interview.difficultyDecisions) == 1
    store.engine.dispose()


def test_report_averages_only_successful_evaluations(client, monkeypatch):
    from app.services import ai_service
    from app.models import AnswerEvaluation
    results = iter([AnswerEvaluation(accuracy=8, completeness=6, clarity=10, structure=4,
        went_well='Clear explanation', missing='Add examples', stronger_answer='Use a concrete example'), None])
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: next(results))
    login(client)
    path = '/api/interviews/' + start(client)['id']
    client.post(path + '/messages', json={'text': 'Scored answer'})
    client.post(path + '/messages', json={'text': 'Unscored answer'})
    client.post(path + '/end')
    feedback = client.get(path + '/report').json()['feedback']
    assert feedback['overall'] == 7
    assert feedback['scores'] == dict(accuracy=8, completeness=6, clarity=10, structure=4)
    assert [q['score'] for q in feedback['questions']] == [7, None]
    assert feedback['strengths'] == ['Clear explanation']


def test_report_averages_each_nullable_category_independently(client, monkeypatch):
    from app.models import AnswerEvaluation
    from app.services import ai_service
    evaluations = iter([
        AnswerEvaluation(accuracy=8, completeness=None, clarity=6, structure=None,
            went_well='Strong reasoning', missing='State assumptions', stronger_answer='Example one.'),
        AnswerEvaluation(accuracy=None, completeness=10, clarity=None, structure=8,
            went_well='Clear structure', missing='Discuss costs', stronger_answer='Example two.'),
    ])
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: next(evaluations))
    login(client)
    path = '/api/interviews/' + start(client)['id']
    client.post(path + '/messages', json={'text': 'First answer'})
    client.post(path + '/messages', json={'text': 'Second answer'})
    client.post(path + '/end')
    feedback = client.get(path + '/report').json()['feedback']
    assert feedback['scores'] == {'accuracy': 8, 'completeness': 10, 'clarity': 6, 'structure': 8}
    assert feedback['overall'] == 8
    assert [item['score'] for item in feedback['questions']] == [7, 9]
    assert feedback['questions'][0]['scores'] == {
        'accuracy': 8, 'completeness': None, 'clarity': 6, 'structure': None}


@pytest.mark.parametrize('mode', ['Practice', 'Real Interview'])
def test_resume_incomplete_interview_preserves_progress(client, mode):
    login(client)
    interview = start(client, mode=mode)
    path = '/api/interviews/' + interview['id']
    client.post(path + '/messages', json={'text': 'First saved answer'})
    ended = client.post(path + '/end').json()
    partial = client.get(path + '/report').json()['feedback']
    assert (partial['answeredQuestions'], partial['selectedQuestions']) == (1, 5)
    assert ended['status'] == 'incomplete'
    assert client.get(path).json() == ended  # Reading does not reopen the interview.
    response = client.post(path + '/resume')
    assert response.status_code == 200
    resumed = response.json()
    assert resumed == ended | {'status': 'active', 'endedAt': None}
    assert client.post(path + '/resume').json() == resumed
    assert client.get(path).json() == resumed
    assert all(item['id'] != interview['id'] for item in client.get('/api/interviews').json()['items'])
    assert client.get(path + '/report').status_code == 409
    assert client.post(path + '/hint').status_code == (200 if mode == 'Practice' else 409)
    for index in range(4):
        response = client.post(path + '/messages', json={'text': f'Resumed answer {index}'})
        assert response.status_code == 200
    completed = response.json()
    assert completed['status'] == 'complete'
    assert completed['answeredCount'] == 5
    assert len([m for m in completed['messages'] if m['from'] == 'ai']) == 5
    assert client.get(path + '/report').json()['feedback']['questions'][0] == partial['questions'][0]
    assert client.post(path + '/resume').status_code == 409
    assert client.get(path).json() == completed


def test_resume_requires_authentication_and_persists(tmp_path):
    url = f'sqlite:///{tmp_path / "resume.db"}'
    with TestClient(create_app(database_url=url)) as first:
        assert first.post('/api/interviews/missing/resume').status_code == 401
        token = login(first).headers['authorization']
        path = '/api/interviews/' + start(first)['id']
        assert first.post('/api/interviews/missing/resume').status_code == 404
        first.post(path + '/end')
        resumed = first.post(path + '/resume').json()
    with TestClient(create_app(database_url=url)) as restarted:
        assert restarted.get(path, headers={'Authorization': token}).json() == resumed
        assert restarted.post(path + '/messages', headers={'Authorization': token},
                              json={'text': 'Answer after restart'}).status_code == 200


@pytest.mark.parametrize('status', ['active', 'incomplete', 'complete'])
def test_delete_interview_removes_transcript_and_evaluations(client, status):
    from app.database import AnswerEvaluationRecord, InterviewRecord
    from sqlalchemy import select
    token = login(client).headers['authorization']
    interview = start(client)
    path = '/api/interviews/' + interview['id']
    for _ in range(5 if status == 'complete' else 1):
        assert client.post(path + '/messages', json={'text': 'An answer to delete'}).status_code == 200
    if status == 'incomplete':
        client.post(path + '/end')
    assert client.get(path).json()['status'] == status
    with client.app.state.store.sessions() as session:
        assert session.scalar(select(AnswerEvaluationRecord).where(
            AnswerEvaluationRecord.interview_id == interview['id'])) is not None
    response = client.delete(path)
    assert response.status_code == 204
    assert response.content == b''
    assert client.get(path).status_code == 404
    assert client.get(path + '/report').status_code == 404
    assert client.post(path + '/resume').status_code == 404
    assert client.post(path + '/messages', json={'text': 'Cannot answer deleted session'}).status_code == 404
    assert client.delete(path).status_code == 404
    assert all(item['id'] != interview['id'] for item in client.get('/api/interviews').json()['items'])
    with client.app.state.store.sessions() as session:
        assert session.get(InterviewRecord, interview['id']) is None
        assert session.scalar(select(AnswerEvaluationRecord).where(
            AnswerEvaluationRecord.interview_id == interview['id'])) is None
    # Other sessions and the authenticated user's credentials survive deletion.
    assert len(client.get('/api/interviews').json()['items']) == 2
    with TestClient(create_app(database_url=str(client.app.state.store.engine.url))) as restarted:
        assert restarted.get(path, headers={'Authorization': token}).status_code == 404
        assert len(restarted.get('/api/interviews', headers={'Authorization': token}).json()['items']) == 2


def test_delete_requires_authentication_and_ownership(client):
    from app.database import AnswerEvaluationRecord
    from sqlalchemy import select
    assert client.delete('/api/interviews/missing').status_code == 401
    token = login(client).headers['authorization']
    interview = start(client)
    path = '/api/interviews/' + interview['id']
    client.post(path + '/messages', json={'text': 'Private answer'})
    client.post('/api/auth/register', json={'name': 'Other', 'email': 'other@example.com', 'password': 'secret'})
    assert client.delete(path).status_code == 404
    assert client.delete('/api/interviews/missing').status_code == 404
    saved = client.get(path, headers={'Authorization': token})
    assert saved.status_code == 200 and saved.json()['answeredCount'] == 1
    with client.app.state.store.sessions() as session:
        assert session.scalar(select(AnswerEvaluationRecord).where(
            AnswerEvaluationRecord.interview_id == interview['id'])) is not None


def test_delete_rolls_back_interview_and_evaluations(client):
    from app.database import AnswerEvaluationRecord
    from sqlalchemy import select
    login(client)
    interview = start(client)
    path = '/api/interviews/' + interview['id']
    client.post(path + '/messages', json={'text': 'Keep this answer on rollback'})
    with pytest.raises(RuntimeError):
        with client.app.state.store.transaction() as repository:
            repository.delete('demo-user', interview['id'])
            repository.session.flush()
            raise RuntimeError('abort delete')
    assert client.get(path).json()['answeredCount'] == 1
    with client.app.state.store.sessions() as session:
        assert session.scalar(select(AnswerEvaluationRecord).where(
            AnswerEvaluationRecord.interview_id == interview['id'])) is not None


@pytest.mark.parametrize('role, language', [
    ('Java Developer', 'Java'), ('Python Developer', 'Python'), ('C++ Developer', 'C++'),
])
def test_new_developer_roles_register_start_and_persist(client, role, language):
    response = client.post('/api/auth/register', json={
        'name': 'Developer', 'email': 'developer@example.com', 'password': 'secret', 'targetRole': role,
    })
    assert response.status_code == 201
    assert response.json()['targetRole'] == role
    interview = start(client, role=role)
    assert interview['setup']['role'] == role
    assert f'Implement in {language}' in interview['messages'][0]['text']
    path = '/api/interviews/' + interview['id']
    response = client.post(path + '/messages', json={'text': 'I would use a hash map.'})
    assert response.status_code == 200
    assert f'Implement in {language}' in response.json()['messages'][-1]['text']
    assert client.get(path).json() == response.json()
    spec = yaml.safe_load((Path(__file__).resolve().parents[2] / 'openapi.yaml').read_text())
    assert role in spec['components']['schemas']['Role']['enum']


@pytest.mark.parametrize('role', ['Java Developer', 'Python Developer', 'C++ Developer',
                                 'Backend Developer', 'Full Stack Developer'])
def test_offline_coding_questions_do_not_mix_interview_types(role):
    from app.models import InterviewSetup
    from app.store import question
    for index in range(3):
        technical = question(InterviewSetup(**(SETUP | {'role': role})), index)
        assert 'Example:' in technical and 'Constraints:' in technical
        assert 'Implement in' in technical and 'time and space complexity' in technical
        assert 'Implement in' not in question(InterviewSetup(**(SETUP | {
            'role': role, 'type': 'Behavioral'})), index)


def test_profile_requires_authentication_and_persists(tmp_path):
    url = f'sqlite:///{tmp_path / "profile.db"}'
    values = {'name': '  Aigerim Murat  ', 'targetRole': 'Python Developer', 'level': 'Senior',
              'preferredLanguage': 'Kazakh'}
    with TestClient(create_app(database_url=url)) as client:
        assert client.get('/api/auth/me').status_code == 401
        assert client.patch('/api/auth/me', json=values).status_code == 401
        authenticated = login(client)
        original = authenticated.json()
        token = authenticated.headers['authorization']
        assert client.get('/api/auth/me').json() == original
        response = client.patch('/api/auth/me', json=values)
        assert response.status_code == 200
        expected = original | values | {'name': 'Aigerim Murat'}
        assert response.json() == expected
        assert response.headers['cache-control'] == 'no-store'
        client.cookies.clear()
        assert client.get('/api/auth/me', headers={'Authorization': token}).json() == expected
        assert client.patch('/api/auth/me', headers={'Authorization': token}, json={key: value for key, value in values.items()
                                                 if key != 'preferredLanguage'}).json() == expected
    with TestClient(create_app(database_url=url)) as restarted:
        assert restarted.get('/api/auth/me', headers={'Authorization': token}).json() == expected
        assert login(restarted).json() == expected


@pytest.mark.parametrize('data', [
    {}, {'name': '   ', 'targetRole': 'Backend Developer', 'level': 'Senior'},
    {'name': 'New', 'targetRole': 'Invalid', 'level': 'Senior'},
    {'name': 'New', 'targetRole': 'Java Developer', 'level': 'Invalid'},
    {'name': 'New', 'targetRole': 'Java Developer', 'level': 'Senior', 'id': 'another-user'},
    {'name': 'New', 'targetRole': 'Java Developer', 'level': 'Senior', 'email': 'different@example.com'},
    {'name': 'New', 'targetRole': 'Java Developer', 'level': 'Senior', 'preferredLanguage': '   '},
    {'name': 'New', 'targetRole': 'Java Developer', 'level': 'Senior', 'preferredLanguage': 'a' * 81},
    {'name': 'New', 'targetRole': 'Java Developer', 'level': 'Senior', 'preferredLanguage': None},
])
def test_profile_rejects_invalid_or_uneditable_fields(client, data):
    original = login(client).json()
    assert client.patch('/api/auth/me', json=data).status_code == 400
    assert client.get('/api/auth/me').json() == original


def test_profile_updates_only_authenticated_user(client):
    owner = login(client)
    token = owner.headers['authorization']
    other = client.post('/api/auth/register', json={
        'name': 'Other', 'email': 'other@example.com', 'password': 'secret'}).json()
    update = {'name': 'Updated Other', 'targetRole': 'C++ Developer', 'level': 'Junior'}
    response = client.patch('/api/auth/me', json=update)
    assert response.json() == other | update
    assert client.get('/api/auth/me', headers={'Authorization': token}).json() == owner.json()


@pytest.mark.parametrize('role', [
    'Frontend Developer', 'Backend Developer', 'Full Stack Developer', 'Java Developer',
    'Python Developer', 'C++ Developer', 'QA Engineer', 'Data Analyst', 'DevOps Engineer',
])
@pytest.mark.parametrize('level', ['Junior', 'Middle', 'Senior'])
def test_profile_supports_all_roles_and_levels(client, role, level):
    login(client)
    response = client.patch('/api/auth/me', json={
        'name': 'Candidate', 'targetRole': role, 'level': level, 'preferredLanguage': '  Russian  '})
    assert response.status_code == 200
    assert response.json()['preferredLanguage'] == 'Russian'
    assert response.json()['targetRole'] == role
    assert response.json()['level'] == level
    assert client.post('/api/interviews', json=SETUP | {'language': 'Russian'}).status_code == 400


def test_profile_update_does_not_change_past_interviews(client):
    login(client)
    history_before = client.get('/api/interviews').json()['items']
    assert history_before

    response = client.patch('/api/auth/me', json={
        'name': 'Updated Candidate', 'targetRole': 'Data Analyst', 'level': 'Junior',
        'preferredLanguage': 'Kazakh',
    })

    assert response.status_code == 200
    assert client.get('/api/interviews').json()['items'] == history_before


def test_logout_revokes_bearer_and_cookie_tokens_and_clears_cookie(client):
    first = login(client).headers['authorization']
    second = login(client).headers['authorization']  # Browser cookie now holds the second token.
    third = login(client).headers['authorization']
    # Explicitly hold the second token in the browser alongside the first bearer token.
    client.cookies.set('session', second.split()[1], path='/api')
    response = client.post('/api/auth/logout', headers={'Authorization': first})
    assert response.status_code == 204 and response.content == b''
    cookie = response.headers['set-cookie']
    assert 'Max-Age=0' in cookie and 'Path=/api' in cookie and 'HttpOnly' in cookie
    client.cookies.clear()
    assert client.get('/api/auth/me', headers={'Authorization': first}).status_code == 401
    assert client.get('/api/auth/me', headers={'Authorization': second}).status_code == 401
    # A different device's token remains valid.
    assert client.get('/api/auth/me', headers={'Authorization': third}).status_code == 200
    assert client.get('/api/interviews').status_code == 401
    assert client.post('/api/auth/logout').status_code == 204


def test_logout_with_only_cookie_removes_session(client):
    token = login(client).headers['authorization']
    assert client.post('/api/auth/logout').status_code == 204
    assert client.get('/api/auth/me').status_code == 401
    assert client.get('/api/auth/me', headers={'Authorization': token}).status_code == 401


def test_starting_interview_preserves_saved_profile(client):
    original = login(client).json()
    path = '/api/auth/me'
    invalid = client.post('/api/interviews', json=SETUP | {'level': 'Invalid'})
    assert invalid.status_code == 400
    assert client.get(path).json() == original
    interview = start(client, role='Java Developer', level='Senior')
    assert client.get(path).json() == original
    assert interview['setup']['role'] == 'Java Developer'
    assert interview['setup']['level'] == 'Senior'
    with TestClient(create_app(database_url=str(client.app.state.store.engine.url))) as restarted:
        assert login(restarted).json() == original


def test_starting_interview_preserves_all_users_profiles(client):
    owner = login(client)
    token = owner.headers['authorization']
    other = client.post('/api/auth/register', json={
        'name': 'Other', 'email': 'other@example.com', 'password': 'secret'}).json()
    start(client, role='C++ Developer', level='Junior')
    assert client.get('/api/auth/me').json() == other
    assert client.get('/api/auth/me', headers={'Authorization': token}).json() == owner.json()


def test_dynamic_hints_use_current_question_and_persist(client, monkeypatch):
    from app.services import ai_service
    calls = []
    def generate(question, previous_hints, **context):
        calls.append((question, previous_hints, context))
        return f'Hint {len(calls)}: use a hash map to look up the complement.'
    monkeypatch.setattr(ai_service, 'generate_hint', generate)
    token = login(client).headers['authorization']
    interview = start(client, role='Python Developer', level='Junior')
    path = '/api/interviews/' + interview['id']
    response = client.post(path + '/hint')
    assert response.status_code == 200
    first = response.json()['messages'][-1]
    assert first['from'] == 'hint' and first['text'].startswith('Hint 1: use a hash map')
    assert response.json()['answeredCount'] == 0
    assert response.json()['status'] == 'active'
    assert calls[0] == (interview['messages'][-1]['text'], [],
        {'role': 'Python Developer', 'level': 'Junior', 'interview_type': 'Technical'})
    second = client.post(path + '/hint').json()
    assert calls[1][1] == [first['text']]
    assert second['messages'][-1]['text'].startswith('Hint 2:')
    answered = client.post(path + '/messages', json={'text': 'Use a hash map.'}).json()
    final = client.post(path + '/hint').json()
    assert calls[2][0] == answered['messages'][-1]['text']
    assert calls[2][1] == []  # Earlier questions' hints are not reused for this problem.
    assert final['answeredCount'] == 1
    with TestClient(create_app(database_url=str(client.app.state.store.engine.url))) as restarted:
        assert restarted.get(path, headers={'Authorization': token}).json() == final


def test_hint_is_not_generated_for_disallowed_interviews(client, monkeypatch):
    from app.services import ai_service
    calls = []
    monkeypatch.setattr(ai_service, 'generate_hint', lambda *args, **kwargs: calls.append(args))
    assert client.post('/api/interviews/missing/hint').status_code == 401
    login(client)
    real = '/api/interviews/' + start(client, mode='Real Interview')['id']
    assert client.post(real + '/hint').status_code == 409
    practice = '/api/interviews/' + start(client)['id']
    client.post(practice + '/end')
    assert client.post(practice + '/hint').status_code == 409
    assert calls == []


def test_unavailable_hint_shows_notice_without_static_advice(client, monkeypatch):
    from app.services import ai_service
    monkeypatch.setattr(ai_service, 'generate_hint', lambda *args, **kwargs: None)
    login(client)
    path = '/api/interviews/' + start(client)['id']
    response = client.post(path + '/hint')
    assert response.status_code == 200
    assert 'temporarily unavailable' in response.json()['messages'][-1]['text']
    assert 'Use a concrete example' not in response.text


@pytest.mark.parametrize('role, language, code', [
    ('Python Developer', 'Python', '\ndef two_sum(nums, target):\n    return [0, 1]\n'),
    ('Java Developer', 'Java', 'class Solution {\n    int[] solve() { return new int[]{0, 1}; }\n}\n'),
    ('C++ Developer', 'C++', 'vector<int> solve() {\n    return {0, 1};\n}\n'),
])
def test_coding_submissions_are_reviewed_and_saved_without_losing_whitespace(client, monkeypatch, role, language, code):
    from app.services import ai_service
    from app.models import AnswerEvaluation
    calls = []
    def evaluate(question, answer, **context):
        calls.append((question, answer, context))
        return AnswerEvaluation(accuracy=7, completeness=6, clarity=9, structure=8,
            went_well='Readable implementation.', missing='Handle other inputs.',
            stronger_answer='Review input constraints and compute the result rather than hardcoding it.')
    monkeypatch.setattr(ai_service, 'evaluate_answer', evaluate)
    token = login(client).headers['authorization']
    interview = start(client, role=role)
    path = '/api/interviews/' + interview['id']
    response = client.post(path + '/messages', json={'text': code})
    assert response.status_code == 200
    assert calls == [(interview['messages'][-1]['text'], code, {'language': language})]
    assert [m['text'] for m in response.json()['messages'] if m['from'] == 'you'] == [code]
    client.post(path + '/end')
    report = client.get(path + '/report').json()['feedback']
    assert report['questions'][0]['answer'] == code
    assert report['scores']['accuracy'] == 7
    with TestClient(create_app(database_url=str(client.app.state.store.engine.url))) as restarted:
        assert restarted.get(path + '/report', headers={'Authorization': token}).json()['feedback']['questions'][0]['answer'] == code


def test_unavailable_code_review_keeps_formatted_code_unscored(client, monkeypatch):
    from app.services import ai_service
    code = '\ndef solve(values):\n    return values[0]\n'
    calls = []
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda question, answer, **context:
        calls.append((answer, context)) or None)
    login(client)
    path = '/api/interviews/' + start(client, role='Python Developer')['id']
    client.post(path + '/messages', json={'text': code})
    client.post(path + '/end')
    feedback = client.get(path + '/report').json()['feedback']
    assert calls == [(code, {'language': 'Python'})]
    assert feedback['questions'][0]['answer'] == code
    assert feedback['questions'][0]['score'] is None
    assert feedback['scores'] is None and feedback['overall'] is None


@pytest.mark.parametrize('role, interview_type, selected, expected', [
    ('Backend Developer', 'Technical', None, 'Python'),
    ('Full Stack Developer', 'Technical', None, 'JavaScript'),
    ('Java Developer', 'Technical', 'Python', 'Python'),
    ('Backend Developer', 'Technical', 'TypeScript', 'TypeScript'),
    ('Full Stack Developer', 'Technical', 'JavaScript', 'JavaScript'),
    ('Python Developer', 'Behavioral', 'Java', None),
    ('C++ Developer', 'Role-specific', 'C++', None),
    ('Frontend Developer', 'Technical', 'JavaScript', None),
])
def test_selected_language_controls_only_technical_coding_evaluation(client, monkeypatch, role, interview_type, selected, expected):
    from app.services import ai_service
    calls = []
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda question, answer, **context: calls.append(context))
    login(client)
    interview = start(client, role=role, type=interview_type)
    payload = {'text': '  source code\n'}
    if selected:
        payload['selectedLanguage'] = selected
    response = client.post(f"/api/interviews/{interview['id']}/messages", json=payload)
    assert response.status_code == 200
    assert calls == ([{'language': expected}] if expected else [{}])
    submitted = next(m['text'] for m in response.json()['messages'] if m['from'] == 'you')
    assert submitted == (payload['text'] if expected else payload['text'].strip())


def test_selected_language_rejects_unsupported_values(client):
    login(client)
    interview = start(client, role='Backend Developer')
    response = client.post(f"/api/interviews/{interview['id']}/messages",
                           json={'text': 'code', 'selectedLanguage': 'Ruby'})
    assert response.status_code == 400
