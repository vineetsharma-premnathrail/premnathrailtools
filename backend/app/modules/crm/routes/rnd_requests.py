"""CRM side of the CRM ↔ R&D channel (see crm/services/requirement_movement.py).

Only the lookup CRM needs to open a request lives here — the request itself is
created by the inquiry/tender technical-offer-request endpoints, and R&D
answers through rnd/routes/requirements.py.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User

router = APIRouter(prefix="/crm/rnd-requests", tags=["CRM - R&D Requests"])


@router.get("/assignees")
async def list_rnd_assignees(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    """(Lookup for the Technical Offer Request picker — any CRM user; sending the
    request itself needs Inquiries & Tenders › Edit.) Active users who can open R&D — the only people who could see and answer a request."""
    users = db.query(User).filter(User.is_active == True).order_by(User.name.asc()).all()  # noqa: E712
    return [
        {"id": u.id, "name": u.name or u.email, "email": u.email, "designation": getattr(u, "designation", None)}
        for u in users if "rnd" in u.get_apps()
    ]
