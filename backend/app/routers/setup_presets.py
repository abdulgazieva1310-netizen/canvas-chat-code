"""Private reusable presets for the existing Setup fields."""
from datetime import datetime, timezone
from unicodedata import normalize
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from ..auth import CurrentUser
from ..database import SetupPresetRecord
from ..models import InterviewLanguage, Level, Role

router = APIRouter(prefix='/setup-presets', tags=['setup presets'])
LIMIT = 20


def name_key(value: str) -> str:
    return normalize('NFKC', ' '.join(value.split())).casefold()


class SetupPresetInput(BaseModel):
    model_config = {'extra': 'forbid'}
    name: str = Field(min_length=1, max_length=80)
    role: Role
    level: Level
    type: str = Field(pattern='^(Technical|Behavioral|Role-specific)$')
    mode: str = Field(pattern='^(Practice|Real Interview)$')
    input: str = Field(pattern='^(Voice|Text)$')
    questionCount: int = Field(strict=True, ge=5, le=15)
    language: InterviewLanguage

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        value = ' '.join(value.split())
        if not value:
            raise ValueError('Preset name cannot be blank.')
        return value

    @field_validator('questionCount')
    @classmethod
    def validate_question_count(cls, value):
        if value not in (5, 10, 15):
            raise ValueError('Question count must be 5, 10, or 15.')
        return value


class SetupPreset(SetupPresetInput):
    id: str
    createdAt: datetime
    updatedAt: datetime


class SetupPresetList(BaseModel):
    items: list[SetupPreset]
    limit: int


def view(record: SetupPresetRecord) -> SetupPreset:
    return SetupPreset(id=record.id, name=record.name, role=record.role, level=record.level,
        type=record.type, mode=record.mode, input=record.input, questionCount=record.question_count,
        language=record.language, createdAt=datetime.fromtimestamp(record.created_at, timezone.utc),
        updatedAt=datetime.fromtimestamp(record.updated_at, timezone.utc))


def owned(store, owner_id: str, ident: str) -> SetupPresetRecord:
    record = store.session.scalar(select(SetupPresetRecord).where(
        SetupPresetRecord.id == ident, SetupPresetRecord.owner_id == owner_id))
    if record is None:
        raise HTTPException(404, 'Setup preset not found.')
    return record


def duplicate(store, owner_id: str, key: str, excluding: str | None = None) -> bool:
    query = select(SetupPresetRecord.id).where(
        SetupPresetRecord.owner_id == owner_id, SetupPresetRecord.name_key == key)
    if excluding:
        query = query.where(SetupPresetRecord.id != excluding)
    return store.session.scalar(query) is not None


def assign(record: SetupPresetRecord, data: SetupPresetInput) -> None:
    record.name = data.name
    record.name_key = name_key(data.name)
    record.role = data.role
    record.level = data.level
    record.type = data.type
    record.mode = data.mode
    record.input = data.input
    record.question_count = data.questionCount
    record.language = data.language
    record.updated_at = datetime.now(timezone.utc).timestamp()


@router.get('', response_model=SetupPresetList)
def listing(request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        records = store.session.scalars(select(SetupPresetRecord).where(
            SetupPresetRecord.owner_id == user.id).order_by(SetupPresetRecord.created_at, SetupPresetRecord.id))
        return SetupPresetList(items=[view(record) for record in records], limit=LIMIT)


@router.post('', response_model=SetupPreset, status_code=201)
def create(data: SetupPresetInput, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        count = store.session.scalar(select(func.count()).select_from(SetupPresetRecord).where(
            SetupPresetRecord.owner_id == user.id))
        if count >= LIMIT:
            raise HTTPException(409, 'You can save up to 20 setup presets.')
        key = name_key(data.name)
        if duplicate(store, user.id, key):
            raise HTTPException(409, 'A preset with this name already exists.')
        now = datetime.now(timezone.utc).timestamp()
        record = SetupPresetRecord(id=str(uuid4()), owner_id=user.id, name=data.name, name_key=key,
            role=data.role, level=data.level, type=data.type, mode=data.mode, input=data.input,
            question_count=data.questionCount, language=data.language, created_at=now, updated_at=now)
        store.session.add(record)
        store.session.flush()
        return view(record)


@router.get('/{ident}', response_model=SetupPreset)
def get(ident: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        return view(owned(store, user.id, ident))


@router.put('/{ident}', response_model=SetupPreset)
def update(ident: str, data: SetupPresetInput, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        record = owned(store, user.id, ident)
        key = name_key(data.name)
        if duplicate(store, user.id, key, excluding=ident):
            raise HTTPException(409, 'A preset with this name already exists.')
        assign(record, data)
        return view(record)


@router.delete('/{ident}', status_code=204)
def remove(ident: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        store.session.delete(owned(store, user.id, ident))
    return Response(status_code=204)
