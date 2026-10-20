from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from ..auth import CurrentUser
from ..database import StudyQuestionRecord

router = APIRouter(prefix='/study/questions', tags=['study'])


class SaveQuestion(BaseModel):
    interviewId: str = Field(min_length=1)
    questionId: str = Field(min_length=1)


class NoteUpdate(BaseModel):
    note: str = Field(max_length=4000)


class StudyQuestion(BaseModel):
    id: str
    interviewId: str
    questionId: str
    prompt: str
    note: str
    savedAt: datetime


class StudyPage(BaseModel):
    items: list[StudyQuestion]
    total: int
    page: int
    pageSize: int


def public(store, record):
    interview = store.find(record.owner_id, record.interview_id)
    question = next((m for m in interview.messages if m.id == record.question_id and m.sender == 'ai'), None)
    if question is None:
        raise HTTPException(404, 'Saved question not found.')
    return StudyQuestion(id=record.id, interviewId=record.interview_id, questionId=record.question_id,
        prompt=question.text, note=record.note, savedAt=datetime.fromtimestamp(record.saved_at, timezone.utc))


def owned(store, owner_id, ident):
    record = store.session.scalar(select(StudyQuestionRecord).where(
        StudyQuestionRecord.id == ident, StudyQuestionRecord.owner_id == owner_id))
    if record is None:
        raise HTTPException(404, 'Saved question not found.')
    return record


@router.post('', response_model=StudyQuestion)
def save(data: SaveQuestion, request: Request, user: CurrentUser):
    def existing(store):
        return store.session.scalar(select(StudyQuestionRecord).where(
            StudyQuestionRecord.owner_id == user.id, StudyQuestionRecord.interview_id == data.interviewId,
            StudyQuestionRecord.question_id == data.questionId))
    try:
        with request.app.state.store.transaction() as store:
            interview = store.find(user.id, data.interviewId)
            if interview.status == 'active':
                raise HTTPException(409, 'End the interview before saving reported questions.')
            if not any(q.questionId == data.questionId for q in store.report(interview).questions):
                raise HTTPException(404, 'Reported question not found.')
            record = existing(store)
            if record is None:
                record = StudyQuestionRecord(id=str(uuid4()), owner_id=user.id, interview_id=data.interviewId,
                    question_id=data.questionId, note='', saved_at=datetime.now(timezone.utc).timestamp())
                store.session.add(record)
                store.session.flush()
            return public(store, record)
    except IntegrityError:
        with request.app.state.store.transaction() as store:
            record = existing(store)
            if record is None:
                raise
            return public(store, record)


@router.get('', response_model=StudyPage)
def listing(request: Request, user: CurrentUser, page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100)):
    with request.app.state.store.transaction() as store:
        query = select(StudyQuestionRecord).where(StudyQuestionRecord.owner_id == user.id)
        total = store.session.scalar(select(func.count()).select_from(query.subquery()))
        records = store.session.scalars(query.order_by(StudyQuestionRecord.saved_at.desc(), StudyQuestionRecord.id)
            .offset((page - 1) * pageSize).limit(pageSize))
        return StudyPage(items=[public(store, record) for record in records], total=total, page=page, pageSize=pageSize)


@router.patch('/{ident}', response_model=StudyQuestion)
def update(ident: str, data: NoteUpdate, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        record = owned(store, user.id, ident)
        record.note = data.note
        return public(store, record)


@router.delete('/{ident}', status_code=204)
def remove(ident: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        store.session.delete(owned(store, user.id, ident))
    return Response(status_code=204)
