"""Owner-scoped AI study plans grounded in selected saved reports."""
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select

from ..auth import CurrentUser
from ..database import StudyPlanRecord
from ..models import (EvidenceReference, StudyPlan, StudyPlanComparisonGroup, StudyPlanCreate,
                      StudyPlanItem, StudyPlanItemUpdate, StudyPlanList, StudyPlanSource)
from ..services import ai_service

router = APIRouter(prefix='/study-plans', tags=['study plans'])


def group_for(interview):
    setup = interview.setup
    return StudyPlanComparisonGroup(role=setup.role, type=setup.type, mode=setup.mode,
                                    level=setup.level, language=setup.language)


def build_evidence(store, owner_id, source_ids):
    if len(source_ids) != len(set(source_ids)):
        raise HTTPException(400, 'Choose each source report only once.')
    interviews = []
    reports = []
    comparison = None
    evidence = []
    refs = {}
    for report_index, interview_id in enumerate(source_ids, start=1):
        interview = store.find(owner_id, interview_id)
        if interview.status != 'complete':
            raise HTTPException(409, 'Study plans can use completed reports only.')
        current_group = group_for(interview)
        if comparison is None:
            comparison = current_group
        elif comparison != current_group:
            raise HTTPException(400, 'Choose reports from one role, type, mode, starting level, and language comparison group.')
        report = store.report(interview)
        if report.overall is None:
            raise HTTPException(422, 'Each selected report needs scored answers. Complete and score at least two compatible interviews first.')
        interviews.append(interview)
        reports.append(report)
        question_number = 0
        for question in report.questions:
            if question.scores is None:
                continue
            missing = question.miss.strip()
            if not missing or missing.casefold().startswith(('no supported', 'no specific', 'no actionable')):
                continue
            question_number += 1
            ref = f'R{report_index}Q{question_number}'
            refs[ref] = EvidenceReference(interviewId=interview.id, answerId=question.answerId)
            evidence.append({
                'ref': ref,
                'question': question.q[:1600],
                'score': question.score,
                'feedback': missing[:1000],
                'practiceTopics': question.practiceTopics[:3],
            })
    if len(interviews) < 2 or comparison is None:
        raise HTTPException(422, 'Select at least two completed reports from one comparison group.')
    if len(evidence) < 2:
        raise HTTPException(422, 'There is not enough actionable scored feedback yet. Complete and score more answers before generating a plan.')
    return interviews, reports, comparison, evidence, refs


def public(store, record):
    sources = []
    for interview_id in record.source_interview_ids:
        interview = store.find(record.owner_id, interview_id)
        report = store.report(interview)
        sources.append(StudyPlanSource(interviewId=interview.id, startedAt=interview.startedAt,
                                       overall=report.overall))
    return StudyPlan(
        id=record.id,
        comparisonGroup=record.comparison_group,
        sources=sources,
        items=[StudyPlanItem.model_validate(item) for item in record.items],
        createdAt=datetime.fromtimestamp(record.created_at, timezone.utc),
        updatedAt=datetime.fromtimestamp(record.updated_at, timezone.utc),
    )


def owned(store, owner_id, plan_id):
    record = store.session.scalar(select(StudyPlanRecord).where(
        StudyPlanRecord.id == plan_id, StudyPlanRecord.owner_id == owner_id))
    if record is None:
        raise HTTPException(404, 'Study plan not found.')
    return record


def generate_items(source_ids, request, user):
    with request.app.state.store.transaction() as store:
        interviews, _reports, comparison, evidence, refs = build_evidence(store, user.id, source_ids)
        comparison_json = comparison.model_dump(mode='json')
        source_ids = [interview.id for interview in interviews]
    draft = ai_service.generate_study_plan(evidence, comparison_json)
    if draft is None:
        raise HTTPException(503, 'The study plan could not be generated. No plan was saved; try again when coaching is available.')
    items = []
    for draft_item in draft.items:
        source_refs = [refs[ref] for ref in draft_item.sourceRefs]
        items.append(StudyPlanItem(id=str(uuid4()), topic=draft_item.topic.strip(),
            rationale=draft_item.rationale.strip(), action=draft_item.action.strip(),
            completed=False, sources=source_refs).model_dump(mode='json'))
    return source_ids, comparison, comparison_json, items


def create(data: StudyPlanCreate, request: Request, user: CurrentUser):
    source_ids, comparison, comparison_json, items = generate_items(data.sourceInterviewIds, request, user)
    timestamp = datetime.now(timezone.utc).timestamp()
    with request.app.state.store.transaction() as store:
        # Recheck ownership/status so a report cannot disappear or change during generation.
        _current = build_evidence(store, user.id, source_ids)
        if _current[2] != comparison:
            raise HTTPException(409, 'Source reports changed. Reload and try again.')
        record = StudyPlanRecord(id=str(uuid4()), owner_id=user.id,
            source_interview_ids=source_ids, comparison_group=comparison_json, items=items,
            created_at=timestamp, updated_at=timestamp)
        store.session.add(record)
        store.session.flush()
        return public(store, record)


@router.get('', response_model=StudyPlanList)
def listing(request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        records = store.session.scalars(select(StudyPlanRecord).where(
            StudyPlanRecord.owner_id == user.id).order_by(StudyPlanRecord.updated_at.desc(), StudyPlanRecord.id).limit(100))
        return StudyPlanList(items=[public(store, record) for record in records])


@router.post('', response_model=StudyPlan, status_code=201)
def create_endpoint(data: StudyPlanCreate, request: Request, user: CurrentUser):
    return create(data, request, user)


@router.post('/{plan_id}/regenerate', response_model=StudyPlan)
def regenerate(plan_id: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        record = owned(store, user.id, plan_id)
        source_ids = list(record.source_interview_ids)
    source_ids, comparison, comparison_json, items = generate_items(source_ids, request, user)
    with request.app.state.store.transaction() as store:
        current = owned(store, user.id, plan_id)
        if current.source_interview_ids != source_ids or current.comparison_group != comparison_json:
            raise HTTPException(409, 'Source reports changed. Reload and try again.')
        current.items = items
        current.updated_at = datetime.now(timezone.utc).timestamp()
        store.session.flush()
        return public(store, current)


@router.patch('/{plan_id}/items/{item_id}', response_model=StudyPlan)
def update_item(plan_id: str, item_id: str, data: StudyPlanItemUpdate,
                request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        record = owned(store, user.id, plan_id)
        items = [StudyPlanItem.model_validate(item) for item in record.items]
        item = next((item for item in items if item.id == item_id), None)
        if item is None:
            raise HTTPException(404, 'Study plan item not found.')
        item.completed = data.completed
        record.items = [item.model_dump(mode='json') for item in items]
        record.updated_at = datetime.now(timezone.utc).timestamp()
        store.session.flush()
        return public(store, record)


@router.delete('/{plan_id}', status_code=204)
def remove(plan_id: str, request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        store.session.delete(owned(store, user.id, plan_id))
    return Response(status_code=204)
