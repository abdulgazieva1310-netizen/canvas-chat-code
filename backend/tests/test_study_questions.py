from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import create_app
from app.database import StudyQuestionRecord
from app.services import ai_service


def test_saved_question_lifecycle_is_private_idempotent_and_cascades(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_service,'generate_question',lambda *a,**k:'Describe a project?')
    monkeypatch.setattr(ai_service,'evaluate_answer',lambda *a,**k:None)
    monkeypatch.setattr(ai_service,'generate_followup',lambda *a,**k:None)
    app=create_app(seed=False,database_url=f'sqlite:///{tmp_path / "study.db"}')
    with TestClient(app) as client:
        assert client.get('/api/study/questions').status_code==401
        client.post('/api/auth/register',json={'name':'Owner','email':'owner@example.com','password':'secret'})
        interview=client.post('/api/interviews',json=dict(role='QA Engineer',level='Junior',mode='Practice',questionCount=5,type='Behavioral',input='Text',language='English')).json()
        path='/api/interviews/'+interview['id']
        question=interview['messages'][0]['id']
        body={'interviewId':interview['id'],'questionId':question}
        assert client.post('/api/study/questions',json=body).status_code==409
        client.post(path+'/messages',json={'text':'My answer'})
        pending=client.get(path).json()['messages'][-1]['id']
        client.post(path+'/end')
        assert client.post('/api/study/questions',json=body|{'questionId':pending}).status_code==404
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:client.post('/api/study/questions',json=body),range(2)))
        assert all(r.status_code==200 for r in results)
        saved=results[0].json()
        assert results[1].json()['id']==saved['id']
        itempath='/api/study/questions/'+saved['id']
        note='<script>unsafe()</script>\nРусский текст'
        assert client.patch(itempath,json={'note':note}).json()['note']==note
        assert client.patch(itempath,json={'note':'x'*4001}).status_code==400
        assert client.post('/api/study/questions',json=body).json()['note']==note
        page=client.get('/api/study/questions').json()
        assert page['total']==1 and page['pageSize']==20 and page['items'][0]['prompt']=='Describe a project?'
        assert client.get('/api/study/questions?page=2').json()['items']==[]
        for query in ['page=0','pageSize=101','pageSize=0']:
            assert client.get('/api/study/questions?'+query).status_code==400
        owner_token=client.post('/api/auth/login',json={'email':'owner@example.com','password':'secret'}).headers['authorization']
        client.post('/api/auth/register',json={'name':'Other','email':'other@example.com','password':'secret'})
        assert client.get('/api/study/questions').json()['total']==0
        assert client.post('/api/study/questions',json=body).status_code==404
        for method,payload in [('PATCH',{'note':'foreign'}),('DELETE',None)]:
            foreign=client.request(method,itempath,json=payload)
            missing=client.request(method,'/api/study/questions/missing',json=payload)
            assert foreign.status_code==missing.status_code==404 and foreign.json()==missing.json()
        client.cookies.clear()
        client.headers['Authorization']=owner_token
        assert client.get('/api/study/questions').json()['items'][0]['note']==note
        assert client.delete(itempath).status_code==204
        assert client.get('/api/study/questions').json()['total']==0
        client.post('/api/study/questions',json=body)
        assert client.delete(path).status_code==204
        assert client.get('/api/study/questions').json()['items']==[]
        with app.state.store.sessions() as session:
            assert session.scalars(select(StudyQuestionRecord)).all()==[]


def test_study_question_pagination_uses_stable_saved_order(tmp_path,monkeypatch):
    monkeypatch.setattr(ai_service,'generate_question',lambda *a,**k:'Describe a project?')
    monkeypatch.setattr(ai_service,'evaluate_answer',lambda *a,**k:None)
    monkeypatch.setattr(ai_service,'generate_followup',lambda *a,**k:None)
    with TestClient(create_app(seed=False,database_url=f'sqlite:///{tmp_path / "pages.db"}')) as client:
        client.post('/api/auth/register',json={'name':'Owner','email':'pages@example.com','password':'secret'})
        interview=client.post('/api/interviews',json=dict(role='QA Engineer',level='Junior',mode='Practice',questionCount=5,type='Behavioral',input='Text',language='English')).json()
        path='/api/interviews/'+interview['id']
        questions=[]
        for _ in range(3):
            questions.append(client.get(path).json()['messages'][-1]['id'])
            client.post(path+'/messages',json={'text':'An answer'})
        client.post(path+'/end')
        ids=[client.post('/api/study/questions',json={'interviewId':interview['id'],'questionId':q}).json()['id'] for q in questions]
        with client.app.state.store.sessions.begin() as session:
            for record in session.scalars(select(StudyQuestionRecord)):
                record.saved_at=1000
        pages=[client.get(f'/api/study/questions?page={page}&pageSize=1').json() for page in [1,2,3]]
        assert [page['items'][0]['id'] for page in pages]==sorted(ids)
        assert all(page['total']==3 for page in pages)
        assert client.get('/api/study/questions?page=4&pageSize=1').json()['items']==[]
