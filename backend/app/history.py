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
    searchMode: Literal['setup', 'transcript'] = 'setup'
    page: int = Field(default=1, ge=1)
    pageSize: int = Field(default=20, ge=1, le=100)

    @model_validator(mode='after')
    def ordered_bounds(self):
        if self.startDate and self.endDate and self.startDate > self.endDate:
            raise ValueError('startDate must not be after endDate')
        if self.minScore is not None and self.maxScore is not None and self.minScore > self.maxScore:
            raise ValueError('minScore must not exceed maxScore')
        if self.searchMode == 'transcript' and (not self.search or len(self.search.strip()) < 2):
            raise ValueError('transcript search must contain 2–200 characters')
        return self


class HistoryMatch(BaseModel):
    id: str
    sender: Literal['ai', 'you']
    snippet: str = Field(max_length=240)


class HistoryPage(BaseModel):
    items: list[Interview]
    total: int
    page: int
    pageSize: int
    matches: dict[str, list[HistoryMatch]] = Field(default_factory=dict)


def _transcript_match_filter(session, table, term):
    """Build a correlated JSON-array search that stays in the database."""
    dialect = session.get_bind().dialect.name
    if dialect == 'sqlite':
        messages = func.json_each(table.payload, '$.messages').table_valued(
            'key', 'value').alias('transcript_message')
        text = func.json_extract(messages.c.value, '$.text')
        sender = func.json_extract(messages.c.value, '$.from')
        folded_text = func.casefold(text)
        folded_term = term.casefold()
    elif dialect == 'postgresql':
        messages = func.json_array_elements(table.payload['messages']).table_valued(
            'value').alias('transcript_message')
        text = messages.c.value['text'].as_string()
        sender = messages.c.value['from'].as_string()
        folded_text = func.lower(text)
        folded_term = term.lower()
    else:
        raise RuntimeError(f'Transcript search is not supported for {dialect}')
    matching = select(1).select_from(messages).where(
        sender.in_(['ai', 'you']), folded_text.contains(folded_term, autoescape=True)
    ).correlate(table)
    return matching.exists()


def _snippet(text: str, term: str) -> str:
    folded = text.casefold()
    position = folded.find(term.casefold())
    if position < 0 or len(text) <= 240:
        return text[:240]
    start = max(0, min(position - 100, len(text) - 238))
    left = start > 0
    width = 240 - int(left) - int(start + 238 < len(text))
    start = max(0, min(position - (width // 2), len(text) - width))
    right = start + width < len(text)
    width = 240 - int(start > 0) - int(right)
    snippet = text[start:start + width]
    return ('…' if start else '') + snippet + ('…' if right else '')


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
    if query.search and query.searchMode == 'setup':
        term = query.search.lower()
        conditions.append(or_(func.lower(role).contains(term, autoescape=True),
            func.lower(func.coalesce(setup['jobDescription'].as_string(), '')).contains(term, autoescape=True)))
    elif query.search and query.searchMode == 'transcript':
        conditions.append(_transcript_match_filter(session, table, query.search.strip()))
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
    items = [Interview.model_validate(record.payload) for record in records]
    matches = {}
    if query.search and query.searchMode == 'transcript':
        term = query.search.strip()
        for interview in items:
            found = []
            for message in interview.messages:
                if message.sender in ('ai', 'you') and term.casefold() in message.text.casefold():
                    found.append(HistoryMatch(id=message.id, sender=message.sender,
                                              snippet=_snippet(message.text, term)))
            if found:
                matches[interview.id] = found
    return HistoryPage(items=items, total=total, page=query.page, pageSize=query.pageSize,
                       matches=matches)
