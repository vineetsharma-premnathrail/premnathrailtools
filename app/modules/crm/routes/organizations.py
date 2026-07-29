from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.tender import Tender
from app.modules.crm.schemas.organization import (
    OrganizationCreate, OrganizationUpdate, OrganizationResponse, OrganizationDetailResponse,
    OrgContactCreate, OrgContactUpdate, OrgContactResponse,
)
from app.utils.notifications import broadcast_notification, notify_user

router = APIRouter(prefix="/crm/organizations", tags=["CRM - Organizations"])


def _write_audit(db: Session, org_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="organization", entity_id=org_id, action=action, performed_by_id=user.id, summary=summary))


def _can_modify(record, user: User) -> bool:
    return user.role in ("admin", "super_admin") or record.created_by_id == user.id


@router.get("", response_model=list[OrganizationResponse])
async def list_organizations(
    search: str | None = None,
    railway_zone: str | None = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    query = db.query(Organization).filter(Organization.is_deleted == False)  # noqa: E712
    if railway_zone:
        query = query.filter(Organization.railway_zone == railway_zone)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (Organization.name.ilike(like)) | (Organization.gst_number.ilike(like)) | (Organization.city.ilike(like))
        )
    return query.order_by(Organization.id.desc()).offset(skip).limit(limit).all()


@router.get("/search-name")
async def search_organization_name(
    q: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    matches = db.query(Organization).filter(
        Organization.is_deleted == False, Organization.name.ilike(f"%{q}%")  # noqa: E712
    ).limit(10).all()
    return [{"id": o.id, "name": o.name} for o in matches]


@router.post("", response_model=OrganizationResponse, status_code=201)
async def create_organization(
    payload: OrganizationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    name_clash = db.query(Organization).filter(
        Organization.is_deleted == False, Organization.name.ilike(payload.name)  # noqa: E712
    ).first()
    if name_clash:
        raise HTTPException(status_code=409, detail="An organization with this name already exists")
    if payload.gst_number:
        gst_clash = db.query(Organization).filter(
            Organization.is_deleted == False, Organization.gst_number == payload.gst_number  # noqa: E712
        ).first()
        if gst_clash:
            raise HTTPException(status_code=409, detail="An organization with this GST number already exists")

    org = Organization(**payload.model_dump(), created_by_id=user.id)
    db.add(org)
    db.flush()
    _write_audit(db, org.id, "created", user, summary=f"Organization {org.name} created by {user.name or user.email}.")
    broadcast_notification(
        db, title="New Organization Added",
        message=f"Organization '{org.name}' was added by {user.name or user.email}.",
        notification_type="organization_created", entity_type="organization", entity_id=org.id,
        exclude_user_id=user.id,
    )
    notify_user(
        db, user_id=user.id, title="Organization Added",
        message=f"You added organization '{org.name}'.",
        notification_type="organization_created", entity_type="organization", entity_id=org.id,
    )
    db.commit()
    db.refresh(org)
    return org


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


@router.get("/{org_id}/detail", response_model=OrganizationDetailResponse)
async def get_organization_detail(
    org_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    org = db.query(Organization).options(selectinload(Organization.contacts)).filter(
        Organization.id == org_id, Organization.is_deleted == False  # noqa: E712
    ).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    inquiry_count = db.query(Inquiry).filter(Inquiry.org_id == org_id, Inquiry.is_deleted == False).count()  # noqa: E712
    tender_count = db.query(Tender).filter(Tender.org_id == org_id, Tender.is_deleted == False).count()  # noqa: E712
    data = OrganizationResponse.model_validate(org).model_dump()
    data["contacts"] = [OrgContactResponse.model_validate(c) for c in org.contacts]
    data["inquiry_count"] = inquiry_count
    data["tender_count"] = tender_count
    return data


@router.patch("/{org_id}", response_model=OrganizationResponse)
async def update_organization(
    org_id: int,
    payload: OrganizationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if not _can_modify(org, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this organization.")

    updates = payload.model_dump(exclude_unset=True)
    changed = [f for f, v in updates.items() if str(getattr(org, f, None)) != str(v)]
    for field, value in updates.items():
        setattr(org, field, value)
    if changed:
        _write_audit(db, org.id, "updated", user, summary=f"{user.name or user.email} updated: {', '.join(changed[:5])}.")
    db.commit()
    db.refresh(org)
    return org


@router.delete("/{org_id}", status_code=204)
async def delete_organization(
    org_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    """Soft delete an organization, cascading to its Inquiries and Tenders (setting
    is_deleted doesn't trigger the ORM's delete-orphan cascade, so it's done explicitly)."""
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if not _can_modify(org, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this organization.")

    now = datetime.now(timezone.utc)
    org.is_deleted = True
    org.deleted_at = now
    for inq in db.query(Inquiry).filter(Inquiry.org_id == org_id, Inquiry.is_deleted == False).all():  # noqa: E712
        inq.is_deleted = True
        inq.deleted_at = now
    for tnd in db.query(Tender).filter(Tender.org_id == org_id, Tender.is_deleted == False).all():  # noqa: E712
        tnd.is_deleted = True
        tnd.deleted_at = now

    _write_audit(db, org.id, "deleted", user, summary=f"Organization {org.name} moved to recycle bin by {user.name or user.email}.")
    broadcast_notification(
        db, title="Organization Deleted",
        message=f"Organization '{org.name}' was deleted by {user.name or user.email}.",
        notification_type="organization_deleted", entity_type="organization", entity_id=org.id,
        exclude_user_id=user.id,
    )
    notify_user(
        db, user_id=user.id, title="Organization Deleted",
        message=f"You deleted organization '{org.name}'. It can be restored from the recycle bin for 10 days.",
        notification_type="organization_deleted", entity_type="organization", entity_id=org.id,
    )
    db.commit()


@router.post("/{org_id}/restore", response_model=OrganizationResponse)
async def restore_organization(
    org_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == True).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Deleted organization not found")
    org.is_deleted = False
    org.deleted_at = None
    for inq in db.query(Inquiry).filter(Inquiry.org_id == org_id, Inquiry.is_deleted == True).all():  # noqa: E712
        inq.is_deleted = False
        inq.deleted_at = None
    for tnd in db.query(Tender).filter(Tender.org_id == org_id, Tender.is_deleted == True).all():  # noqa: E712
        tnd.is_deleted = False
        tnd.deleted_at = None
    _write_audit(db, org.id, "restored", user, summary=f"Organization {org.name} restored from recycle bin.")
    db.commit()
    db.refresh(org)
    return org


@router.get("/recycle-bin/list")
async def list_deleted_organizations(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    orgs = db.query(Organization).filter(Organization.is_deleted == True).all()  # noqa: E712
    return [
        {"id": o.id, "name": o.name, "org_type": o.org_type, "deleted_at": o.deleted_at.isoformat() if o.deleted_at else None}
        for o in orgs
    ]


@router.get("/{org_id}/audit")
async def get_organization_audit(
    org_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "organization", AuditLog.entity_id == org_id
    ).order_by(AuditLog.performed_at.asc()).all()
    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"
    return [
        {
            "id": log.id, "action": log.action, "summary": log.summary,
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
        }
        for log in logs
    ]


# ── Contacts ─────────────────────────────────────────────────────────────

@router.get("/{org_id}/contacts", response_model=list[OrgContactResponse])
async def list_org_contacts(
    org_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    return db.query(OrgContact).filter(OrgContact.org_id == org_id).order_by(OrgContact.id.desc()).all()


@router.post("/{org_id}/contacts", response_model=OrgContactResponse, status_code=201)
async def create_org_contact(
    org_id: int,
    payload: OrgContactCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    contact = OrgContact(**payload.model_dump(), org_id=org_id, created_by_id=user.id, created_at=datetime.now(timezone.utc))
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@router.patch("/{org_id}/contacts/{contact_id}", response_model=OrgContactResponse)
async def update_org_contact(
    org_id: int,
    contact_id: int,
    payload: OrgContactUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    contact = db.query(OrgContact).filter(OrgContact.id == contact_id, OrgContact.org_id == org_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not _can_modify(contact, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this contact.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(contact, field, value)
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{org_id}/contacts/{contact_id}")
async def delete_org_contact(
    org_id: int,
    contact_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    contact = db.query(OrgContact).filter(OrgContact.id == contact_id, OrgContact.org_id == org_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not _can_modify(contact, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this contact.")
    db.delete(contact)
    db.commit()
    return {"message": "Contact deleted"}
