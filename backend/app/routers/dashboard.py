from fastapi import APIRouter, Request

from ..auth import CurrentUser
from ..models import DashboardSummary

router = APIRouter(prefix='/dashboard', tags=['dashboard'])


@router.get('/summary', response_model=DashboardSummary)
def summary(request: Request, user: CurrentUser):
    with request.app.state.store.transaction() as store:
        return store.dashboard_summary(user.id)
