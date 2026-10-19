import os
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from typing import Annotated
from sqlalchemy import select
from ..history import HistoryPage, HistoryQuery, history_page
from sqlalchemy.exc import IntegrityError
from ..database import InterviewStartRecord

from ..auth import CurrentUser
from ..database import InterviewMediaConsentRecord, InterviewMediaRecord
from ..models import (CODING_LANGUAGES, CODING_ROLES, Answer, CodeRunRequest,
                      CodeRunResult, Interview, InterviewMediaInfo, InterviewMediaList,
                      InterviewReport, InterviewSetup, MediaConsentRequest)
from ..media_storage import (ALLOWED_MEDIA_TYPES, MAX_MEDIA_BYTES, RETENTION_DAYS,
                             ensure_media_root, media_path, remove_media_file)
from ..store import answer_text, message, now
from ..services.difficulty import transition as difficulty_transition
from ..services import ai_service
from ..services.question_bank import load_bank

router = APIRouter(prefix='/interviews', tags=['interviews'])
RUNNABLE_LANGUAGES = frozenset({'Python', 'Java', 'C++', 'JavaScript', 'TypeScript'})
JUDGE_CASES = {
    'balanced-brackets-v1': [
        ('normal', '{}[]\n', 'true\n'),
        ('normal', '{[}]\n', 'false\n'),
        ('boundary', '\n', 'true\n'),
        ('boundary', '(((())))\n', 'true\n'),
        ('invalid-input', '(a)\n', 'false\n'),
    ]
}


def judge_code(language, code, judge_key):
    cases = JUDGE_CASES[judge_key]
    url = os.getenv('CODING_RUNNER_URL', '').strip().rstrip('/')
    token = os.getenv('CODING_RUNNER_TOKEN', '').strip()
    if not url or not token:
        return {'status': 'unavailable', 'passed': 0, 'total': len(cases),
                'summary': 'Automated correctness checks are unavailable; AI coaching feedback is still provided.'}
    passed = 0
    for category, private_input, expected in cases:
        try:
            response = httpx.post(f'{url}/run', json={'language': language, 'code': code, 'stdin': private_input},
                headers={'Authorization': f'Bearer {token}'}, timeout=httpx.Timeout(12.0, connect=2.0))
            response.raise_for_status()
            result = CodeRunResult.model_validate(response.json())
        except (httpx.HTTPError, ValueError):
            return {'status': 'unavailable', 'passed': passed, 'total': len(cases),
                    'summary': 'Automated correctness checks are temporarily unavailable; AI coaching feedback is still provided.'}
        if result.status == 'compile-error':
            return {'status': 'compile-error', 'passed': 0, 'total': len(cases),
                    'summary': 'The submitted solution could not be compiled.'}
        if result.status == 'timeout':
            return {'status': 'timeout', 'passed': passed, 'total': len(cases),
                    'summary': 'The solution exceeded the execution time limit.'}
        if result.status != 'success':
            return {'status': 'runtime-error', 'passed': passed, 'total': len(cases),
                    'summary': 'The solution stopped with a runtime error.'}
        if result.stdout == expected:
            passed += 1
    status = 'passed' if passed == len(cases) else 'failed'
    summary = ('All reviewed correctness checks passed.' if status == 'passed' else
               f'{len(cases) - passed} reviewed correctness check(s) failed. Review bracket matching, empty input, and invalid characters.')
    return {'status': status, 'passed': passed, 'total': len(cases), 'summary': summary}


def purge_expired_media(repository, *, now_timestamp=None):
    current = time.time() if now_timestamp is None else now_timestamp
    expired = repository.session.scalars(select(InterviewMediaRecord).where(
        InterviewMediaRecord.expires_at <= current)).all()
    for item in expired:
        try:
            remove_media_file(item.storage_key)
        except OSError:
            continue
        repository.session.delete(item)
    return len(expired)


def media_info(record):
    return InterviewMediaInfo(id=record.id, mediaType=record.media_type,
        sizeBytes=record.size_bytes,
        createdAt=datetime.fromtimestamp(record.created_at, timezone.utc),
        expiresAt=datetime.fromtimestamp(record.expires_at, timezone.utc))


@router.post('/{interviewId}/media/consent', status_code=204)
def set_media_consent(interviewId: str, data: MediaConsentRequest, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if interview.status != 'active':
            raise HTTPException(409, 'Recording consent can only be changed during an active interview.')
        existing = store.session.get(InterviewMediaConsentRecord, interviewId)
        if not data.consented:
            records = store.session.scalars(select(InterviewMediaRecord).where(
                InterviewMediaRecord.interview_id == interviewId,
                InterviewMediaRecord.owner_id == user.id)).all()
            for item in records:
                remove_media_file(item.storage_key)
                store.session.delete(item)
            if existing:
                store.session.delete(existing)
            return Response(status_code=204)
        if existing is None:
            store.session.add(InterviewMediaConsentRecord(interview_id=interviewId,
                owner_id=user.id, consented_at=time.time()))
    return Response(status_code=204)


@router.post('/{interviewId}/media', response_model=InterviewMediaInfo, status_code=201)
async def upload_interview_media(interviewId: str, request: Request, user: CurrentUser):
    media_type = request.headers.get('content-type', '').split(';', 1)[0].strip().lower()
    if media_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(415, 'Use a supported WebM or MP4 audio/video recording.')
    content_length = request.headers.get('content-length')
    if content_length:
        try:
            if int(content_length) > MAX_MEDIA_BYTES:
                raise HTTPException(413, 'Recording exceeds the 100 MB limit.')
        except ValueError as exc:
            raise HTTPException(400, 'Invalid upload size.') from exc
    with request.app.state.store.transaction() as store:
        store.find(user.id, interviewId)
        consent = store.session.get(InterviewMediaConsentRecord, interviewId)
        if consent is None or consent.owner_id != user.id:
            raise HTTPException(409, 'Give recording consent before uploading media.')
    chunks = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_MEDIA_BYTES:
            raise HTTPException(413, 'Recording exceeds the 100 MB limit.')
        chunks.append(chunk)
    payload = b''.join(chunks)
    if not payload:
        raise HTTPException(413, 'Recording must be non-empty and no larger than 100 MB.')
    ident = str(uuid4())
    path = media_path(ident)
    try:
        with path.open('xb') as media_file:
            os.chmod(path, 0o600)
            media_file.write(payload)
        with request.app.state.store.transaction() as store:
            interview = store.find(user.id, interviewId)
            consent = store.session.get(InterviewMediaConsentRecord, interviewId)
            if consent is None or consent.owner_id != user.id:
                raise HTTPException(409, 'Give recording consent before uploading media.')
            purge_expired_media(store)
            existing = store.session.scalars(select(InterviewMediaRecord).where(
                InterviewMediaRecord.interview_id == interviewId,
                InterviewMediaRecord.owner_id == user.id)).all()
            if len(existing) >= 3:
                raise HTTPException(409, 'This interview already has the maximum of three recordings.')
            created = time.time()
            record = InterviewMediaRecord(id=ident, interview_id=interviewId,
                owner_id=user.id, storage_key=ident, media_type=media_type,
                size_bytes=len(payload), created_at=created,
                expires_at=created + RETENTION_DAYS * 86400)
            store.session.add(record)
            response = media_info(record)
        return response
    except BaseException:
        path.unlink(missing_ok=True)
        raise


@router.get('/{interviewId}/media', response_model=InterviewMediaList)
def list_interview_media(interviewId: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        store.find(user.id, interviewId)
        purge_expired_media(store)
        records = store.session.scalars(select(InterviewMediaRecord).where(
            InterviewMediaRecord.interview_id == interviewId,
            InterviewMediaRecord.owner_id == user.id).order_by(InterviewMediaRecord.created_at)).all()
        return InterviewMediaList(retentionDays=RETENTION_DAYS,
            media=[media_info(record) for record in records])


@router.get('/{interviewId}/media/{mediaId}')
def play_interview_media(interviewId: str, mediaId: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        store.find(user.id, interviewId)
        purge_expired_media(store)
        record = store.session.scalar(select(InterviewMediaRecord).where(
            InterviewMediaRecord.id == mediaId,
            InterviewMediaRecord.interview_id == interviewId,
            InterviewMediaRecord.owner_id == user.id))
        if record is None:
            raise HTTPException(404, 'Recording not found.')
        path = media_path(record.storage_key)
        if not path.is_file():
            raise HTTPException(404, 'Recording is no longer available.')
        return FileResponse(path, media_type=record.media_type,
            headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})


@router.delete('/{interviewId}/media/{mediaId}', status_code=204)
def delete_interview_media(interviewId: str, mediaId: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        store.find(user.id, interviewId)
        record = store.session.scalar(select(InterviewMediaRecord).where(
            InterviewMediaRecord.id == mediaId,
            InterviewMediaRecord.interview_id == interviewId,
            InterviewMediaRecord.owner_id == user.id))
        if record is None:
            raise HTTPException(404, 'Recording not found.')
        remove_media_file(record.storage_key)
        store.session.delete(record)
    return Response(status_code=204)


@router.post('/{interviewId}/run', response_model=CodeRunResult)
def run_code(interviewId: str, data: CodeRunRequest, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if interview.status != 'active':
            raise HTTPException(409, 'Code can only be run in an active interview.')
        if interview.setup.type != 'Technical' or interview.setup.role not in CODING_ROLES:
            raise HTTPException(409, 'Code execution is only available in technical coding interviews.')
        if data.language not in RUNNABLE_LANGUAGES:
            raise HTTPException(422, 'This coding language is not supported by the runner.')

    runner_url = os.getenv('CODING_RUNNER_URL', '').strip().rstrip('/')
    runner_token = os.getenv('CODING_RUNNER_TOKEN', '').strip()
    if not runner_url or not runner_token:
        return CodeRunResult(status='unavailable', stderr='Code runner is not configured. Static AI review remains available when you submit your answer.')
    try:
        response = httpx.post(
            f'{runner_url}/run',
            json={'language': data.language, 'code': data.code},
            headers={'Authorization': f'Bearer {runner_token}'},
            timeout=httpx.Timeout(12.0, connect=2.0),
        )
        if response.status_code == 429:
            return CodeRunResult(status='unavailable', stderr='The code runner is busy. Try again shortly.')
        response.raise_for_status()
        return CodeRunResult.model_validate(response.json())
    except (httpx.HTTPError, ValueError):
        return CodeRunResult(status='unavailable', stderr='The code runner is temporarily unavailable. Static AI review remains available when you submit your answer.')


@router.post('', response_model=Interview, response_model_exclude_none=False, status_code=201)
def start(data: InterviewSetup, request: Request, user: CurrentUser):
    key = request.headers.get('Idempotency-Key')
    if key is not None and (not key.strip() or len(key) > 128):
        raise HTTPException(400, 'Idempotency-Key must contain 1–128 characters.')
    def previous(store):
        record = store.session.get(InterviewStartRecord, (user.id, key))
        if record is None:
            return None
        if record.setup != data.model_dump(mode='json'):
            raise HTTPException(409, 'This start key was already used with different settings.')
        try:
            return store.find(user.id, record.interview_id).model_copy(deep=True)
        except HTTPException as exc:
            if exc.status_code == 404:
                raise HTTPException(409, 'The interview created by this request was deleted.') from exc
            raise
    if key:
        with request.app.state.store.transaction() as store:
            existing = previous(store)
            if existing is not None:
                return existing
    judged_question = None
    if (data.type == 'Technical' and data.role in CODING_ROLES and data.level == 'Junior'
            and not data.practiceTopic):
        judged_question = next((item for item in load_bank() if item.id == 'coding-junior-balanced'), None)
    first_question = (judged_question.candidate_prompt(data.role) if judged_question else
        ai_service.generate_question(data.role, data.level, [], interview_type=data.type,
            job_description=data.jobDescription, practice_topic=data.practiceTopic))
    store = request.app.state.store
    try:
        with store.transaction() as repository:
            interview = repository.start(user.id, data, first_question=first_question)
            if judged_question:
                interview.messages[0].codingQuestionId = judged_question.id
                repository.save(interview)
            if key:
                repository.session.add(InterviewStartRecord(owner_id=user.id, key=key,
                    setup=data.model_dump(mode='json'), interview_id=interview.id))
            return interview.model_copy(deep=True)
    except IntegrityError:
        if key:
            with store.transaction() as repository:
                existing = previous(repository)
                if existing is not None:
                    return existing
        raise


@router.get('', response_model=HistoryPage)
def history(request: Request, user: CurrentUser, query: Annotated[HistoryQuery, Query()]):
    store = request.app.state.store
    with store.transaction() as store:
        return history_page(store.session, user.id, query)


@router.get('/{interviewId}', response_model=Interview)
def get(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.transaction() as store:
        return store.find(user.id, interviewId).model_copy(deep=True)


@router.post('/{interviewId}/resume', response_model=Interview)
def resume(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.transaction() as store:
        return store.resume(store.find(user.id, interviewId)).model_copy(deep=True)


@router.delete('/{interviewId}', status_code=204)
def delete(interviewId: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        store.delete(user.id, interviewId)
    return Response(status_code=204)


@router.post('/{interviewId}/messages', response_model=Interview)
def answer(interviewId: str, data: Answer, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.transaction() as store:
        interview = store.find(user.id, interviewId)
        current_question_message = next(m for m in reversed(interview.messages) if m.sender == 'ai')
        submitted = answer_text(interview.setup, data.text)
        if data.expectedQuestionId:
            accepted_answer_id = store.accepted_answer(interviewId, data.expectedQuestionId)
            if accepted_answer_id:
                accepted_answer = next((m for m in interview.messages if m.id == accepted_answer_id), None)
                if accepted_answer and accepted_answer.text == submitted:
                    return interview.model_copy(deep=True)
            if data.expectedQuestionId != current_question_message.id:
                raise HTTPException(409, 'The pending question changed. Reload the interview before answering.')
        if interview.status != 'active':
            raise HTTPException(409, 'This interview has ended.')
        current_question = next(m.text for m in reversed(interview.messages) if m.sender == 'ai')
        main_question_id = current_question_message.mainQuestionId or current_question_message.id
        language = None
        if interview.setup.type == 'Technical' and interview.setup.role in CODING_ROLES:
            language = data.selectedLanguage or {**CODING_LANGUAGES,
                'Backend Developer': 'Python', 'Full Stack Developer': 'JavaScript'}[interview.setup.role]
        evaluation = (ai_service.evaluate_answer(current_question, submitted, language=language)
                      if language else ai_service.evaluate_answer(current_question, submitted))
        setup = interview.setup
        coding_judge = None
        if current_question_message.codingQuestionId:
            coding_judge = judge_code(language or data.selectedLanguage or 'Python', data.text,
                                      'balanced-brackets-v1')
        current_level = interview.effectiveLevel or setup.level
        is_main_answer = current_question_message.kind == 'main'
        already_adjusted = any(
            decision.questionId == main_question_id for decision in interview.difficultyDecisions)
        next_level = current_level if already_adjusted or not is_main_answer else difficulty_transition(
            current_level, evaluation)[0]
        follow_up = (ai_service.generate_followup(setup.role, next_level, setup.type,
            current_question, submitted) if is_main_answer else None)
        next_question = None
        if not follow_up:
            answered_after = interview.answeredCount + int(is_main_answer)
            if answered_after < setup.questionCount:
                conversation = [*interview.messages, message(interviewId, 'you', submitted)]
                used_questions = [item.text for item in interview.messages
                                  if item.sender == 'ai' and item.kind == 'main']
                next_question = ai_service.generate_question(setup.role, next_level, conversation,
                    interview_type=setup.type, job_description=setup.jobDescription,
                    practice_topic=setup.practiceTopic, used_questions=used_questions)
        return store.answer(interview, data.text, next_question=follow_up or next_question,
            coding_judge=coding_judge,
            evaluation=evaluation, follow_up_parent_id=main_question_id if follow_up else None).model_copy(deep=True)


@router.post('/{interviewId}/hint', response_model=Interview)
def hint(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if interview.status != 'active' or interview.setup.mode != 'Practice':
            raise HTTPException(409, 'Hints are only available during active Practice interviews.')
        question_index = next(i for i in range(len(interview.messages) - 1, -1, -1)
                              if interview.messages[i].sender == 'ai')
        previous_hints = [m.text for m in interview.messages[question_index + 1:] if m.sender == 'hint']
        generated = ai_service.generate_hint(interview.messages[question_index].text, previous_hints,
            role=interview.setup.role, level=interview.setup.level, interview_type=interview.setup.type)
        interview.messages.append(message(interviewId, 'hint', generated or
            'AI hints are temporarily unavailable. Please try again shortly.'))
        store.save(interview)
        return interview.model_copy(deep=True)


@router.post('/{interviewId}/end', response_model=Interview)
def end(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if interview.status == 'active':
            interview.status = 'incomplete'
            interview.endedAt = now()
        store.save(interview)
        return interview.model_copy(deep=True)


@router.get('/{interviewId}/report', response_model=InterviewReport)
def get_report(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if interview.status == 'active':
            raise HTTPException(409, 'End the interview before viewing its report.')
        return InterviewReport(interview=interview.model_copy(deep=True), feedback=store.report(interview))
