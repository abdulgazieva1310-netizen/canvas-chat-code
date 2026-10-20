"""Portable SQLAlchemy records and engine configuration."""
import os
from pathlib import Path

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, UniqueConstraint, create_engine, event
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


class PasswordResetRecord(Base):
    __tablename__ = 'password_resets'
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    expires_at: Mapped[float] = mapped_column(Float)


class InterviewStartRecord(Base):
    __tablename__ = 'interview_starts'
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id'), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    setup: Mapped[dict] = mapped_column(JSON)
    interview_id: Mapped[str] = mapped_column(String(36))


class InterviewRecord(Base):
    __tablename__ = 'interviews'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    started_at: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    __mapper_args__ = {'version_id_col': version}


class StudyQuestionRecord(Base):
    __tablename__ = 'study_questions'
    __table_args__ = (UniqueConstraint('owner_id', 'interview_id', 'question_id', name='uq_study_question'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    interview_id: Mapped[str] = mapped_column(ForeignKey('interviews.id'), index=True)
    question_id: Mapped[str] = mapped_column(String(36))
    note: Mapped[str] = mapped_column(String(4000))
    saved_at: Mapped[float] = mapped_column(Float)


class MediaCleanupRecord(Base):
    __tablename__ = 'media_cleanup'
    storage_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[float] = mapped_column(Float)


class AnswerEvaluationRecord(Base):
    __tablename__ = 'answer_evaluations'
    answer_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    interview_id: Mapped[str] = mapped_column(ForeignKey('interviews.id'), index=True)
    question_id: Mapped[str] = mapped_column(String(36))
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class EvaluationFeedbackRecord(Base):
    __tablename__ = 'evaluation_feedback'
    answer_id: Mapped[str] = mapped_column(ForeignKey('answer_evaluations.answer_id'), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    interview_id: Mapped[str] = mapped_column(ForeignKey('interviews.id'), index=True)
    question_id: Mapped[str] = mapped_column(String(36))
    rating: Mapped[str] = mapped_column(String(20))
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    comment: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    provenance: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[float] = mapped_column(Float)


class InterviewMediaConsentRecord(Base):
    __tablename__ = 'interview_media_consents'
    interview_id: Mapped[str] = mapped_column(ForeignKey('interviews.id'), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    consented_at: Mapped[float] = mapped_column(Float)


class InterviewMediaRecord(Base):
    __tablename__ = 'interview_media'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    interview_id: Mapped[str] = mapped_column(ForeignKey('interviews.id'), index=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    media_type: Mapped[str] = mapped_column(String(80))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[float] = mapped_column(Float)
    expires_at: Mapped[float] = mapped_column(Float, index=True)


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
