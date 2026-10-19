from fastapi import APIRouter, HTTPException, Request, Response

from ..auth import CurrentUser
from ..models import CODING_LANGUAGES, CODING_ROLES, Answer, Interview, InterviewReport, InterviewSetup
from ..store import answer_text, message, now
from ..services.difficulty import transition as difficulty_transition
from ..services import ai_service

router = APIRouter(prefix='/interviews', tags=['interviews'])


@router.post('', response_model=Interview, response_model_exclude_none=False, status_code=201)
def start(data: InterviewSetup, request: Request, user: CurrentUser):
    first_question = ai_service.generate_question(data.role, data.level, [],
        interview_type=data.type, job_description=data.jobDescription,
        practice_topic=data.practiceTopic)
    store = request.app.state.store
    with store.transaction() as store:
        interview = store.start(user.id, data, first_question=first_question)
        return interview.model_copy(deep=True)


@router.get('', response_model=list[Interview])
def history(request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.transaction() as store:
        return store.history(user.id)


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
