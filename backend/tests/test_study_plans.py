from unittest.mock import patch
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import StudyPlanRecord
from app.main import create_app
from app.models import StudyPlanDraft, StudyPlanDraftItem, AnswerEvaluation
from app.services import ai_service


SETUP = {'role': 'QA Engineer', 'level': 'Junior', 'mode': 'Practice', 'questionCount': 5,
         'type': 'Behavioral', 'input': 'Text', 'language': 'English'}


def draft(evidence, _group):
    refs = [evidence[0]['ref'], next(item['ref'] for item in evidence
            if item['ref'].split('Q')[0] != evidence[0]['ref'].split('Q')[0])]
    return StudyPlanDraft(items=[
        StudyPlanDraftItem(topic='Test design', rationale='Reports show missed edge cases.',
                           action='Write boundary tests for a small form validator.', sourceRefs=refs),
        StudyPlanDraftItem(topic='STAR structure', rationale='Reports show unclear result statements.',
                           action='Practice two answers with situation, task, action, result.', sourceRefs=refs),
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

        # New completions never silently replace a saved plan or its progress.
        third_id = create_report(client)
        with patch('app.routers.study_plans.ai_service.generate_study_plan') as automatic:
            snapshot = client.get('/api/study-plans').json()['items'][0]
            assert snapshot == toggled.json()
            automatic.assert_not_called()

        with patch('app.routers.study_plans.ai_service.generate_study_plan', side_effect=generator):
            regenerated = client.post(f"/api/study-plans/{plan['id']}/regenerate")
        assert regenerated.status_code == 200
        assert regenerated.json()['id'] == plan['id']
        assert third_id not in {source['interviewId'] for source in regenerated.json()['sources']}
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


@pytest.mark.parametrize('second_feedback', ['No supported improvement area.', 'Explain delivery communication.'])
def test_recurrence_requires_two_distinct_reports_before_provider_use(tmp_path, monkeypatch, second_feedback):
    with make_client(tmp_path, monkeypatch) as client:
        client.post('/api/auth/register', json={'name': 'Owner', 'email': 'recurrence@example.com', 'password': 'secret'})
        first = create_report(client)
        monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *a, **k: AnswerEvaluation(
            accuracy=7, completeness=7, clarity=7, structure=7, went_well='', missing=second_feedback,
            stronger_answer='Explain the communication approach.', practice_topic='Delivery communication'))
        second = create_report(client)
        with patch('app.routers.study_plans.ai_service.generate_study_plan') as generator:
            response = client.post('/api/study-plans', json={'sourceInterviewIds': [first, second]})
        assert response.status_code == 422
        assert 'two selected interviews' in response.json()['message']
        generator.assert_not_called()
        assert client.get('/api/study-plans').json()['items'] == []


def test_evidence_budget_preserves_multiple_reports_and_excludes_one_off_topics():
    from app.routers.study_plans import build_evidence
    interviews = {str(i): SimpleNamespace(id=str(i), status='complete', setup=SimpleNamespace(**SETUP))
                  for i in range(3)}
    def report(interview):
        return SimpleNamespace(overall=6, questions=[SimpleNamespace(
            answerId=f'{interview.id}-{i}', scores=object(), score=6,
            miss='Improve the practice skill.', q='Explain your approach?',
            practiceTopics=['Unique area'] if interview.id == '0' and i == 0 else
                          ['Boundary testing' if interview.id == '0' else '  BOUNDARY   testing '])
            for i in range(30)])
    store = SimpleNamespace(find=lambda owner, key: interviews[key], report=report)
    *_, evidence, refs = build_evidence(store, 'owner', list(interviews))
    assert len(evidence) == 20
    assert {ref.interviewId for ref in refs.values()} == set(interviews)
    assert all('Unique area' not in item['practiceTopics'] for item in evidence)
    assert set(refs) == {item['ref'] for item in evidence}


@pytest.mark.parametrize('citation_error', ['one-report', 'unknown', 'duplicate', 'different-topic'])
def test_goals_must_cite_recurring_evidence_from_distinct_reports(tmp_path, monkeypatch, citation_error):
    with make_client(tmp_path, monkeypatch) as client:
        client.post('/api/auth/register', json={'name': 'Owner', 'email': 'citations@example.com', 'password': 'secret'})
        if citation_error == 'different-topic':
            count = iter(range(10))
            def mixed_topics(*args, **kwargs):
                topic = 'Boundary testing' if next(count) % 5 % 2 == 0 else 'Complexity analysis'
                return AnswerEvaluation(accuracy=6, completeness=6, clarity=6, structure=6,
                    went_well='', missing=f'Explain {topic}.', stronger_answer='Explain the approach.',
                    practice_topic=topic)
            monkeypatch.setattr(ai_service, 'evaluate_answer', mixed_topics)
        ids = [create_report(client), create_report(client)]

        def invalid(evidence, group):
            result = draft(evidence, group)
            first_report = [item['ref'] for item in evidence if item['ref'].startswith('R1Q')]
            result.items[0].sourceRefs = ([evidence[0]['ref'], evidence[3]['ref']]
                if citation_error == 'different-topic' else first_report[:2] if citation_error == 'one-report'
                else ['unknown'] if citation_error == 'unknown' else [evidence[0]['ref']] * 2)
            return result

        with patch('app.routers.study_plans.ai_service.generate_study_plan', side_effect=invalid):
            response = client.post('/api/study-plans', json={'sourceInterviewIds': ids})
        assert response.status_code == 503
        assert 'No changes were saved' in response.json()['message']
        assert client.get('/api/study-plans').json()['items'] == []
        with patch('app.routers.study_plans.ai_service.generate_study_plan', side_effect=draft):
            saved = client.post('/api/study-plans', json={'sourceInterviewIds': ids}).json()
        with patch('app.routers.study_plans.ai_service.generate_study_plan', side_effect=invalid):
            assert client.post(f"/api/study-plans/{saved['id']}/regenerate").status_code == 503
        assert client.get('/api/study-plans').json()['items'] == [saved]
