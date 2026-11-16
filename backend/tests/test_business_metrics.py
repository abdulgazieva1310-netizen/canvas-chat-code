from fastapi.testclient import TestClient
from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from app.main import create_app
from app.models import AnswerEvaluation, StudyPlanDraft, StudyPlanDraftItem
from app.services import ai_service
from app.telemetry import _version_label


SETUP = {
    'role': 'QA Engineer', 'level': 'Junior', 'mode': 'Practice',
    'questionCount': 5, 'type': 'Behavioral', 'input': 'Text', 'language': 'English',
}


def counter_points(reader, instrument_name):
    metrics = reader.get_metrics_data()
    return [point for resource in metrics.resource_metrics
            for scope in resource.scope_metrics
            for metric in scope.metrics if metric.name == instrument_name
            for point in metric.data.data_points]


def counter_value(reader, instrument_name, environment):
    return sum(point.value for point in counter_points(reader, instrument_name)
               if point.attributes.get('environment') == environment)


def create_report(client, setup=SETUP):
    interview = client.post('/api/interviews', json=setup)
    assert interview.status_code == 201
    interview_id = interview.json()['id']
    for index in range(setup['questionCount']):
        answer = client.post(f'/api/interviews/{interview_id}/messages',
                             json={'text': f'I tested boundary cases and measured result {index}.'})
        assert answer.status_code == 200
    assert answer.json()['status'] == 'complete'
    return interview_id


def test_interview_start_counter_uses_dev_prod_label_and_skips_idempotent_retry(tmp_path, monkeypatch):
    monkeypatch.setenv('OTEL_DEPLOYMENT_ENVIRONMENT', 'development')
    monkeypatch.setenv('OTEL_SERVICE_VERSION', '123456789012.dkr.ecr.eu-central-1.amazonaws.com/interview-mirror-app:20261116-112233-abcdef0')
    monkeypatch.delenv('OTEL_EXPORTER_OTLP_ENDPOINT', raising=False)
    monkeypatch.setattr(ai_service, 'generate_question', lambda *args, **kwargs: 'Describe a test?')
    reader = InMemoryMetricReader()
    app = create_app(seed=False, database_url=f'sqlite:///{tmp_path / "metrics-start.db"}',
                     metric_reader=reader)

    with TestClient(app) as client:
        registered = client.post('/api/auth/register', json={
            'name': 'Metric User', 'email': 'metrics@example.com', 'password': 'secret'})
        assert registered.status_code == 201
        headers = {'Authorization': registered.headers['authorization'], 'Idempotency-Key': 'one-start'}
        first = client.post('/api/interviews', json=SETUP, headers=headers)
        retry = client.post('/api/interviews', json=SETUP, headers=headers)
        assert first.status_code == retry.status_code == 201
        assert first.json()['id'] == retry.json()['id']

        headers['Idempotency-Key'] = 'another-start'
        second = client.post('/api/interviews', json=SETUP, headers=headers)
        assert second.status_code == 201

        points = counter_points(reader, 'interviews_started')
        assert counter_value(reader, 'interviews_started', 'dev') == 2
        assert all(point.attributes == {'environment': 'dev', 'version': '20261116-112233-abcdef0'}
                   for point in points)


def test_completed_report_counter_counts_completion_once_and_ignores_incomplete(tmp_path, monkeypatch):
    monkeypatch.setenv('OTEL_DEPLOYMENT_ENVIRONMENT', 'production')
    monkeypatch.setenv('OTEL_SERVICE_VERSION', '123456789012.dkr.ecr.eu-central-1.amazonaws.com/interview-mirror-app:20261116-112233-abcdef0')
    monkeypatch.delenv('OTEL_EXPORTER_OTLP_ENDPOINT', raising=False)
    monkeypatch.setattr(ai_service, 'generate_question', lambda *args, **kwargs: 'Describe a test?')
    evaluation = AnswerEvaluation(accuracy=7, completeness=7, clarity=7, structure=7,
        went_well='Clear example.', missing='Discuss trade-offs.',
        stronger_answer='I included trade-offs and measured results.', practice_topic='Boundary testing')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: evaluation)
    reader = InMemoryMetricReader()
    app = create_app(seed=False, database_url=f'sqlite:///{tmp_path / "metrics-completed.db"}',
                     metric_reader=reader)

    with TestClient(app) as client:
        client.post('/api/auth/register', json={
            'name': 'Metric User', 'email': 'completed@example.com', 'password': 'secret'})
        complete_id = create_report(client)
        assert client.get(f'/api/interviews/{complete_id}/report').status_code == 200
        assert client.get(f'/api/interviews/{complete_id}/report').status_code == 200
        assert client.get(f'/api/interviews/{complete_id}/report/export').status_code == 200

        incomplete = client.post('/api/interviews', json=SETUP).json()
        assert client.post(f"/api/interviews/{incomplete['id']}/end").status_code == 200
        assert client.get(f"/api/interviews/{incomplete['id']}/report").status_code == 200

        points = counter_points(reader, 'interviews_completed')
        assert counter_value(reader, 'interviews_completed', 'prod') == 1
        assert all(point.attributes == {'environment': 'prod', 'version': '20261116-112233-abcdef0'}
                   for point in points)


def test_version_label_extracts_image_tag_and_preserves_release_versions(monkeypatch):
    monkeypatch.setenv('OTEL_SERVICE_VERSION',
        '123456789012.dkr.ecr.eu-central-1.amazonaws.com/interview-mirror-app:20261116-112233-abcdef0')
    assert _version_label() == '20261116-112233-abcdef0'

    monkeypatch.setenv('OTEL_SERVICE_VERSION', '0.1.0')
    assert _version_label() == '0.1.0'

    monkeypatch.delenv('OTEL_SERVICE_VERSION', raising=False)
    assert _version_label() == '0.1.0'


def test_study_plan_counter_only_counts_new_successfully_saved_plan(tmp_path, monkeypatch):
    monkeypatch.setenv('OTEL_DEPLOYMENT_ENVIRONMENT', 'development')
    monkeypatch.delenv('OTEL_EXPORTER_OTLP_ENDPOINT', raising=False)
    monkeypatch.setattr(ai_service, 'generate_question', lambda *args, **kwargs: 'Describe a test?')
    evaluation = AnswerEvaluation(accuracy=7, completeness=7, clarity=7, structure=7,
        went_well='Clear example.', missing='Discuss boundary test cases.',
        stronger_answer='I tested boundary cases and measured results.', practice_topic='Boundary testing')
    monkeypatch.setattr(ai_service, 'evaluate_answer', lambda *args, **kwargs: evaluation)
    reader = InMemoryMetricReader()
    app = create_app(seed=False, database_url=f'sqlite:///{tmp_path / "metrics-plans.db"}',
                     metric_reader=reader)

    def plan_draft(evidence, _comparison):
        refs = [evidence[0]['ref'], next(item['ref'] for item in evidence
                if item['ref'].split('Q')[0] != evidence[0]['ref'].split('Q')[0])]
        return StudyPlanDraft(items=[
            StudyPlanDraftItem(topic='Boundary testing', rationale='The reports repeat this gap.',
                action='Practice boundary cases and record the outcome.', sourceRefs=refs),
            StudyPlanDraftItem(topic='Result statements', rationale='The reports need measurable outcomes.',
                action='Practice ending each example with a measured result.', sourceRefs=refs),
        ])

    monkeypatch.setattr(ai_service, 'generate_study_plan', plan_draft)
    with TestClient(app) as client:
        client.post('/api/auth/register', json={
            'name': 'Metric User', 'email': 'plans@example.com', 'password': 'secret'})
        first = create_report(client)
        second = create_report(client)

        monkeypatch.setattr(ai_service, 'generate_study_plan', lambda *_args, **_kwargs: None)
        failed = client.post('/api/study-plans', json={'sourceInterviewIds': [first, second]})
        assert failed.status_code == 503
        assert counter_value(reader, 'study_plans_generated', 'dev') == 0

        monkeypatch.setattr(ai_service, 'generate_study_plan', plan_draft)
        created = client.post('/api/study-plans', json={'sourceInterviewIds': [first, second]})
        assert created.status_code == 201, created.text
        plan_id = created.json()['id']
        assert counter_value(reader, 'study_plans_generated', 'dev') == 1

        regenerated = client.post(f'/api/study-plans/{plan_id}/regenerate')
        assert regenerated.status_code == 200
        assert counter_value(reader, 'study_plans_generated', 'dev') == 1

