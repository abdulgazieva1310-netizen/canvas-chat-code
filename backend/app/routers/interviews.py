from fastapi import APIRouter, HTTPException, Request

from ..auth import CurrentUser
from ..models import Answer, Interview, InterviewReport, InterviewSetup
from ..store import message, now, report
from ..services import ai_service

router = APIRouter(prefix='/interviews', tags=['interviews'])


@router.post('', response_model=Interview, response_model_exclude_none=False, status_code=201)
def start(data: InterviewSetup, request: Request, user: CurrentUser):
    first_question = ai_service.generate_question(data.role, data.level, [],
        interview_type=data.type, job_description=data.jobDescription)
    store = request.app.state.store
    with store.transaction() as store:
        return store.start(user.id, data, first_question=first_question).model_copy(deep=True)


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


@router.post('/{interviewId}/messages', response_model=Interview)
def answer(interviewId: str, data: Answer, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if interview.status != 'active':
            raise HTTPException(409, 'This interview has ended.')
        next_question = None
        if interview.answeredCount + 1 < interview.setup.questionCount:
            setup = interview.setup
            conversation = [*interview.messages, message(interviewId, 'you', data.text.strip())]
            next_question = ai_service.generate_question(setup.role, setup.level, conversation,
                interview_type=setup.type, job_description=setup.jobDescription)
        return store.answer(interview, data.text, next_question=next_question).model_copy(deep=True)


@router.post('/{interviewId}/hint', response_model=Interview)
def hint(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.transaction() as store:
        interview = store.find(user.id, interviewId)
        if interview.status != 'active' or interview.setup.mode != 'Practice':
            raise HTTPException(409, 'Hints are only available during active Practice interviews.')
        interview.messages.append(message(interviewId, 'hint', 'Use a concrete example, explain your reasoning, and summarize the outcome.'))
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
        return InterviewReport(interview=interview.model_copy(deep=True), feedback=report(interview))
