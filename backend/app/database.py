"""Portable SQLAlchemy records and engine configuration."""
import os
from pathlib import Path

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


class UserRecord(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    profile: Mapped[dict] = mapped_column(JSON)


class TokenRecord(Base):
    __tablename__ = 'tokens'
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    expires_at: Mapped[float] = mapped_column(Float)


class InterviewRecord(Base):
    __tablename__ = 'interviews'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    started_at: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    __mapper_args__ = {'version_id_col': version}


class AnswerEvaluationRecord(Base):
    __tablename__ = 'answer_evaluations'
    answer_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    interview_id: Mapped[str] = mapped_column(ForeignKey('interviews.id'), index=True)
    question_id: Mapped[str] = mapped_column(String(36))
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)


def database_engine(url=None):
    default = 'sqlite:///' + str(Path(__file__).resolve().parents[1] / 'interview.db')
    url = make_url(url if url is not None else os.getenv('DATABASE_URL', default))
    options = {'pool_pre_ping': True}
    if url.get_backend_name() == 'sqlite':
        options['connect_args'] = {'check_same_thread': False}
        if url.database in (None, '', ':memory:'):
            options['poolclass'] = StaticPool
    engine = create_engine(url, **options)
    if url.get_backend_name() == 'sqlite':
        @event.listens_for(engine, 'connect')
        def configure_sqlite(connection, _):
            cursor = connection.cursor()
            cursor.execute('PRAGMA foreign_keys=ON')
            cursor.close()
    return engine
