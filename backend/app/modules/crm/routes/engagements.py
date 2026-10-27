"""Customer engagements on a customer organization (CRM › Customer Organizations ›
Engagements, 2026-10-27): meetings, calls, visits and general discussions with a
contact of the organization, what came out of them and the next follow-up date.

Organizations are a shared customer master, so anyone who may log engagements
logs them on any organization; editing / deleting is the creator's (or an admin's)."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.permission_registry import is_admin_user
from app.core.permissions import require_feature_action
from app.db.session import get_db
from app.modules.crm.models.engagement import (
    ENGAGEMENT_OUTCOME_LABELS, ENGAGEMENT_OUTCOMES, ENGAGEMENT_TYPE_LABELS, ENGAGEMENT_TYPES, CrmEngagement,
)
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User

router = APIRouter(prefix="/crm", tags=["CRM - Engagements"])


class EngagementIn(BaseModel):
    org_contact_id: int
    engagement_date: date
    engagement_type: str
    summary: str
    outcome: str
    next_followup_date: date | None = None


class EngagementOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    org_id: int
    org_contact_id: int
    contact_name: str | None = None
    engagement_date: date
    engagement_type: str
    engagement_type_label: str = ""
    summary: str
    outcome: str
    outcome_label: str = ""
    next_followup_date: date | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    can_edit: bool = False


def _org(db: Session, org_id: int) -> Organization:
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Customer organization not found — it may have been deleted. Go back to the list.")
    return org


def _validate(db: Session, org_id: int, p: EngagementIn) -> None:
    contact = db.query(OrgContact).filter(OrgContact.id == p.org_contact_id, OrgContact.org_id == org_id).first()
    if contact is None:
        raise HTTPException(status_code=422, detail="Pick the contact person you spoke to — the selected contact doesn't belong to this "
                                                    "customer organization (or was removed). Add the contact on the Contacts tab if missing.")
    if p.engagement_type not in ENGAGEMENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Engagement type '{p.engagement_type}' is not valid — pick "
                                                    f"{', '.join(ENGAGEMENT_TYPE_LABELS.values())}.")
    if p.outcome not in ENGAGEMENT_OUTCOMES:
        raise HTTPException(status_code=422, detail=f"Outcome '{p.outcome}' is not valid — pick {', '.join(ENGAGEMENT_OUTCOME_LABELS.values())}.")
    if not (p.summary or "").strip():
        raise HTTPException(status_code=422, detail="Discussion summary is required — write what was discussed.")
    if p.engagement_date > date.today():
        raise HTTPException(status_code=422, detail=f"Engagement date {p.engagement_date:%d-%m-%Y} is in the future — enter the day it happened.")
    if p.next_followup_date and p.next_followup_date < p.engagement_date:
        raise HTTPException(status_code=422, detail=f"Next follow-up date {p.next_followup_date:%d-%m-%Y} is before the engagement date "
                                                    f"{p.engagement_date:%d-%m-%Y} — pick a later date or leave it blank.")


def _out(db: Session, e: CrmEngagement, user: User) -> EngagementOut:
    r = EngagementOut.model_validate(e)
    c = db.get(OrgContact, e.org_contact_id)
    u = db.get(User, e.created_by_id) if e.created_by_id else None
    r.contact_name = c.name if c else None
    r.created_by_name = (u.name or u.email) if u else None
    r.engagement_type_label = ENGAGEMENT_TYPE_LABELS.get(e.engagement_type, e.engagement_type)
    r.outcome_label = ENGAGEMENT_OUTCOME_LABELS.get(e.outcome, e.outcome)
    r.can_edit = is_admin_user(user) or e.created_by_id == user.id
    return r


def _own(e: CrmEngagement, user: User, what: str) -> None:
    if not (is_admin_user(user) or e.created_by_id == user.id):
        raise HTTPException(status_code=403, detail=f"Only the person who logged this engagement (or an admin) can {what} it.")


def _audit(db: Session, org_id: int, user: User, summary: str) -> None:
    db.add(AuditLog(entity_type="organization", entity_id=org_id, action="engagement", performed_by_id=user.id, summary=summary))


@router.get("/organizations/{org_id}/engagements", response_model=list[EngagementOut])
async def list_engagements(org_id: int, db: Session = Depends(get_db),
                           user: User = Depends(require_feature_action("crm", "organizations", "engagements", "view"))):
    _org(db, org_id)
    rows = (db.query(CrmEngagement).filter(CrmEngagement.org_id == org_id, CrmEngagement.is_deleted == False)  # noqa: E712
            .order_by(CrmEngagement.engagement_date.desc(), CrmEngagement.id.desc()).all())
    return [_out(db, e, user) for e in rows]


@router.post("/organizations/{org_id}/engagements", response_model=EngagementOut, status_code=201)
async def create_engagement(org_id: int, payload: EngagementIn, db: Session = Depends(get_db),
                            user: User = Depends(require_feature_action("crm", "organizations", "engagements", "create"))):
    org = _org(db, org_id)
    _validate(db, org_id, payload)
    e = CrmEngagement(org_id=org_id, created_by_id=user.id, **{**payload.model_dump(), "summary": payload.summary.strip()})
    db.add(e)
    db.flush()
    _audit(db, org_id, user, f"{user.name or user.email} logged a {ENGAGEMENT_TYPE_LABELS[e.engagement_type].lower()} with {org.name} "
                             f"on {e.engagement_date:%d-%m-%Y} — {ENGAGEMENT_OUTCOME_LABELS[e.outcome]}.")
    db.commit()
    db.refresh(e)
    return _out(db, e, user)


@router.patch("/engagements/{engagement_id}", response_model=EngagementOut)
async def update_engagement(engagement_id: int, payload: EngagementIn, db: Session = Depends(get_db),
                            user: User = Depends(require_feature_action("crm", "organizations", "engagements", "edit"))):
    e = db.query(CrmEngagement).filter(CrmEngagement.id == engagement_id, CrmEngagement.is_deleted == False).first()  # noqa: E712
    if e is None:
        raise HTTPException(status_code=404, detail="Engagement not found — it may have been deleted. Refresh the tab.")
    _own(e, user, "edit")
    _validate(db, e.org_id, payload)
    for k, v in payload.model_dump().items():
        setattr(e, k, v.strip() if k == "summary" else v)
    _audit(db, e.org_id, user, f"{user.name or user.email} edited the engagement of {e.engagement_date:%d-%m-%Y}.")
    db.commit()
    db.refresh(e)
    return _out(db, e, user)


@router.delete("/engagements/{engagement_id}")
async def delete_engagement(engagement_id: int, db: Session = Depends(get_db),
                            user: User = Depends(require_feature_action("crm", "organizations", "engagements", "delete"))):
    e = db.query(CrmEngagement).filter(CrmEngagement.id == engagement_id, CrmEngagement.is_deleted == False).first()  # noqa: E712
    if e is None:
        raise HTTPException(status_code=404, detail="Engagement not found — it may have been deleted. Refresh the tab.")
    _own(e, user, "delete")
    e.is_deleted = True
    e.deleted_at = datetime.now(timezone.utc)
    _audit(db, e.org_id, user, f"{user.name or user.email} deleted the engagement of {e.engagement_date:%d-%m-%Y}.")
    db.commit()
    return {"message": "Engagement deleted"}
