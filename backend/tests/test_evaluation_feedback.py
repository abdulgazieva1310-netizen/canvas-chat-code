from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import EvaluationFeedbackRecord
from app.main import create_app
from app.models import AnswerEvaluation
from app.services import ai_service


def test_evaluation_feedback_is_private_editable_and_lifecycle_safe(tmp_path, monkeypatch):
    calls = {'evaluate': 0}

    def evaluate(*args, **kwargs):
        calls['evaluate'] += 1
        return AnswerEvaluation(
            accuracy=8, completeness=7, clarity=8, structure=7,
            went_well='Clear example', missing='More impact', stronger_answer='An improved answer.',
        )

    monkeypatch.setattr(ai_service, 'generate_question', lambda *a, **k: 'Describe a project?')
    monkeypatch.setattr(ai_service, 'evaluate_answer', evaluate)
    monkeypatch.setattr(ai_service, 'generate_followup', lambda *a, **k: None)
    app = create_app(seed=False, database_url=f'sqlite:///{tmp_path / "feedback.db"}')
    with TestClient(app) as client:
        path = '/api/interviews/not-an-interview/answers/not-an-answer/feedback'
        assert client.get(path).status_code == 401
        client.post('/api/auth/register', json={'name': 'Owner', 'email': 'feedback@example.com', 'password': 'secret'})
        interview = client.post('/api/interviews', json=dict(
            role='QA Engineer', level='Junior', mode='Practice', questionCount=5,
            type='Behavioral', input='Text', language='English',
        )).json()
        interview_path = f"/api/interviews/{interview['id']}"
        client.post(interview_path + '/messages', json={'text': 'I improved the service by 30%.'})
        answer_id = next(message['id'] for message in client.get(interview_path).json()['messages'] if message['from'] == 'you')
        client.post(interview_path + '/end')
        feedback_path = f'{interview_path}/answers/{answer_id}/feedback'
        original_report = client.get(interview_path + '/report').json()
        assert original_report['feedback']['overall'] == 7.5
        assert client.get(feedback_path).json() == {
            'answerId': answer_id, 'rating': None, 'category': None, 'comment': None,
            'updatedAt': None, 'provenanceStatus': 'unknown',
        }
        assert client.put(feedback_path, json={'rating': 'needs_review'}).status_code == 400
        assert client.put(feedback_path, json={
            'rating': 'needs_review', 'category': 'unsupported',
        }).status_code == 400
        assert client.put(feedback_path, json={
            'rating': 'helpful', 'category': 'incorrect',
        }).status_code == 400
        assert client.put(feedback_path, json={
            'rating': 'needs_review', 'category': 'other', 'comment': 'x' * 1001,
        }).status_code == 400

        comment = '<script>unsafe()</script> — Русский текст'
        saved = client.put(feedback_path, json={
            'rating': 'needs_review', 'category': 'incorrect', 'comment': comment,
        }).json()
        assert saved['rating'] == 'needs_review'
        assert saved['category'] == 'incorrect'
        assert saved['comment'] == comment
        assert saved['provenanceStatus'] == 'unknown'
        assert client.get(feedback_path).json() == saved

        updated = client.put(feedback_path, json={'rating': 'helpful', 'comment': 'Полезно'}).json()
        assert updated['rating'] == 'helpful' and updated['category'] is None
        assert updated['comment'] == 'Полезно'
        with app.state.store.sessions() as session:
            rows = session.scalars(select(EvaluationFeedbackRecord)).all()
            assert len(rows) == 1
            assert rows[0].provenance is None
        assert calls['evaluate'] == 1
        assert client.get(interview_path + '/report').json() == original_report

        owner_token = client.post('/api/auth/login', json={
            'email': 'feedback@example.com', 'password': 'secret',
        }).headers['authorization']
        client.post('/api/auth/register', json={
            'name': 'Other', 'email': 'other-feedback@example.com', 'password': 'secret',
        }).json()
        foreign_get = client.get(feedback_path)
        missing_get = client.get(f'{interview_path}/answers/missing/feedback')
        assert foreign_get.status_code == missing_get.status_code == 404
        assert foreign_get.json() == missing_get.json()
        assert client.put(feedback_path, json={'rating': 'helpful'}).status_code == 404
        assert client.delete(feedback_path).status_code == 404
        assert client.get('/api/auth/me/export').json()['evaluationFeedback'] == []

        client.cookies.clear()
        client.headers['Authorization'] = owner_token
        archive = client.get('/api/auth/me/export').json()
        assert archive['evaluationFeedback'][0]['answerId'] == answer_id
        assert archive['evaluationFeedback'][0]['comment'] == 'Полезно'
        assert client.delete(feedback_path).status_code == 204
        assert client.get(feedback_path).json()['rating'] is None
        assert calls['evaluate'] == 1
        assert client.delete(interview_path).status_code == 204
        with app.state.store.sessions() as session:
            assert session.scalars(select(EvaluationFeedbackRecord)).all() == []
