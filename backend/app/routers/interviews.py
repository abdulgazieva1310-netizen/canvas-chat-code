from fastapi import APIRouter, HTTPException, Request

from ..auth import CurrentUser
from ..models import Answer, Interview, InterviewReport, InterviewSetup
from ..store import message, now, report

router = APIRouter(prefix='/interviews', tags=['interviews'])


@router.post('', response_model=Interview, response_model_exclude_none=False, status_code=201)
def start(data: InterviewSetup, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.lock:
        return store.start(user.id, data).model_copy(deep=True)


@router.get('', response_model=list[Interview])
def history(request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.lock:
        return [i.model_copy(deep=True) for i in sorted(store.interviews.values(), key=lambda i: i.startedAt, reverse=True)
                if store.owners[i.id] == user.id and i.status != 'active']


@router.get('/{interviewId}', response_model=Interview)
def get(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.lock:
        return store.find(user.id, interviewId).model_copy(deep=True)


@router.post('/{interviewId}/messages', response_model=Interview)
def answer(interviewId: str, data: Answer, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.lock:
        return store.answer(store.find(user.id, interviewId), data.text).model_copy(deep=True)


@router.post('/{interviewId}/hint', response_model=Interview)
def hint(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.lock:
        interview = store.find(user.id, interviewId)
        if interview.status != 'active' or interview.setup.mode != 'Practice':
            raise HTTPException(409, 'Hints are only available during active Practice interviews.')
        interview.messages.append(message(interviewId, 'hint', 'Use a concrete example, explain your reasoning, and summarize the outcome.'))
        return interview.model_copy(deep=True)


@router.post('/{interviewId}/end', response_model=Interview)
def end(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.lock:
        interview = store.find(user.id, interviewId)
        if interview.status == 'active':
            interview.status = 'incomplete'
            interview.endedAt = now()
        return interview.model_copy(deep=True)


@router.get('/{interviewId}/report', response_model=InterviewReport)
def get_report(interviewId: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    with store.lock:
        interview = store.find(user.id, interviewId)
        if interview.status == 'active':
            raise HTTPException(409, 'End the interview before viewing its report.')
        return InterviewReport(interview=interview.model_copy(deep=True), feedback=report(interview))
