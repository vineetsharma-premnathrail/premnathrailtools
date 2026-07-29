from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.tender import Tender
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.note import Note
from app.modules.crm.schemas.dashboard import CrmDashboardResponse

router = APIRouter(prefix="/crm/dashboard", tags=["CRM - Dashboard"])


@router.get("", response_model=CrmDashboardResponse)
async def get_crm_dashboard(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    today = date.today()

    total_organizations = db.query(Organization).filter(Organization.is_deleted == False).count()  # noqa: E712
    total_inquiries = db.query(Inquiry).filter(Inquiry.is_deleted == False).count()  # noqa: E712
    total_tenders = db.query(Tender).filter(Tender.is_deleted == False).count()  # noqa: E712

    open_followups = db.query(Activity).filter(Activity.is_deleted == False, Activity.status == "Open").count()  # noqa: E712
    overdue_followups = db.query(Activity).filter(
        Activity.is_deleted == False, Activity.status == "Open", Activity.next_followup < today  # noqa: E712
    ).count()
    today_activities = db.query(Activity).filter(
        Activity.is_deleted == False, Activity.next_followup == today  # noqa: E712
    ).count()

    pending_tenders = db.query(Tender).filter(
        Tender.is_deleted == False, Tender.status.in_(["Active", "Submitted"])  # noqa: E712
    ).count()
    recent_notes_count = db.query(Note).filter(Note.is_deleted == False).count()  # noqa: E712

    recent_organizations = db.query(Organization).filter(Organization.is_deleted == False).order_by(Organization.created_at.desc()).limit(5).all()  # noqa: E712
    recent_inquiries = db.query(Inquiry).filter(Inquiry.is_deleted == False).order_by(Inquiry.created_at.desc()).limit(5).all()  # noqa: E712
    recent_tenders = db.query(Tender).filter(Tender.is_deleted == False).order_by(Tender.created_at.desc()).limit(5).all()  # noqa: E712
    recent_activities = db.query(Activity).filter(Activity.is_deleted == False).order_by(Activity.created_at.desc()).limit(5).all()  # noqa: E712
    recent_notes = db.query(Note).filter(Note.is_deleted == False).order_by(Note.created_at.desc()).limit(5).all()  # noqa: E712

    return CrmDashboardResponse(
        total_organizations=total_organizations,
        total_inquiries=total_inquiries,
        total_tenders=total_tenders,
        open_followups=open_followups,
        overdue_followups=overdue_followups,
        today_activities=today_activities,
        pending_tenders=pending_tenders,
        recent_notes_count=recent_notes_count,
        recent_organizations=recent_organizations,
        recent_inquiries=recent_inquiries,
        recent_tenders=recent_tenders,
        recent_activities=recent_activities,
        recent_notes=recent_notes,
    )
