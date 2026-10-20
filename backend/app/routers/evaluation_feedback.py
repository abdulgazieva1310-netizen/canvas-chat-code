"""Owner-scoped feedback records attached to saved per-answer evaluations."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from ..auth import CurrentUser
from ..database import AnswerEvaluationRecord, EvaluationFeedbackRecord

router = APIRouter(prefix='/interviews', tags=['evaluation feedback'])

Rating = Literal['helpful', 'needs_review']
Category = Literal['incorrect', 'unclear', 'irrelevant', 'wrong_language', 'other']


class EvaluationFeedbackUpdate(BaseModel):
    model_config = {'extra': 'forbid'}
    rating: Rating
    category: Category | None = None
    comment: str | None = Field(default=None, max_length=1000)

    @model_validator(mode='after')
    def validate_category(self):
        if self.rating == 'needs_review' and self.category is None:
            raise ValueError('Choose a category when requesting review.')
        if self.rating == 'helpful' and self.category is not None:
            raise ValueError('Helpful feedback cannot include a review category.')
        return self


class EvaluationFeedbackView(BaseModel):
    answerId: str
    rating: Rating | None
    category: Category | None
    comment: str | None
    updatedAt: datetime | None
    provenanceStatus: Literal['unknown'] = 'unknown'


def public(record: EvaluationFeedbackRecord | None, answer_id: str) -> EvaluationFeedbackView:
    return EvaluationFeedbackView(
        answerId=answer_id,
        rating=record.rating if record else None,
        category=record.category if record else None,
        comment=record.comment if record else None,
        updatedAt=datetime.fromtimestamp(record.updated_at, timezone.utc) if record else None,
        provenanceStatus='unknown',
    )


def evaluation(store, owner_id: str, interview_id: str, answer_id: str) -> AnswerEvaluationRecord:
    interview = store.find(owner_id, interview_id)
    if interview.status == 'active':
        raise HTTPException(409, 'End the interview before reporting evaluation feedback.')
    record = store.session.scalar(select(AnswerEvaluationRecord).where(
        AnswerEvaluationRecord.interview_id == interview_id,
        AnswerEvaluationRecord.answer_id == answer_id,
    ))
    if record is None or record.result is None:
        raise HTTPException(404, 'Saved evaluation not found.')
    return record


@router.get('/{interview_id}/answers/{answer_id}/feedback', response_model=EvaluationFeedbackView)
def get_feedback(interview_id: str, answer_id: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        evaluation(store, user.id, interview_id, answer_id)
        record = store.session.get(EvaluationFeedbackRecord, answer_id)
        return public(record if record and record.owner_id == user.id else None, answer_id)


@router.put('/{interview_id}/answers/{answer_id}/feedback', response_model=EvaluationFeedbackView)
def put_feedback(interview_id: str, answer_id: str, data: EvaluationFeedbackUpdate,
                 request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        saved_evaluation = evaluation(store, user.id, interview_id, answer_id)
        record = store.session.get(EvaluationFeedbackRecord, answer_id)
        if record is None:
            record = EvaluationFeedbackRecord(
                answer_id=answer_id,
                owner_id=user.id,
                interview_id=interview_id,
                question_id=saved_evaluation.question_id,
                rating=data.rating,
                category=data.category,
                comment=data.comment,
                provenance=None,
                updated_at=datetime.now(timezone.utc).timestamp(),
            )
            store.session.add(record)
        else:
            if record.owner_id != user.id or record.interview_id != interview_id:
                raise HTTPException(404, 'Saved evaluation not found.')
            record.rating = data.rating
            record.category = data.category
            record.comment = data.comment
            record.updated_at = datetime.now(timezone.utc).timestamp()
        store.session.flush()
        return public(record, answer_id)


@router.delete('/{interview_id}/answers/{answer_id}/feedback', status_code=204)
def delete_feedback(interview_id: str, answer_id: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        evaluation(store, user.id, interview_id, answer_id)
        record = store.session.get(EvaluationFeedbackRecord, answer_id)
        if record is not None:
            if record.owner_id != user.id or record.interview_id != interview_id:
                raise HTTPException(404, 'Saved evaluation not found.')
            store.session.delete(record)
    return Response(status_code=204)
