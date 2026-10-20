from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import StudyPlanRecord
from app.main import create_app
from app.models import StudyPlanDraft, StudyPlanDraftItem, AnswerEvaluation
from app.services import ai_service


SETUP = {'role': 'QA Engineer', 'level': 'Junior', 'mode': 'Practice', 'questionCount': 5,
         'type': 'Behavioral', 'input': 'Text', 'language': 'English'}


def draft(evidence, _group):
    refs = [item['ref'] for item in evidence]
    return StudyPlanDraft(items=[
        StudyPlanDraftItem(topic='Test design', rationale='Reports show missed edge cases.',
                           action='Write boundary tests for a small form validator.', sourceRefs=[refs[0]]),
        StudyPlanDraftItem(topic='STAR structure', rationale='Reports show unclear result statements.',
                           action='Practice two answers with situation, task, action, result.', sourceRefs=[refs[-1]]),
    ])


def make_client(tmp_path, monkeypatch, *, scored=True):
    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **k: 'Describe a test you improved?')
    monkeypatch.setattr(ai_service, 'generate_followup', lambda *a, **k: None)
    evaluation = (AnswerEvaluation(accuracy=6, completeness=6, clarity=7, structure=6,
        went_well='You described your role.', missing='Explain boundary coverage and measurable results.',
        stronger_answer='I added boundary cases and measured the reduction in escaped defects.',
        practice_topic='Boundary testing') if scored else None)
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *a, **k: evaluation)
    return TestClient(create_app(seed=False, database_url=f'sqlite:///{tmp_path / "plans.db"}'))


def create_report(client, setup=SETUP):
    interview = client.post('/api/interviews', json=setup).json()
    path = f"/api/interviews/{interview['id']}"
    for index in range(setup['questionCount']):
        result = client.post(path + '/messages', json={'text': f'Answer {index} with an example and result.'})
        assert result.status_code == 200
    assert client.get(path).json()['status'] == 'complete'
    return interview['id']


def test_study_plan_generation_completion_regeneration_and_delete_are_private(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    with client:
        client.post('/api/auth/register', json={'name': 'Owner', 'email': 'plan-owner@example.com', 'password': 'secret'})
        first_id = create_report(client)
        second_id = create_report(client)
        generator = lambda evidence, group: draft(evidence, group)
        with patch('app.routers.study_plans.ai_service.generate_study_plan', side_effect=generator) as generate:
            response = client.post('/api/study-plans', json={'sourceInterviewIds': [first_id, second_id]})
        assert response.status_code == 201, response.text
        plan = response.json()
        assert plan['comparisonGroup'] == {'role': 'QA Engineer', 'type': 'Behavioral', 'mode': 'Practice',
                                           'level': 'Junior', 'language': 'English'}
        assert {source['interviewId'] for source in plan['sources']} == {first_id, second_id}
        assert len(plan['items']) == 2 and all(item['sources'] for item in plan['items'])
        assert generate.call_count == 1

        item = plan['items'][0]
        toggled = client.patch(f"/api/study-plans/{plan['id']}/items/{item['id']}", json={'completed': True})
        assert toggled.status_code == 200 and toggled.json()['items'][0]['completed'] is True
        assert client.get('/api/study-plans').json()['items'][0]['items'][0]['completed'] is True

        with patch('app.routers.study_plans.ai_service.generate_study_plan', side_effect=generator):
            regenerated = client.post(f"/api/study-plans/{plan['id']}/regenerate")
        assert regenerated.status_code == 200
        assert regenerated.json()['id'] == plan['id']
        assert all(not item['completed'] for item in regenerated.json()['items'])
        assert len(client.get('/api/study-plans').json()['items']) == 1
        assert client.get(f'/api/interviews/{first_id}/report').status_code == 200
        assert client.get(f'/api/interviews/{second_id}/report').status_code == 200

        client.post('/api/auth/register', json={'name': 'Other', 'email': 'plan-other@example.com', 'password': 'secret'})
        assert client.get('/api/study-plans').json()['items'] == []
        assert client.patch(f"/api/study-plans/{plan['id']}/items/{item['id']}",
                            json={'completed': False}).status_code == 404
        assert client.post('/api/study-plans', json={'sourceInterviewIds': [first_id, second_id]}).status_code == 404
        assert client.delete(f"/api/study-plans/{plan['id']}").status_code == 404

        client.post('/api/auth/login', json={'email': 'plan-owner@example.com', 'password': 'secret'})
        assert client.delete(f"/api/study-plans/{plan['id']}").status_code == 204
        assert client.get('/api/study-plans').json()['items'] == []
        assert client.get(f'/api/interviews/{first_id}/report').status_code == 200
        with patch('app.routers.study_plans.ai_service.generate_study_plan', side_effect=generator):
            dependent_plan = client.post('/api/study-plans',
                json={'sourceInterviewIds': [first_id, second_id]})
        assert dependent_plan.status_code == 201
        assert client.delete(f'/api/interviews/{first_id}').status_code == 204
        assert client.get('/api/study-plans').json()['items'] == []
        assert client.get(f'/api/interviews/{second_id}/report').status_code == 200
        with client.app.state.store.sessions() as session:
            assert session.scalars(select(StudyPlanRecord)).all() == []


def test_study_plans_reject_mixed_groups_insufficient_history_and_provider_failure(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    with client:
        client.post('/api/auth/register', json={'name': 'Owner', 'email': 'plan-errors@example.com', 'password': 'secret'})
        first_id = create_report(client)
        second_id = create_report(client, SETUP | {'role': 'Frontend Developer'})
        with patch('app.routers.study_plans.ai_service.generate_study_plan') as generate:
            assert client.post('/api/study-plans', json={'sourceInterviewIds': [first_id]}).status_code == 400
            assert client.post('/api/study-plans', json={'sourceInterviewIds': [first_id, first_id]}).status_code == 400
            assert client.post('/api/study-plans', json={'sourceInterviewIds': [first_id, second_id]}).status_code == 400
            generate.assert_not_called()

        assert client.post('/api/auth/logout').status_code in (200, 204)
        client.post('/api/auth/login', json={'email': 'plan-errors@example.com', 'password': 'secret'})
        unscored = make_client(tmp_path, monkeypatch, scored=False)
        # This client uses an independent database; build a pair with no persisted evaluations.
        with unscored:
            unscored.post('/api/auth/register', json={'name': 'No Score', 'email': 'plan-unscored@example.com', 'password': 'secret'})
            a = create_report(unscored)
            b = create_report(unscored)
            with patch('app.routers.study_plans.ai_service.generate_study_plan') as generate:
                response = unscored.post('/api/study-plans', json={'sourceInterviewIds': [a, b]})
            assert response.status_code == 422
            generate.assert_not_called()

        with patch('app.routers.study_plans.ai_service.generate_study_plan', return_value=None):
            unavailable = client.post('/api/study-plans', json={'sourceInterviewIds': [first_id, first_id]})
            assert unavailable.status_code == 400
            provider = client.post('/api/study-plans', json={'sourceInterviewIds': [first_id, second_id]})
            assert provider.status_code == 400  # Mixed comparison groups are rejected before provider use.
        assert client.get('/api/study-plans').json()['items'] == []


def test_study_plan_provider_malformed_output_does_not_create_records(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    with client:
        client.post('/api/auth/register', json={'name': 'Owner', 'email': 'plan-provider@example.com', 'password': 'secret'})
        first_id = create_report(client)
        second_id = create_report(client)
        with patch('app.routers.study_plans.ai_service.generate_study_plan', return_value=None):
            response = client.post('/api/study-plans', json={'sourceInterviewIds': [first_id, second_id]})
        assert response.status_code == 503
        assert 'No plan was saved' in response.json()['message']
        assert client.get('/api/study-plans').json()['items'] == []
