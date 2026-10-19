from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_tab_access
from app.core.data_scope import apply_scope
from app.modules.crm.access import apply_activity_scope
from app.modules.main.models.user import User
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.tender import Tender
from app.modules.crm.models.activity import Activity
from app.modules.crm.schemas.dashboard import CrmDashboardResponse

router = APIRouter(prefix="/crm/dashboard", tags=["CRM - Dashboard"])


@router.get("", response_model=CrmDashboardResponse)
async def get_crm_dashboard(
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("crm", "dashboard")),
):
    today = date.today()
    # Every count / recent list is limited to the user's CRM data scope.
    orgs = apply_scope(db.query(Organization), _user, Organization).filter(Organization.is_deleted == False)  # noqa: E712
    inquiries = apply_scope(db.query(Inquiry), _user, Inquiry).filter(Inquiry.is_deleted == False)  # noqa: E712
    tenders = apply_scope(db.query(Tender), _user, Tender).filter(Tender.is_deleted == False)  # noqa: E712
    activities = apply_activity_scope(db.query(Activity), db, _user).filter(Activity.is_deleted == False)  # noqa: E712

    total_organizations = orgs.count()
    total_inquiries = inquiries.count()
    total_tenders = tenders.count()

    open_followups = activities.filter(Activity.status == "Open").count()
    overdue_followups = activities.filter(Activity.status == "Open", Activity.next_followup < today).count()
    today_activities = activities.filter(Activity.status == "Open", Activity.next_followup == today).count()

    pending_tenders = tenders.filter(
        Tender.status.notin_(["Closed – Ordered", "Closed – Not Ordered", "Tender Cancelled"]),
    ).count()

    recent_organizations = orgs.order_by(Organization.created_at.desc()).limit(5).all()
    recent_inquiries = inquiries.order_by(Inquiry.created_at.desc()).limit(5).all()
    recent_tenders = tenders.order_by(Tender.created_at.desc()).limit(5).all()
    recent_activities = activities.order_by(Activity.created_at.desc()).limit(5).all()

    return CrmDashboardResponse(
        total_organizations=total_organizations,
        total_inquiries=total_inquiries,
        total_tenders=total_tenders,
        open_followups=open_followups,
        overdue_followups=overdue_followups,
        today_activities=today_activities,
        pending_tenders=pending_tenders,
        recent_organizations=recent_organizations,
        recent_inquiries=recent_inquiries,
        recent_tenders=recent_tenders,
        recent_activities=recent_activities,
    )
