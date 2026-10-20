from urllib.parse import parse_qs, urlparse
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import create_app
from app import account_deletion
from app.database import (Base, UserRecord, TokenRecord, PasswordResetRecord, InterviewRecord,
    InterviewMediaRecord, InterviewMediaConsentRecord, StudyQuestionRecord, AnswerEvaluationRecord,
    EvaluationFeedbackRecord, InterviewStartRecord, MediaCleanupRecord)
from app.media_storage import media_path
from app.services import ai_service
from app.services.email_service import LocalMailbox


def test_account_deletion_reauth_revocation_isolation_and_durable_cleanup(tmp_path,monkeypatch):
    monkeypatch.setenv('INTERVIEW_MEDIA_DIR',str(tmp_path/'media'))
    monkeypatch.setattr(ai_service,'generate_question',lambda *a,**k:'Describe a project?')
    monkeypatch.setattr(ai_service,'generate_followup',lambda *a,**k:None)
    monkeypatch.setattr(ai_service,'evaluate_answer',lambda *a,**k:None)
    mailbox=LocalMailbox()
    app=create_app(seed=False,database_url=f'sqlite:///{tmp_path / "delete.db"}',mailer=mailbox)
    with TestClient(app) as client:
        owner_response=client.post('/api/auth/register',json={'name':'Owner','email':'owner@example.com','password':'private-password'})
        owner=owner_response.json()['id']; token=owner_response.headers['authorization']
        interview=client.post('/api/interviews',headers={'Idempotency-Key':'one'},json=dict(role='QA Engineer',level='Junior',mode='Practice',questionCount=5,type='Behavioral',input='Text',language='English')).json()
        path='/api/interviews/'+interview['id']
        client.post(path+'/messages',json={'text':'An answer'})
        client.post(path+'/end')
        answer_id=next(message['id'] for message in client.get(path).json()['messages'] if message['from']=='you')
        with app.state.store.sessions.begin() as session:
            session.add(EvaluationFeedbackRecord(answer_id=answer_id,owner_id=owner,interview_id=interview['id'],
                question_id=interview['messages'][0]['id'],rating='helpful',category=None,comment='Private',
                provenance=None,updated_at=1000))
        client.post('/api/study/questions',json={'interviewId':interview['id'],'questionId':interview['messages'][0]['id']})
        client.post('/api/auth/password-reset/request',json={'email':'owner@example.com'})
        reset=parse_qs(urlparse(mailbox.messages[-1]['link']).query)['token'][0]
        key=str(uuid4()); media_path(key).write_bytes(b'private recording')
        with app.state.store.sessions.begin() as session:
            session.add(InterviewMediaConsentRecord(interview_id=interview['id'],owner_id=owner,consented_at=1000))
            session.add(InterviewMediaRecord(id='media',interview_id=interview['id'],owner_id=owner,storage_key=key,
                media_type='audio/webm',size_bytes=17,created_at=1000,expires_at=9999999999))
        for body,status in [({'password':'wrong','confirmation':'DELETE'},400),({'password':'private-password','confirmation':'NO'},400)]:
            assert client.request('DELETE','/api/auth/me',json=body).status_code==status
            assert client.get('/api/auth/me').json()['id']==owner
            assert client.get(path).status_code==200
            assert media_path(key).exists()
        other_response=client.post('/api/auth/register',json={'name':'Other','email':'other@example.com','password':'other-password'})
        other=other_response.json()['id']; other_token=other_response.headers['authorization']
        client.headers['Authorization']=token
        def unavailable(_key):
            raise OSError('temporary storage failure')
        monkeypatch.setattr(account_deletion,'remove_media_file',unavailable)
        result=client.request('DELETE','/api/auth/me',json={'password':'private-password','confirmation':'DELETE','ownerId':other})
        assert result.status_code==204 and 'Max-Age=0' in result.headers['set-cookie']
        assert client.get('/api/auth/me').status_code==401
        assert client.get(path+'/media/media').status_code==401
        assert client.post('/api/auth/password-reset/confirm',json={'token':reset,'password':'new'}).status_code==400
        with app.state.store.sessions() as session:
            assert session.get(UserRecord,owner) is None and session.get(UserRecord,other) is not None
            for model in [TokenRecord,PasswordResetRecord,InterviewRecord,InterviewMediaRecord,
                          InterviewMediaConsentRecord,StudyQuestionRecord,AnswerEvaluationRecord,EvaluationFeedbackRecord,
                          InterviewStartRecord]:
                # Other account's login token is the only surviving child row.
                rows=session.scalars(select(model)).all()
                assert len(rows)==(1 if model is TokenRecord else 0)
            assert session.get(MediaCleanupRecord,key) is not None
        assert media_path(key).exists()
        client.headers['Authorization']=other_token
        assert client.get('/api/auth/me').json()['id']==other
        assert client.get(path+'/media/media').status_code==404
        from app.media_storage import remove_media_file
        monkeypatch.setattr(account_deletion,'remove_media_file',remove_media_file)
        account_deletion.retry_media_cleanup(app.state.store)
        account_deletion.retry_media_cleanup(app.state.store)
        assert not media_path(key).exists()
        with app.state.store.sessions() as session:
            assert session.get(MediaCleanupRecord,key) is None


def test_delete_failure_rolls_back_before_file_cleanup(tmp_path,monkeypatch):
    app=create_app(seed=False,database_url=f'sqlite:///{tmp_path / "rollback.db"}')
    with TestClient(app) as client:
        user=client.post('/api/auth/register',json={'name':'Owner','email':'rollback@example.com','password':'secret'}).json()
        with pytest.raises(RuntimeError):
            with app.state.store.transaction() as store:
                account_deletion.delete_owned_account(store,user['id'],'secret')
                raise RuntimeError('transaction failed')
        assert client.get('/api/auth/me').json()==user
