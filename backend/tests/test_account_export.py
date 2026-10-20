from fastapi.testclient import TestClient
from sqlalchemy import event, select
from app.main import create_app
from app.database import UserRecord, InterviewMediaRecord
from app.services import ai_service


def test_archive_allowlists_owned_data_and_does_not_mutate(tmp_path,monkeypatch):
    monkeypatch.setattr(ai_service,'generate_question',lambda *a,**k:'Describe a project?')
    monkeypatch.setattr(ai_service,'generate_followup',lambda *a,**k:None)
    monkeypatch.setattr(ai_service,'evaluate_answer',lambda *a,**k:None)
    app=create_app(seed=False,database_url=f'sqlite:///{tmp_path / "archive.db"}')
    with TestClient(app) as client:
        assert client.get('/api/auth/me/export').status_code==401
        client.post('/api/auth/register',json={'name':'Owner','email':'owner@example.com','password':'private-password'})
        owner=client.get('/api/auth/me').json()['id']
        setup=dict(role='QA Engineer',level='Junior',mode='Real Interview',questionCount=5,type='Behavioral',input='Text',language='English')
        interview=client.post('/api/interviews',json=setup).json()
        path='/api/interviews/'+interview['id']
        assert client.get('/api/auth/me/export').status_code==409
        text='Пример\n```python\n  print(1)\n```'
        client.post(path+'/messages',json={'text':text})
        client.post(path+'/end')
        saved=client.post('/api/study/questions',json={'interviewId':interview['id'],'questionId':interview['messages'][0]['id']}).json()
        client.patch('/api/study/questions/'+saved['id'],json={'note':'Русская заметка'})
        with app.state.store.sessions.begin() as session:
            session.add(InterviewMediaRecord(id='owned-media',interview_id=interview['id'],owner_id=owner,
                storage_key='private-storage-key',media_type='audio/webm',size_bytes=123,created_at=1000,expires_at=2000))
            password_hash=session.get(UserRecord,owner).password_hash
        before=client.get(path).json()
        def forbidden(*a,**k):
            raise AssertionError('Archive must not call AI')
        for name in ['generate_question','evaluate_answer','generate_hint','generate_followup']:
            monkeypatch.setattr(ai_service,name,forbidden)
        statements=[]
        def sql(conn,cursor,statement,parameters,context,many):
            statements.append(statement)
        event.listen(app.state.store.engine,'before_cursor_execute',sql)
        try:
            result=client.get('/api/auth/me/export')
        finally:
            event.remove(app.state.store.engine,'before_cursor_execute',sql)
        assert result.status_code==200 and result.headers['content-disposition'].startswith('attachment;')
        assert any(statement=='BEGIN' for statement in statements)
        archive=result.json()
        assert archive['schemaVersion']==1 and archive['exportedAt']
        assert archive['profile']['id']==owner
        assert archive['interviews'][0]==before
        assert text in [m['text'] for m in archive['interviews'][0]['messages']]
        assert archive['evaluations'][0]['feedback'] is None
        assert archive['studyQuestions'][0]['note']=='Русская заметка'
        assert archive['media'][0]['expiresAt']==2000 and not archive['mediaBytesIncluded']
        for secret in ['private-storage-key',password_hash,'private-password','storage_key','password_hash','reviewerNotes']:
            assert secret not in result.text
        assert client.get(path).json()==before
        client.post('/api/auth/register',json={'name':'Other','email':'other@example.com','password':'secret'})
        other=client.get('/api/auth/me/export?ownerId='+owner).json()
        assert other['interviews']==other['evaluations']==other['studyQuestions']==other['media']==[]
        assert other['profile']['id']!=owner
        from app import account_export
        monkeypatch.setattr(account_export,'MAX_ARCHIVE_BYTES',20)
        oversized=client.get('/api/auth/me/export')
        assert oversized.status_code==413 and 'schemaVersion' not in oversized.text
        assert 'content-disposition' not in oversized.headers
