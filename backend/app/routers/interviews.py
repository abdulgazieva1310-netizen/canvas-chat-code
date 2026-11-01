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
from ..database import InterviewMediaConsentRecord, InterviewMediaRecord, MediaCleanupRecord
from ..models import (CODING_LANGUAGES, CODING_ROLES, Answer, CodeRunRequest,
                      CodeRunResult, Interview, InterviewMediaInfo, InterviewMediaList,
                      InterviewReport, InterviewSetup, MediaConsentRequest)
from ..media_storage import (ALLOWED_MEDIA_TYPES, MAX_MEDIA_BYTES, RETENTION_DAYS,
                             ensure_media_root, media_path, remove_media_file)
from ..store import answer_text, message, now, question as curated_question
from ..services.difficulty import transition as difficulty_transition
from ..services import ai_service
from ..services.coding_specs import JUDGE_CASES, PUBLIC_CASES, reviewed_judge_key
from ..services.question_bank import load_bank

router = APIRouter(prefix='/interviews', tags=['interviews'])
RUNNABLE_LANGUAGES = frozenset({'Python', 'Java', 'C++', 'JavaScript', 'TypeScript'})
JUDGED_QUESTION_BY_ROLE = {
    'Backend Developer': 'coding-junior-balanced',
    'Python Developer': 'coding-junior-first-repeat',
    'Java Developer': 'coding-junior-runs',
    'C++ Developer': 'coding-junior-merge-sorted',
    'Full Stack Developer': 'coding-junior-first-repeat',
}

def judge_code(language, code, judge_key, *, public_only=False):
    cases = (PUBLIC_CASES if public_only else JUDGE_CASES).get(judge_key)
    if not cases or language not in RUNNABLE_LANGUAGES:
        return {'status': 'unavailable', 'passed': 0, 'total': 1,
                'summary': 'This question has no reviewed tests. Static AI review remains available.'}
    url = os.getenv('CODING_RUNNER_URL', '').strip().rstrip('/')
    token = os.getenv('CODING_RUNNER_TOKEN', '').strip()
    if not url or not token:
        return {'status': 'unavailable', 'passed': 0, 'total': len(cases),
                'summary': 'Automated correctness checks are unavailable. Static AI review remains available when you submit your answer.'}
    passed = 0
    deadline = time.monotonic() + 45
    for category, private_input, expected in cases:
        if time.monotonic() >= deadline:
            return {'status': 'unavailable', 'passed': passed, 'total': len(cases),
                    'summary': 'The execution service exceeded its judging budget. Static AI review remains available.'}
        try:
            response = httpx.post(f'{url}/run', json={'language': language, 'code': code, 'stdin': private_input},
                headers={'Authorization': f'Bearer {token}'}, timeout=httpx.Timeout(min(19.0, max(.1, deadline - time.monotonic())), connect=2.0))
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
        if result.status in {'resource-limit', 'output-limit'}:
            return {'status': 'resource-limit', 'passed': passed, 'total': len(cases),
                    'summary': 'The solution exceeded a resource limit.'}
        if result.status == 'unavailable':
            return {'status': 'unavailable', 'passed': passed, 'total': len(cases),
                    'summary': 'Automated correctness checks are temporarily unavailable; AI coaching feedback is still provided.'}
        if result.status != 'success':
            return {'status': 'runtime-error', 'passed': passed, 'total': len(cases),
                    'summary': 'The solution stopped with a runtime error.'}
        if result.stdout == expected:
            passed += 1
    status = 'passed' if passed == len(cases) else 'failed'
    summary = ('All reviewed correctness checks passed.' if status == 'passed' else
               f'{len(cases) - passed} reviewed correctness check(s) failed. Review the problem contract and boundary cases.')
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


def retire_media(repository, record):
    try:
        remove_media_file(record.storage_key)
    except OSError:
        # Revoke access transactionally even if physical deletion needs retry.
        if repository.session.get(MediaCleanupRecord, record.storage_key) is None:
            repository.session.add(MediaCleanupRecord(storage_key=record.storage_key, created_at=time.time()))
    repository.session.delete(record)


def media_info(record):
    return InterviewMediaInfo(id=record.id, mediaType=record.media_type,
        sizeBytes=record.size_bytes,
        createdAt=datetime.fromtimestamp(record.created_at, timezone.utc),
        expiresAt=datetime.fromtimestamp(record.expires_at, timezone.utc))


@router.post('/{interviewId}/media/consent', status_code=204)
def set_media_consent(interviewId: str, data: MediaConsentRequest, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if data.consented and interview.status != 'active':
            raise HTTPException(409, 'Recording consent can only be changed during an active interview.')
        existing = store.session.get(InterviewMediaConsentRecord, interviewId)
        if not data.consented:
            records = store.session.scalars(select(InterviewMediaRecord).where(
                InterviewMediaRecord.interview_id == interviewId,
                InterviewMediaRecord.owner_id == user.id)).all()
            for item in records:
                retire_media(store, item)
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
        raise HTTPException(415, 'Use a supported WebM or MP4 audio recording. Video uploads are not accepted.')
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
            InterviewMediaRecord.owner_id == user.id,
            InterviewMediaRecord.expires_at > time.time()).order_by(InterviewMediaRecord.created_at)).all()
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
        if record is None or record.expires_at <= time.time():
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
        retire_media(store, record)
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

        current = next(m for m in reversed(interview.messages) if m.sender == 'ai')
        if store.accepted_answer(interviewId, current.id):
            raise HTTPException(409, 'Request the next question before running more code.')
        judge_key = reviewed_judge_key(current, data.language)
        if not judge_key:
            return CodeRunResult(status='unavailable', stderr='This question has no reviewed execution specification. Static AI review remains available when you submit your answer.')

    checked = judge_code(data.language, data.code, judge_key, public_only=True)
    # Only bounded summaries are returned. Hidden inputs and program output stay private.
    return CodeRunResult(status=checked['status'],
        stdout=(f"{checked['passed']} of {checked['total']} public examples passed."
                if checked['status'] in {'passed', 'failed'} else ''),
        stderr=checked['summary'] if checked['status'] not in {'passed', 'failed'} else '')


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
    if data.language == 'Russian' and not ai_service.provider_supports_language(data.language):
        raise HTTPException(503, 'Russian interviews are unavailable: enable the Russian preview with the supported provider, or select English.')
    judged_question = None
    if (data.type == 'Technical' and data.role in CODING_ROLES and data.level == 'Junior'
            and not data.practiceTopic and data.language == 'English'):
        question_id = JUDGED_QUESTION_BY_ROLE.get(data.role)
        judged_question = next((item for item in load_bank() if item.id == question_id), None)
    if judged_question:
        first_question = judged_question.candidate_prompt(data.role)
    else:
        question_options = {'interview_language': data.language} if data.language != 'English' else {}
        first_question = ai_service.generate_question(data.role, data.level, [], interview_type=data.type,
            job_description=data.jobDescription, practice_topic=data.practiceTopic, **question_options)
    if data.language == 'Russian' and not first_question:
        raise HTTPException(503, 'The Russian question provider is temporarily unavailable. Select English or try again later.')
    store = request.app.state.store
    try:
        with store.transaction() as repository:
            interview = repository.start(user.id, data, first_question=first_question)
            if judged_question:
                interview.messages[0].codingQuestionId = judged_question.id
                interview.messages[0].codingQuestionVersion = judged_question.version
                interview.messages[0].codingJudgeSpecKey = judged_question.judgeKey
                interview.messages[0].codingJudgeSpecVersion = judged_question.judgeSpecVersion
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
        if store.accepted_answer(interviewId, current_question_message.id):
            raise HTTPException(409, 'This answer is already saved. Request the next question before answering again.')
        if interview.setup.language == 'Russian' and not ai_service.provider_supports_language('Russian'):
            raise HTTPException(503, 'Russian AI services are unavailable. Your answer was not saved; retry later or select English.')
        current_question = next(m.text for m in reversed(interview.messages) if m.sender == 'ai')
        main_question_id = current_question_message.mainQuestionId or current_question_message.id
        language = None
        if interview.setup.type == 'Technical' and interview.setup.role in CODING_ROLES:
            language = data.selectedLanguage or {**CODING_LANGUAGES,
                'Backend Developer': 'Python', 'Full Stack Developer': 'JavaScript'}[interview.setup.role]
        evaluation_options = {'interview_language': interview.setup.language} if interview.setup.language != 'English' else {}
        evaluation = (ai_service.evaluate_answer(current_question, submitted, language=language, **evaluation_options)
                      if language else ai_service.evaluate_answer(current_question, submitted, **evaluation_options))
        if interview.setup.language == 'Russian' and evaluation is None:
            raise HTTPException(503, 'Russian answer evaluation is temporarily unavailable. Your answer was not saved; retry or select English.')
        setup = interview.setup
        coding_judge = None
        judge_language = language or data.selectedLanguage or 'Python'
        judge_key = reviewed_judge_key(current_question_message, judge_language)
        if judge_key:
            coding_judge = judge_code(judge_language, data.text, judge_key)
        if setup.language == 'Russian':
            # Commit scores before the next-question provider request can fail.
            return store.answer(interview, data.text, evaluation=evaluation, coding_judge=coding_judge,
                                defer_next_question=True).model_copy(deep=True)
        current_level = interview.effectiveLevel or setup.level
        is_main_answer = current_question_message.kind == 'main'
        already_adjusted = any(
            decision.questionId == main_question_id for decision in interview.difficultyDecisions)
        next_level = current_level if already_adjusted or not is_main_answer else difficulty_transition(
            current_level, evaluation)[0]
        next_question = None
        answered_after = interview.answeredCount + int(is_main_answer)
        if answered_after < setup.questionCount:
            conversation = [item for item in interview.messages
                            if item.sender == 'ai' and item.kind == 'main']
            used_questions = [item.text for item in conversation]
            question_options = {'interview_language': setup.language} if setup.language != 'English' else {}
            next_question = ai_service.generate_question(setup.role, next_level, conversation,
                interview_type=setup.type, job_description=setup.jobDescription,
                practice_topic=setup.practiceTopic, used_questions=used_questions, **question_options)
            if ai_service.question_was_used(next_question, used_questions):
                next_question = ai_service.generate_question(setup.role, next_level, conversation,
                    interview_type=setup.type, job_description=setup.jobDescription,
                    practice_topic=setup.practiceTopic,
                    used_questions=[*used_questions, next_question], **question_options)
            if ai_service.question_was_used(next_question, used_questions):
                next_question = None
            if setup.language == 'Russian' and not next_question:
                raise HTTPException(503, 'The Russian question provider is temporarily unavailable. Your answer was not saved; retry or select English.')
        return store.answer(interview, data.text, next_question=next_question,
            coding_judge=coding_judge, evaluation=evaluation).model_copy(deep=True)


@router.post('/{interviewId}/next-question', response_model=Interview)
def next_question(interviewId: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if (interview.status != 'active' or not interview.messages
                or interview.messages[-1].sender != 'you'):
            return interview.model_copy(deep=True)
        if interview.setup.language != 'Russian':
            raise HTTPException(409, 'No question is pending for this interview.')
        setup = interview.setup
        if interview.answeredCount >= setup.questionCount:
            interview.status = 'complete'
            interview.endedAt = now()
            store.save(interview)
            return interview.model_copy(deep=True)
        level = interview.effectiveLevel or setup.level
        used_questions = [m.text for m in interview.messages if m.sender == 'ai' and m.kind == 'main']
        generated = ai_service.generate_question(setup.role, level, interview.messages,
            interview_type=setup.type, job_description=setup.jobDescription,
            practice_topic=setup.practiceTopic, interview_language='Russian',
            used_questions=used_questions)
        if ai_service.question_was_used(generated, used_questions):
            generated = ai_service.generate_question(setup.role, level, interview.messages,
                interview_type=setup.type, job_description=setup.jobDescription,
                practice_topic=setup.practiceTopic, interview_language='Russian',
                used_questions=[*used_questions, generated])
        if ai_service.question_was_used(generated, used_questions):
            generated = None
        if not generated:
            english_question = ai_service.generate_question(setup.role, level, interview.messages,
                interview_type=setup.type, job_description=setup.jobDescription,
                practice_topic=setup.practiceTopic, interview_language='English',
                used_questions=used_questions)
            if (ai_service.question_was_used(english_question, used_questions)
                    or (english_question and ai_service.has_russian_text(english_question))):
                english_question = None
            if not english_question:
                english_setup = setup.model_copy(update={'language': 'English'})
                english_question = curated_question(english_setup, interview.answeredCount, level,
                    used_questions, interview.id)
            if english_question.startswith('No matching curated questions'):
                english_question = english_question.split('\n\n', 1)[1]
            translated = ai_service.translate_question_to_russian(english_question)
            if translated:
                generated = f'{translated}\n\nОригинал вопроса на английском:\n{english_question}'
            else:
                generated = ('Перевод вопроса временно недоступен. Вопрос на английском:\n'
                             f'{english_question}\n\nПожалуйста, ответьте на него по-русски.')
        interview.messages.append(message(interview.id, 'ai', generated))
        store.save(interview)
        return interview.model_copy(deep=True)


@router.post('/{interviewId}/hint', response_model=Interview)
def hint(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if interview.status != 'active' or interview.setup.mode != 'Practice':
            raise HTTPException(409, 'Hints are only available during active Practice interviews.')
        if interview.messages and interview.messages[-1].sender == 'you':
            raise HTTPException(409, 'Your answer is saved. Request the next question before asking for a hint.')
        if interview.setup.language == 'Russian' and not ai_service.provider_supports_language('Russian'):
            raise HTTPException(503, 'Russian AI hints are unavailable. Try again later or use the transcript.')
        question_index = next(i for i in range(len(interview.messages) - 1, -1, -1)
                              if interview.messages[i].sender == 'ai')
        previous_hints = [m.text for m in interview.messages[question_index + 1:] if m.sender == 'hint']
        generated = ai_service.generate_hint(interview.messages[question_index].text, previous_hints,
            role=interview.setup.role, level=interview.setup.level, interview_type=interview.setup.type,
            **({'interview_language': interview.setup.language}
               if interview.setup.language != 'English' else {}))
        if interview.setup.language == 'Russian' and not generated:
            raise HTTPException(503, 'Russian hints are temporarily unavailable. The transcript remains available; try again later.')
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


@router.get('/{interviewId}/report/export')
def export_report(interviewId: str, request: Request, user: CurrentUser):
    from ..report_export import markdown_report
    with request.app.state.store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if interview.status == 'active':
            raise HTTPException(409, 'End the interview before exporting its report.')
        text = markdown_report(interview, store.report(interview))
        # Date-only filenames never include user-controlled IDs or names.
        filename = f'interview-report-{interview.startedAt:%Y-%m-%d}.md'
    return Response(text, media_type='text/markdown', headers={
        'Content-Disposition': f'attachment; filename="{filename}"', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'})
