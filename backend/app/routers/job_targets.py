"""Private reusable targets for tailoring interview setup."""
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from ..auth import CurrentUser
from ..database import JobTargetRecord
from ..models import Role

router = APIRouter(prefix='/job-targets', tags=['job targets'])
LIMIT = 20


class JobTargetInput(BaseModel):
    model_config = {'extra': 'forbid'}
    title: str = Field(min_length=1, max_length=120)
    company: str | None = Field(default=None, max_length=120)
    role: Role
    description: str = Field(default='', max_length=8000)

    @field_validator('title')
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Title cannot be blank.')
        return value

    @field_validator('company')
    @classmethod
    def clean_company(cls, value):
        value = value.strip() if value is not None else None
        return value or None


class JobTarget(JobTargetInput):
    id: str
    createdAt: datetime
    updatedAt: datetime


class JobTargetList(BaseModel):
    items: list[JobTarget]
    limit: int


def view(record: JobTargetRecord) -> JobTarget:
    return JobTarget(id=record.id, title=record.title, company=record.company, role=record.role,
        description=record.description,
        createdAt=datetime.fromtimestamp(record.created_at, timezone.utc),
        updatedAt=datetime.fromtimestamp(record.updated_at, timezone.utc))


def owned(store, owner_id: str, ident: str) -> JobTargetRecord:
    record = store.session.scalar(select(JobTargetRecord).where(
        JobTargetRecord.owner_id == owner_id, JobTargetRecord.id == ident))
    if record is None:
        raise HTTPException(404, 'Job target not found.')
    return record


@router.get('', response_model=JobTargetList)
def listing(request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        records = store.session.scalars(select(JobTargetRecord).where(
            JobTargetRecord.owner_id == user.id).order_by(JobTargetRecord.created_at, JobTargetRecord.id))
        return JobTargetList(items=[view(record) for record in records], limit=LIMIT)


@router.post('', response_model=JobTarget, status_code=201)
def create(data: JobTargetInput, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        count = store.session.scalar(select(func.count()).select_from(JobTargetRecord).where(
            JobTargetRecord.owner_id == user.id))
        if count >= LIMIT:
            raise HTTPException(409, 'You can save up to 20 job targets.')
        now = datetime.now(timezone.utc).timestamp()
        record = JobTargetRecord(id=str(uuid4()), owner_id=user.id, title=data.title,
            company=data.company, role=data.role, description=data.description, created_at=now, updated_at=now)
        store.session.add(record)
        store.session.flush()
        return view(record)


@router.get('/{ident}', response_model=JobTarget)
def get(ident: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        return view(owned(store, user.id, ident))


@router.put('/{ident}', response_model=JobTarget)
def update(ident: str, data: JobTargetInput, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        record = owned(store, user.id, ident)
        record.title = data.title
        record.company = data.company
        record.role = data.role
        record.description = data.description
        record.updated_at = datetime.now(timezone.utc).timestamp()
        return view(record)


@router.delete('/{ident}', status_code=204)
def remove(ident: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        store.session.delete(owned(store, user.id, ident))
    return Response(status_code=204)
