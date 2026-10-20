"""Bounded, read-only account archives with explicit public-field allowlists."""
import json
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select
from .database import (AnswerEvaluationRecord, EvaluationFeedbackRecord, JobTargetRecord, InterviewRecord,
                       InterviewMediaRecord, StudyQuestionRecord)
from .models import AnswerEvaluation, Interview

MAX_ARCHIVE_BYTES = 10 * 1024 * 1024


def archive(store, user):
    # One transaction/read snapshot; never serialize auth or ORM records wholesale.
    dialect = store.session.get_bind().dialect.name
    if dialect == 'sqlite':
        # sqlite3 legacy transaction control does not begin a snapshot for SELECT.
        store.session.connection().exec_driver_sql('BEGIN')
    elif dialect == 'postgresql':
        store.session.connection(execution_options={'isolation_level': 'REPEATABLE READ'})
    records = store.session.scalars(select(InterviewRecord).where(InterviewRecord.owner_id == user.id)
                                   .order_by(InterviewRecord.started_at, InterviewRecord.id)).all()
    interviews = [Interview.model_validate(record.payload) for record in records]
    if any(i.status == 'active' and i.setup.mode == 'Real Interview' for i in interviews):
        raise HTTPException(409, 'End active Real Interviews before exporting saved feedback.')
    ids = [i.id for i in interviews]
    evaluations = store.session.scalars(select(AnswerEvaluationRecord).where(
        AnswerEvaluationRecord.interview_id.in_(ids)).order_by(AnswerEvaluationRecord.answer_id)).all() if ids else []
    notes = store.session.scalars(select(StudyQuestionRecord).where(StudyQuestionRecord.owner_id == user.id)
                                 .order_by(StudyQuestionRecord.saved_at, StudyQuestionRecord.id)).all()
    evaluation_feedback = store.session.scalars(select(EvaluationFeedbackRecord).where(
        EvaluationFeedbackRecord.owner_id == user.id).order_by(EvaluationFeedbackRecord.updated_at,
                                                                EvaluationFeedbackRecord.answer_id)).all()
    job_targets = store.session.scalars(select(JobTargetRecord).where(JobTargetRecord.owner_id == user.id)
                                        .order_by(JobTargetRecord.created_at, JobTargetRecord.id)).all()
    media = store.session.scalars(select(InterviewMediaRecord).where(InterviewMediaRecord.owner_id == user.id)
                                 .order_by(InterviewMediaRecord.id)).all()
    result = {
        'schemaVersion': 1, 'exportedAt': datetime.now(timezone.utc).isoformat(),
        'profile': user.model_dump(mode='json'),
        'interviews': [i.model_dump(mode='json', by_alias=True) for i in interviews],
        'evaluations': [{'answerId': row.answer_id, 'interviewId': row.interview_id, 'questionId': row.question_id,
                         'feedback': AnswerEvaluation.model_validate(row.result).model_dump(mode='json') if row.result else None}
                        for row in evaluations],
        'learningPlan': store.dashboard_summary(user.id).model_dump(mode='json'),
        'studyQuestions': [{'id': row.id, 'interviewId': row.interview_id, 'questionId': row.question_id,
                            'note': row.note, 'savedAt': row.saved_at} for row in notes],
        'evaluationFeedback': [{'answerId': row.answer_id, 'interviewId': row.interview_id,
                                'questionId': row.question_id, 'rating': row.rating, 'category': row.category,
                                'comment': row.comment, 'provenance': row.provenance,
                                'provenanceStatus': 'unknown', 'updatedAt': row.updated_at}
                               for row in evaluation_feedback],
        'jobTargets': [{'id': row.id, 'title': row.title, 'company': row.company, 'role': row.role,
                        'description': row.description, 'createdAt': row.created_at, 'updatedAt': row.updated_at}
                       for row in job_targets],
        'media': [{'id': row.id, 'interviewId': row.interview_id, 'mediaType': row.media_type,
                   'sizeBytes': row.size_bytes, 'createdAt': row.created_at, 'expiresAt': row.expires_at} for row in media],
        'mediaBytesIncluded': False,
    }
    # Stop encoding at the bound; never return a truncated file.
    chunks, size = [], 0
    for chunk in json.JSONEncoder(ensure_ascii=False).iterencode(result):
        encoded = chunk.encode('utf-8')
        size += len(encoded)
        if size > MAX_ARCHIVE_BYTES:
            raise HTTPException(413, 'Account archive exceeds the 10 MiB synchronous download limit.')
        chunks.append(encoded)
    return b''.join(chunks)
