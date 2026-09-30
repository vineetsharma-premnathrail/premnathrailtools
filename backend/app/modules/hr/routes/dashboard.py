"""HR & Administration — HR dashboard.

Owner: Integration agent. HR team only (`Depends(require_hr)`); everyone
else uses My HR. All numbers are computed live in services/dashboard.py."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.hr.schemas.dashboard import HrDashboardResponse
from app.modules.hr.services.access import require_hr
from app.modules.hr.services.dashboard import build_dashboard
from app.modules.main.models.user import User

router = APIRouter(prefix="/hr/dashboard", tags=["HR"])


@router.get("", response_model=HrDashboardResponse)
def get_hr_dashboard(db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    """Headcount, joiners/exits this month, leave and attendance today,
    pending approvals, open lifecycle events, assets, visitors inside,
    expiring documents and probations ending in the next 30 days."""
    return build_dashboard(db)
