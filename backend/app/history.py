"""Validated history queries and portable database-side score aggregation."""
from datetime import date, datetime, time, timezone
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, or_, select

from .database import AnswerEvaluationRecord, InterviewRecord
from .models import Interview, Role


class HistoryQuery(BaseModel):
    role: Role | None = None
    type: Literal['Technical', 'Behavioral', 'Role-specific'] | None = None
    startDate: date | None = None
    endDate: date | None = None
    minScore: float | None = Field(default=None, ge=1, le=10)
    maxScore: float | None = Field(default=None, ge=1, le=10)
    search: str | None = Field(default=None, max_length=200)
    page: int = Field(default=1, ge=1)
    pageSize: int = Field(default=20, ge=1, le=100)

    @model_validator(mode='after')
    def ordered_bounds(self):
        if self.startDate and self.endDate and self.startDate > self.endDate:
            raise ValueError('startDate must not be after endDate')
        if self.minScore is not None and self.maxScore is not None and self.minScore > self.maxScore:
            raise ValueError('minScore must not exceed maxScore')
        return self


class HistoryPage(BaseModel):
    items: list[Interview]
    total: int
    page: int
    pageSize: int


def history_page(session, user_id, query):
    table = InterviewRecord
    conditions = [table.owner_id == user_id, table.status != 'active']
    setup = table.payload['setup']
    role = setup['role'].as_string()
    if query.role:
        conditions.append(role == query.role)
    if query.type:
        conditions.append(setup['type'].as_string() == query.type)
    if query.startDate:
        conditions.append(table.started_at >= datetime.combine(query.startDate, time.min, timezone.utc).timestamp())
    if query.endDate:
        # Exclusive next midnight includes the entire UTC end date, including fractional seconds.
        end = datetime.combine(query.endDate, time.min, timezone.utc).timestamp() + 86400
        conditions.append(table.started_at < end)
    if query.search:
        term = query.search.lower()
        conditions.append(or_(func.lower(role).contains(term, autoescape=True),
            func.lower(func.coalesce(setup['jobDescription'].as_string(), '')).contains(term, autoescape=True)))
    statement = select(table).where(*conditions)
    if query.minScore is not None or query.maxScore is not None:
        evaluations = AnswerEvaluationRecord
        # Match report scoring: average each available category, then average categories.
        categories = [func.round(func.avg(evaluations.result[key].as_float()), 1).label(key)
                      for key in ('accuracy', 'completeness', 'clarity', 'structure')]
        scores = select(evaluations.interview_id.label('interview_id'), *categories).join(
            table, table.id == evaluations.interview_id).where(table.owner_id == user_id).group_by(
            evaluations.interview_id).subquery()
        values = [scores.c[key] for key in ('accuracy', 'completeness', 'clarity', 'structure')]
        denominator = sum(case((value.is_not(None), 1), else_=0) for value in values)
        overall = func.round(sum(func.coalesce(value, 0) for value in values) / func.nullif(denominator, 0), 1)
        statement = statement.join(scores, scores.c.interview_id == table.id)
        if query.minScore is not None:
            statement = statement.where(overall >= query.minScore)
        if query.maxScore is not None:
            statement = statement.where(overall <= query.maxScore)
    total = session.scalar(select(func.count()).select_from(statement.subquery()))
    records = session.scalars(statement.order_by(table.started_at.desc(), table.id).offset(
        (query.page - 1) * query.pageSize).limit(query.pageSize))
    return HistoryPage(items=[Interview.model_validate(record.payload) for record in records],
                       total=total, page=query.page, pageSize=query.pageSize)
