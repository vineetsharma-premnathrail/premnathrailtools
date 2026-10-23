from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from app.core.notify_rules import fire_rule
from sqlalchemy import cast, func, String as SAString
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.core.permissions import (
    ensure_can_delete, require_any_app_access, require_app_access, require_feature_action, require_tab_access, require_tab_action,
)
from app.modules.crm.access import INQ, ensure_parent_in_scope, require_view_any
from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permission_registry import can_feature, can_perform
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.services.org_code import generate_org_code
from app.modules.crm.services.customer_master import apply_to_org as apply_tax_ids, check_contact_address
from app.modules.crm.services.cascade import cascade_delete_organization
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
    return user.role == "admin" or record.created_by_id == user.id


def _check_contact_duplicates(
    db: Session, org_id: int, mobile: str | None, email: str | None, exclude_contact_id: int | None = None
) -> None:
    """Reject a contact whose mobile or email matches another contact already
    on the same organization, so the same person can't be added twice."""
    if not mobile and not email:
        return
    query = db.query(OrgContact).filter(OrgContact.org_id == org_id)
    if exclude_contact_id:
        query = query.filter(OrgContact.id != exclude_contact_id)
    for existing in query.all():
        if mobile and existing.mobile and existing.mobile.strip() == mobile.strip():
            raise HTTPException(status_code=409, detail="Contact Person Mobile is duplicated")
        if email and existing.email and existing.email.strip().lower() == email.strip().lower():
            raise HTTPException(status_code=409, detail="Contact Person Email is duplicated")


@router.get("", response_model=list[OrganizationResponse])
async def list_organizations(
    search: str | None = None,
    railway_zone: str | None = None,
    skip: int = 0,
    limit: int = 200,
    # picker=true: dropdown lookup (Inquiry/Tender forms, Finance customer
    # pickers) — every organization, not limited by the CRM data scope, so a
    # narrowed user can still raise an inquiry for a customer a colleague added.
    # The Organizations list page leaves it off and sees only its data scope.
    picker: bool = False,
    db: Session = Depends(get_db),
    # Organization picker: also read by Finance (customers in ledger/payments/
    # sales invoices) and by every CRM form, so any CRM or Finance user may list.
    _user: User = Depends(require_any_app_access("crm", "accounts")),
):
    query = db.query(Organization).filter(Organization.is_deleted == False)  # noqa: E712
    if not picker:
        query = apply_scope(query, _user, Organization)
    if railway_zone:
        query = query.filter(Organization.railway_zone == railway_zone)
    if search:
        like = f"%{search}%"
        creator_ids_matching = db.query(User.id).filter(
            (User.name.ilike(like)) | (User.email.ilike(like))
        )
        query = query.filter(
            (Organization.name.ilike(like)) | (Organization.org_type.ilike(like)) | (Organization.parent_org.ilike(like))
            | (Organization.railway_zone.ilike(like)) | (Organization.division_workshop.ilike(like))
            | (Organization.address.ilike(like)) | (Organization.country.ilike(like)) | (Organization.state.ilike(like))
            | (Organization.city.ilike(like)) | (Organization.pin_code.ilike(like))
            | (Organization.website.ilike(like))
            | (cast(Organization.created_at, SAString).ilike(like))
            | (Organization.created_by_id.in_(creator_ids_matching))
        )
    orgs = query.order_by(Organization.id.desc()).offset(skip).limit(limit).all()
    creator_ids = {o.created_by_id for o in orgs if o.created_by_id}
    names_by_id = {}
    if creator_ids:
        for u in db.query(User).filter(User.id.in_(creator_ids)).all():
            names_by_id[u.id] = u.name or u.email
    results = []
    for o in orgs:
        resp = OrganizationResponse.model_validate(o)
        resp.created_by_name = names_by_id.get(o.created_by_id)
        results.append(resp)
    return results


@router.get("/duplicates")
async def list_duplicate_organizations(
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("crm", "organizations")),
):
    """Read-only report of organizations that share the same name (case-insensitive)
    among non-deleted rows — surfaces existing duplicates for manual review/merge
    without deleting or modifying anything."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can view the duplicates report.")

    orgs = db.query(Organization).filter(Organization.is_deleted == False).order_by(Organization.id).all()  # noqa: E712
    groups: dict[str, list[Organization]] = {}
    for o in orgs:
        groups.setdefault(o.name.strip().lower(), []).append(o)

    dupes = []
    for key, group in groups.items():
        if len(group) < 2:
            continue
        org_ids = [o.id for o in group]
        inquiry_counts = dict(
            db.query(Inquiry.org_id, func.count(Inquiry.id))
            .filter(Inquiry.org_id.in_(org_ids), Inquiry.is_deleted == False)  # noqa: E712
            .group_by(Inquiry.org_id).all()
        )
        tender_counts = dict(
            db.query(Tender.org_id, func.count(Tender.id))
            .filter(Tender.org_id.in_(org_ids), Tender.is_deleted == False)  # noqa: E712
            .group_by(Tender.org_id).all()
        )
        dupes.append({
            "name": group[0].name,
            "organizations": [
                {
                    "id": o.id, "org_code": o.org_code, "gst_number": o.gst_number,
                    "city": o.city, "state": o.state, "created_at": o.created_at,
                    "inquiry_count": inquiry_counts.get(o.id, 0),
                    "tender_count": tender_counts.get(o.id, 0),
                }
                for o in group
            ],
        })
    return {"duplicate_count": len(dupes), "groups": dupes}


@router.get("/search-name")
async def search_organization_name(
    # Name lookup used by the CRM create forms (duplicate hint) — any CRM user.
    q: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    matches = db.query(Organization).filter(
        Organization.is_deleted == False, Organization.name.ilike(f"%{q}%")  # noqa: E712
    ).limit(10).all()
    return [{"id": o.id, "name": o.name} for o in matches]


def _check_gst_free(db: Session, gst_number: str, org_id: int | None) -> None:
    """GSTIN is unique across every organization row, including ones in the recycle
    bin (DB unique constraint) — name the holder so the user knows what to do."""
    q = db.query(Organization).filter(Organization.gst_number == gst_number)
    if org_id is not None:
        q = q.filter(Organization.id != org_id)
    clash = q.first()
    if not clash:
        return
    if clash.is_deleted:
        raise HTTPException(status_code=409, detail=(
            f"GST number {gst_number} belongs to '{clash.name}', which is in the recycle bin. "
            f"Restore that customer organization instead of creating a new one (or correct the GST number)."))
    raise HTTPException(status_code=409, detail=(
        f"A customer organization with this GST number already exists: '{clash.name}' — use that customer organization, or correct the GST number."))


@router.post("", response_model=OrganizationResponse, status_code=201)
async def create_organization(
    payload: OrganizationCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("crm", "organizations", "create")),
):
    name_clash = db.query(Organization).filter(
        Organization.is_deleted == False, func.lower(Organization.name) == payload.name.strip().lower()  # noqa: E712
    ).first()
    if name_clash:
        raise HTTPException(status_code=409, detail="A customer organization with this name already exists")
    if payload.gst_number:
        _check_gst_free(db, payload.gst_number, None)
    if payload.official_email:
        email_clash = db.query(Organization).filter(
            Organization.is_deleted == False, func.lower(Organization.official_email) == payload.official_email.strip().lower()  # noqa: E712
        ).first()
        if email_clash:
            raise HTTPException(status_code=409, detail="Official Email is already used by another customer organization")

    org = Organization(**payload.model_dump(), org_code=generate_org_code(db), created_by_id=user.id)
    apply_tax_ids(org)  # PAN / GST state code from the GSTIN (customer master)
    db.add(org)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A customer organization with this name already exists")
    _write_audit(db, org.id, "created", user, summary=f"Customer Organization {org.name} created by {user.name or user.email}.")
    broadcast_notification(
        db, title="New Customer Organization Added",
        message=f"Customer Organization '{org.name}' was added by {user.name or user.email}.",
        notification_type="organization_created", entity_type="organization", entity_id=org.id,
        exclude_user_id=user.id, app_name="crm",
    )
    notify_user(
        db, user_id=user.id, title="Customer Organization Added",
        message=f"You added customer organization '{org.name}'.",
        notification_type="organization_created", entity_type="organization", entity_id=org.id,
    )
    fire_rule(db, background_tasks, "crm", "organization_create", "New Customer Organization Added",
              f"Customer Organization '{org.name}' was added by {user.name or user.email}.", "organization", org.id, user,
              [("Customer Organization", org.name), ("Code", org.org_code or ""), ("Type", org.org_type or ""),
               ("City / State", ", ".join(x for x in (org.city, org.state) if x)), ("Added by", user.name or user.email)])
    db.commit()
    db.refresh(org)
    return org


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_view_any()),
):
    # Lookup (header fields only — the same data the picker list returns), read
    # by the Inquiry/Tender forms and detail panels for the record's customer,
    # so it is not limited by the CRM data scope. The Organization page itself
    # (/detail, edit, delete, audit) is.
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Customer Organization not found")
    return org


@router.get("/{org_id}/detail", response_model=OrganizationDetailResponse)
async def get_organization_detail(
    org_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("crm", "organizations")),
):
    org = db.query(Organization).options(selectinload(Organization.contacts)).filter(
        Organization.id == org_id, Organization.is_deleted == False  # noqa: E712
    ).first()
    if not org:
        raise HTTPException(status_code=404, detail="Customer Organization not found")
    ensure_in_scope(db, _user, org)
    inquiry_count = apply_scope(db.query(Inquiry).filter(Inquiry.org_id == org_id, Inquiry.is_deleted == False), _user, Inquiry).count()  # noqa: E712
    tender_count = apply_scope(db.query(Tender).filter(Tender.org_id == org_id, Tender.is_deleted == False), _user, Tender).count()  # noqa: E712
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
    user: User = Depends(require_tab_action("crm", "organizations", "edit")),
):
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Customer Organization not found")
    ensure_in_scope(db, user, org)
    if not _can_modify(org, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this customer organization.")

    if payload.name is not None and payload.name.strip().lower() != (org.name or "").strip().lower():
        name_clash = db.query(Organization).filter(
            Organization.is_deleted == False, func.lower(Organization.name) == payload.name.strip().lower(),  # noqa: E712
            Organization.id != org_id,
        ).first()
        if name_clash:
            raise HTTPException(status_code=409, detail=(
                f"A customer organization named '{name_clash.name}' already exists ({name_clash.org_code or f'#{name_clash.id}'}) — "
                f"pick a different name, or use that customer organization instead."))
    if payload.gst_number:
        _check_gst_free(db, payload.gst_number, org_id)
    if payload.official_email:
        email_clash = db.query(Organization).filter(
            Organization.is_deleted == False, func.lower(Organization.official_email) == payload.official_email.strip().lower(),  # noqa: E712
            Organization.id != org_id,
        ).first()
        if email_clash:
            raise HTTPException(status_code=409, detail="Official Email is already used by another customer organization")

    updates = payload.model_dump(exclude_unset=True)
    changed = [f for f, v in updates.items() if str(getattr(org, f, None)) != str(v)]
    for field, value in updates.items():
        setattr(org, field, value)
    if {"gst_number", "pan", "state", "gst_state_code"} & set(updates):
        apply_tax_ids(org)
    if changed:
        _write_audit(db, org.id, "updated", user, summary=f"{user.name or user.email} updated: {', '.join(changed[:5])}.")
    db.commit()
    db.refresh(org)
    return org


@router.delete("/{org_id}", status_code=204)
async def delete_organization(
    org_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("crm", "organizations")),
):
    """Soft delete an organization and everything under it — Inquiries, Tenders and
    the follow-ups/documents logged against them (setting is_deleted doesn't trigger
    the ORM's delete-orphan cascade, so it's done explicitly in cascade_delete_organization)."""
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Customer Organization not found")
    ensure_in_scope(db, user, org)
    ensure_can_delete(user, org, "crm", "organizations", what="customer organization")
    # The organization is the customer master of its sales orders — a customer with a
    # live order can't be deleted (that would also delete the inquiries / tenders the
    # orders were raised from).
    from app.modules.sales.models.order import SalesOrder, SALES_ORDER_LIVE_STATUSES
    live = db.query(SalesOrder).filter(
        SalesOrder.customer_id == org.id, SalesOrder.is_deleted == False,  # noqa: E712
        SalesOrder.status.in_(SALES_ORDER_LIVE_STATUSES),
    ).order_by(SalesOrder.id).limit(4).all()
    if live:
        names = ", ".join(o.display_number for o in live[:3]) + (" and more" if len(live) > 3 else "")
        raise HTTPException(status_code=409, detail=(
            f"{org.name} can't be deleted: it is the customer on sales order(s) {names}. "
            f"Cancel those orders in Sales first, or keep the customer organization."))

    now = datetime.now(timezone.utc)
    org.is_deleted = True
    org.deleted_at = now
    cascade_delete_organization(db, org_id, now)

    _write_audit(db, org.id, "deleted", user, summary=f"Customer Organization {org.name} deleted by {user.name or user.email}.")
    broadcast_notification(
        db, title="Customer Organization Deleted",
        message=f"Customer Organization '{org.name}' was deleted by {user.name or user.email}.",
        notification_type="organization_deleted", entity_type="organization", entity_id=org.id,
        exclude_user_id=user.id, app_name="crm",
    )
    notify_user(
        db, user_id=user.id, title="Customer Organization Deleted",
        message=f"You deleted customer organization '{org.name}'.",
        notification_type="organization_deleted", entity_type="organization", entity_id=org.id,
    )
    db.commit()


@router.get("/{org_id}/audit")
async def get_organization_audit(
    org_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("crm", "organizations", "audit_trail", "view")),
):
    ensure_parent_in_scope(db, _user, "organization", org_id)
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

@router.get("/contacts/all", response_model=list[OrgContactResponse])
async def list_all_org_contacts(
    db: Session = Depends(get_db),
    _user: User = Depends(require_view_any()),
):
    """Bulk fetch for list views (e.g. Activities) that need to resolve many
    org_contact_id references at once without firing one request per org."""
    return db.query(OrgContact).order_by(OrgContact.id.desc()).all()


@router.get("/{org_id}/contacts", response_model=list[OrgContactResponse])
async def list_org_contacts(
    org_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_view_any()),
):
    return db.query(OrgContact).filter(OrgContact.org_id == org_id).order_by(OrgContact.id.desc()).all()


@router.post("/{org_id}/contacts", response_model=OrgContactResponse, status_code=201)
async def create_org_contact(
    org_id: int,
    payload: OrgContactCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    # A contact is added on the Organization (Organizations › Contacts › Create), or
    # inline from an Inquiry/Tender/follow-up form — Inquiries & Tenders:Create/Edit.
    if not (can_feature(user, "crm", "organizations", "contacts", "create") or can_perform(user, "crm", INQ, "create")
            or can_perform(user, "crm", INQ, "edit")):
        raise HTTPException(
            status_code=403,
            detail="You can't add contacts — you need 'Create' on CRM › Customer Organizations › Contacts "
                   "or 'Create'/'Edit' on CRM › Inquiries & Tenders. Ask an admin "
                   "to add it to one of your roles (Organization › Role & Permissions).",
        )
    org = db.query(Organization).filter(Organization.id == org_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail="Customer Organization not found")
    _check_contact_duplicates(db, org_id, payload.mobile, payload.email)
    check_contact_address(db, org_id, payload.address_id)
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
    user: User = Depends(require_feature_action("crm", "organizations", "contacts", "edit")),
):
    contact = db.query(OrgContact).filter(OrgContact.id == contact_id, OrgContact.org_id == org_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    ensure_parent_in_scope(db, user, "organization", org_id)
    if not _can_modify(contact, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this contact.")
    _check_contact_duplicates(db, org_id, payload.mobile, payload.email, exclude_contact_id=contact_id)
    if "address_id" in payload.model_fields_set:
        check_contact_address(db, org_id, payload.address_id)
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
    user: User = Depends(require_feature_action("crm", "organizations", "contacts", "delete")),
):
    contact = db.query(OrgContact).filter(OrgContact.id == contact_id, OrgContact.org_id == org_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    ensure_parent_in_scope(db, user, "organization", org_id)
    if not _can_modify(contact, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this contact.")
    _ensure_contact_unused(db, contact)
    db.delete(contact)
    db.commit()
    return {"message": "Contact deleted"}


def _ensure_contact_unused(db: Session, contact: OrgContact) -> None:
    """Refuse to hard-delete a contact that other records still point at.

    crm_org_contacts.id is a foreign key from inquiries, tenders, follow-ups and
    sales orders. Deleting it would hit an IntegrityError (a bare 500), so name
    the records the user must re-point first. Soft-deleted (recycle-bin) rows
    still hold the foreign key, so they are counted too.
    """
    from app.modules.crm.models.activity import Activity
    from app.modules.sales.models.order import SalesOrder

    inquiries = db.query(Inquiry).filter(Inquiry.org_contact_id == contact.id).all()
    tenders = db.query(Tender).filter(Tender.org_contact_id == contact.id).all()
    followups = db.query(func.count(Activity.id)).filter(Activity.org_contact_id == contact.id).scalar() or 0
    orders = db.query(SalesOrder).filter(SalesOrder.customer_contact_id == contact.id).all()
    if not (inquiries or tenders or followups or orders):
        return

    def _list(rows, label, limit=5):
        names = [label(r) for r in rows[:limit]]
        more = f" and {len(rows) - limit} more" if len(rows) > limit else ""
        binned = sum(1 for r in rows if getattr(r, "is_deleted", False))
        note = f" ({binned} in the recycle bin)" if binned else ""
        return ", ".join(names) + more + note

    parts = []
    if inquiries:
        parts.append(f"inquiries {_list(inquiries, lambda r: r.universal_id or f'#{r.id}')}")
    if tenders:
        parts.append(f"tenders {_list(tenders, lambda r: r.universal_id or r.tender_number or f'#{r.id}')}")
    if orders:
        parts.append(f"sales orders {_list(orders, lambda r: r.so_number or f'Draft #{r.id}')}")
    if followups:
        parts.append(f"{followups} follow-up{'s' if followups != 1 else ''}")
    used_on = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
    name = contact.name or f"#{contact.id}"
    raise HTTPException(
        status_code=409,
        detail=(
            f"Contact '{name}' is still used on {used_on}. "
            "Change the contact on those records first, then remove it."
        ),
    )
