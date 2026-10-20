"""Transactional account removal with durable, idempotent private-file cleanup."""
import logging
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import delete, select
from .auth import hasher
from .database import (UserRecord, TokenRecord, PasswordResetRecord, InterviewRecord,
    InterviewStartRecord, AnswerEvaluationRecord, InterviewMediaRecord,
    InterviewMediaConsentRecord, StudyQuestionRecord, MediaCleanupRecord)
from .media_storage import remove_media_file


def delete_owned_account(store, owner_id, password):
    user = store.session.scalar(select(UserRecord).where(UserRecord.id == owner_id).with_for_update())
    if user is None or not hasher.verify(password, user.password_hash):
        raise HTTPException(400, 'Current password is incorrect. No data was deleted.')
    interview_ids = select(InterviewRecord.id).where(InterviewRecord.owner_id == owner_id)
    keys = store.session.scalars(select(InterviewMediaRecord.storage_key).where(InterviewMediaRecord.owner_id == owner_id)).all()
    for key in keys:
        store.session.add(MediaCleanupRecord(storage_key=key, created_at=datetime.now(timezone.utc).timestamp()))
    store.session.flush()
    for model in (StudyQuestionRecord, InterviewMediaRecord, InterviewMediaConsentRecord):
        store.session.execute(delete(model).where(model.owner_id == owner_id))
    store.session.execute(delete(AnswerEvaluationRecord).where(AnswerEvaluationRecord.interview_id.in_(interview_ids)))
    store.session.execute(delete(InterviewStartRecord).where(InterviewStartRecord.owner_id == owner_id))
    store.session.execute(delete(InterviewRecord).where(InterviewRecord.owner_id == owner_id))
    store.session.execute(delete(TokenRecord).where(TokenRecord.user_id == owner_id))
    store.session.execute(delete(PasswordResetRecord).where(PasswordResetRecord.user_id == owner_id))
    store.session.execute(delete(UserRecord).where(UserRecord.id == owner_id))


def retry_media_cleanup(store):
    with store.transaction() as repository:
        records = repository.session.scalars(select(MediaCleanupRecord).order_by(
            MediaCleanupRecord.created_at, MediaCleanupRecord.storage_key).limit(100)).all()
        for record in records:
            try:
                remove_media_file(record.storage_key)
            except (OSError, ValueError):
                logging.getLogger(__name__).warning('Private media file cleanup deferred; durable retry retained')
            else:
                repository.session.delete(record)
