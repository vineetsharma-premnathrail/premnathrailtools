"""Admin-only CSV bulk import for CRM data — organizations (with up to 3
contacts per row), inquiries, tenders, and activities. Every imported row is
attributed to a user picked by the admin (created_by_id), not the admin
themselves, since this is meant for backfilling another user's historical data."""
import csv
import io
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.tender import Tender
from app.modules.crm.models.activity import Activity

router = APIRouter(prefix="/crm/admin/import", tags=["CRM - Bulk Import"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def _s(row: dict, key: str) -> str | None:
    v = (row.get(key) or "").strip()
    return v or None


def _f(row: dict, key: str) -> float | None:
    v = _s(row, key)
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def _d(row: dict, key: str) -> date | None:
    v = _s(row, key)
    if not v:
        return None
    try:
        return datetime.strptime(v, "%Y-%m-%d").date()
    except ValueError:
        return None


def _read_csv(file_bytes: bytes) -> list[dict]:
    text = file_bytes.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def _resolve_user(db: Session, email: str) -> User:
    user = db.query(User).filter(func.lower(User.email) == email.strip().lower()).first()
    if not user:
        raise HTTPException(status_code=400, detail=f"No user found with email '{email}'")
    return user


def _gen_universal_id(db: Session, model, prefix: str) -> str:
    today = date.today().strftime("%Y%m%d")
    seq = db.query(func.count(model.id)).scalar() + 1
    return f"{prefix}-{today}-{seq:04d}"


@router.post("/organizations")
async def import_organizations(
    file: UploadFile = File(...),
    created_by_email: str = Form(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    owner = _resolve_user(db, created_by_email)
    rows = _read_csv(await file.read())

    created, skipped, errors = 0, [], []
    for i, row in enumerate(rows, start=2):  # row 1 is the header
        name = _s(row, "name")
        if not name:
            errors.append({"row": i, "reason": "Missing organization name"})
            continue
        if db.query(Organization).filter(func.lower(Organization.name) == name.lower()).first():
            skipped.append(name)
            continue

        org = Organization(
            name=name,
            org_type=_s(row, "org_type"),
            parent_org=_s(row, "parent_org"),
            railway_zone=_s(row, "railway_zone"),
            division_workshop=_s(row, "division_workshop"),
            address=_s(row, "address"),
            country=_s(row, "country") or "India",
            state=_s(row, "state"),
            city=_s(row, "city"),
            pin_code=_s(row, "pin_code"),
            gst_number=_s(row, "gst_number"),
            official_phone=_s(row, "official_phone"),
            official_email=_s(row, "official_email"),
            website=_s(row, "website"),
            created_by_id=owner.id,
        )
        db.add(org)
        db.flush()
        created += 1

        for n in range(1, 11):
            c_name = _s(row, f"contact{n}_name")
            if not c_name:
                continue
            db.add(OrgContact(
                org_id=org.id,
                name=c_name,
                designation=_s(row, f"contact{n}_designation"),
                department=_s(row, f"contact{n}_department"),
                email=_s(row, f"contact{n}_email"),
                mobile=_s(row, f"contact{n}_mobile"),
                created_by_id=owner.id,
                created_at=datetime.now(timezone.utc),
            ))

    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}


@router.post("/inquiries")
async def import_inquiries(
    file: UploadFile = File(...),
    created_by_email: str = Form(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    owner = _resolve_user(db, created_by_email)
    rows = _read_csv(await file.read())

    created, errors = 0, []
    for i, row in enumerate(rows, start=2):
        org_name = _s(row, "organization_name")
        if not org_name:
            errors.append({"row": i, "reason": "Missing organization_name"})
            continue
        org = db.query(Organization).filter(func.lower(Organization.name) == org_name.lower()).first()
        if not org:
            errors.append({"row": i, "reason": f"Organization '{org_name}' not found"})
            continue

        contact = None
        contact_name = _s(row, "contact_name")
        if contact_name:
            contact = (
                db.query(OrgContact)
                .filter(OrgContact.org_id == org.id, func.lower(OrgContact.name) == contact_name.lower())
                .first()
            )

        universal_id = _s(row, "universal_id") or _gen_universal_id(db, Inquiry, "INQ")
        db.add(Inquiry(
            universal_id=universal_id,
            org_id=org.id,
            org_contact_id=contact.id if contact else None,
            railway_zone=_s(row, "railway_zone"),
            division=_s(row, "division"),
            lead_source=_s(row, "lead_source"),
            bd_owner=_s(row, "bd_owner"),
            sales_engineer=_s(row, "sales_engineer"),
            status=_s(row, "status") or "New Inquiry",
            current_stage=_s(row, "current_stage") or "Customer Requirement",
            product=_s(row, "product"),
            product_category=_s(row, "product_category"),
            quantity=_f(row, "quantity"),
            unit=_s(row, "unit"),
            required_delivery_date=_d(row, "required_delivery_date"),
            delivery_location=_s(row, "delivery_location"),
            requirement_desc=_s(row, "requirement_desc"),
            budget=_f(row, "budget"),
            created_by_id=owner.id,
        ))
        created += 1

    db.commit()
    return {"created": created, "errors": errors}


@router.post("/tenders")
async def import_tenders(
    file: UploadFile = File(...),
    created_by_email: str = Form(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    owner = _resolve_user(db, created_by_email)
    rows = _read_csv(await file.read())

    created, errors = 0, []
    for i, row in enumerate(rows, start=2):
        org_name = _s(row, "organization_name")
        if not org_name:
            errors.append({"row": i, "reason": "Missing organization_name"})
            continue
        org = db.query(Organization).filter(func.lower(Organization.name) == org_name.lower()).first()
        if not org:
            errors.append({"row": i, "reason": f"Organization '{org_name}' not found"})
            continue

        contact = None
        contact_name = _s(row, "contact_name")
        if contact_name:
            contact = (
                db.query(OrgContact)
                .filter(OrgContact.org_id == org.id, func.lower(OrgContact.name) == contact_name.lower())
                .first()
            )

        universal_id = _s(row, "universal_id") or _gen_universal_id(db, Tender, "TND")
        db.add(Tender(
            universal_id=universal_id,
            org_id=org.id,
            org_contact_id=contact.id if contact else None,
            tender_number=_s(row, "tender_number"),
            tender_name=_s(row, "tender_name"),
            tender_authority=_s(row, "tender_authority"),
            tender_portal=_s(row, "tender_portal"),
            tender_type=_s(row, "tender_type"),
            tender_category=_s(row, "tender_category"),
            tender_value=_f(row, "tender_value"),
            currency=_s(row, "currency") or "INR",
            status=_s(row, "status") or "Active",
            current_stage=_s(row, "current_stage") or "Tender Published",
            railway_zone=_s(row, "railway_zone"),
            division=_s(row, "division"),
            workshop=_s(row, "workshop"),
            publish_date=_d(row, "publish_date"),
            doc_download_date=_d(row, "doc_download_date"),
            pre_bid_meeting_date=_d(row, "pre_bid_meeting_date"),
            query_submission_date=_d(row, "query_submission_date"),
            submission_date=_d(row, "submission_date"),
            opening_date=_d(row, "opening_date"),
            created_by_id=owner.id,
        ))
        created += 1

    db.commit()
    return {"created": created, "errors": errors}


@router.post("/activities")
async def import_activities(
    file: UploadFile = File(...),
    created_by_email: str = Form(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    owner = _resolve_user(db, created_by_email)
    rows = _read_csv(await file.read())

    created, errors = 0, []
    for i, row in enumerate(rows, start=2):
        org_name = _s(row, "organization_name")
        org = None
        if org_name:
            org = db.query(Organization).filter(func.lower(Organization.name) == org_name.lower()).first()
            if not org:
                errors.append({"row": i, "reason": f"Organization '{org_name}' not found"})
                continue

        contact = None
        contact_name = _s(row, "contact_name")
        if contact_name and org:
            contact = (
                db.query(OrgContact)
                .filter(OrgContact.org_id == org.id, func.lower(OrgContact.name) == contact_name.lower())
                .first()
            )

        db.add(Activity(
            activity_type=_s(row, "activity_type"),
            org_id=org.id if org else None,
            org_contact_id=contact.id if contact else None,
            related_module=_s(row, "related_module"),
            next_followup=_d(row, "next_followup"),
            assigned_to=_s(row, "assigned_to"),
            status=_s(row, "status") or "Open",
            remarks=_s(row, "remarks"),
            created_by_id=owner.id,
            created_at=datetime.now(timezone.utc),
        ))
        created += 1

    db.commit()
    return {"created": created, "errors": errors}
