from datetime import date
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.core.permissions import require_feature_action, require_tab_action
from app.core.permission_registry import can_feature, is_admin_user
from app.core.notification_events import notify_event
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from pydantic import BaseModel
from app.modules.organization.models.company import Company
from app.modules.organization.models.company_address import CompanyAddress
from app.modules.organization.models.company_contact import CompanyContact
from app.modules.organization.models.company_financial_year import CompanyFinancialYear
from app.modules.organization.models.company_document import CompanyDocument
from app.modules.organization.schemas.company import (
    CompanyUpdate, CompanyResponse,
    CompanyAddressCreate, CompanyAddressUpdate, CompanyAddressResponse,
    CompanyContactCreate, CompanyContactUpdate, CompanyContactResponse,
    CompanyFinancialYearCreate, CompanyFinancialYearUpdate, CompanyFinancialYearResponse,
    CompanyDocumentResponse,
)
from app.utils.sharepoint import (
    upload_file_to_sharepoint, sanitize_folder_name, delete_file_from_sharepoint, download_file_content,
)

router = APIRouter(prefix="/organization/company", tags=["Organization - Company Info"])


# Company Info › Legal, registration & tax (core/features/organization.py).
# Booleans (TDS / TCS applicable) stay in the response — the schema needs them
# and they carry no registration data; the tab itself is hidden in the UI.
STATUTORY_FIELDS = (
    "legal_entity_type", "legal_status", "cin", "pan", "tan", "gstin", "udyam_registration_no", "iec",
    "msme_registration_no", "pf_registration_no", "esic_registration_no", "other_registration_type",
    "other_registration_number", "other_registration_date", "issuing_authority", "expiry_date",
    "authorized_capital", "paid_up_capital", "legal_representative",
    "gst_registration_type", "default_tax_region", "tax_deductibility", "tax_registration_status", "tax_effective_date",
)
STATUTORY_EDIT_FIELDS = STATUTORY_FIELDS + ("tds_applicable", "tcs_applicable")


def _company_out(company: Company, user: User) -> CompanyResponse:
    """The company row, with the statutory fields blanked for a role without
    Company Info › Legal, registration & tax › View (nothing changes in the DB)."""
    out = CompanyResponse.model_validate(company)
    if not can_feature(user, "organization", "info", "statutory", "view"):
        out = out.model_copy(update={k: None for k in STATUTORY_FIELDS})
    return out


def _guard_statutory(user: User, changes: dict, company: Company | None) -> None:
    """Drop / refuse statutory changes from a role without its Edit. Values
    left as they are (or the blanks a role without View was shown) are
    simply not saved, so editing the other tabs never wipes them."""
    if can_feature(user, "organization", "info", "statutory", "edit"):
        return
    sees = can_feature(user, "organization", "info", "statutory", "view")
    changed = []
    for k in STATUTORY_EDIT_FIELDS:
        if k not in changes:
            continue
        current = getattr(company, k, None) if company else None
        if changes[k] == current or (not sees and changes[k] is None):
            del changes[k]
        else:
            changed.append(k)
    if changed:
        raise HTTPException(
            status_code=403,
            detail=f"You can't change the legal / registration / tax details ({', '.join(changed[:5])}"
                   f"{'…' if len(changed) > 5 else ''}) — your role lacks Organization › Company Info › Legal, registration & tax › Edit. "
                   "Leave those fields as they are, or ask an admin to add it to one of "
                   "your roles in Organization › Role & Permissions.",
        )


def _get_company(db: Session) -> Company:
    company = db.query(Company).order_by(Company.id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company info has not been set up yet")
    return company


@router.get("", response_model=CompanyResponse)
async def get_company_info(
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "info", "view")),
):
    """Single-tenant deployments keep exactly one companies row — this is the
    org's own master info (used on letterheads, invoices, etc.), not a list
    of external companies."""
    return _company_out(_get_company(db), _user)


@router.post("", response_model=CompanyResponse, status_code=201)
async def create_company_info(
    payload: CompanyUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "info", "edit")),
):
    """One-time setup: creates the single companies row. Nothing else in this
    module can create it (GET/PATCH both 404 until it exists — see
    _get_company), so without this endpoint Company Info is permanently
    unusable on any database that doesn't already have a hand-inserted row."""
    if db.query(Company).first():
        raise HTTPException(status_code=409, detail="Company info already exists")
    if not payload.name or not payload.name.strip():
        raise HTTPException(status_code=422, detail="Company name is required")
    if not payload.code or not payload.code.strip():
        raise HTTPException(status_code=422, detail="Company code is required")
    data = payload.model_dump(exclude_unset=True)
    _guard_statutory(_user, data, None)
    company = Company(**data)
    db.add(company)
    db.commit()
    db.refresh(company)
    return _company_out(company, _user)


@router.patch("", response_model=CompanyResponse)
async def update_company_info(
    payload: CompanyUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "info", "edit")),
):
    company = _get_company(db)
    changes = payload.model_dump(exclude_unset=True)
    _guard_statutory(_user, changes, company)
    # Same rule as create: name and code are mandatory, so a PATCH may change
    # them but never blank them out.
    if "name" in changes and (changes["name"] is None or not str(changes["name"]).strip()):
        raise HTTPException(status_code=422, detail="Company name cannot be blank — enter the registered company name or leave the field unchanged.")
    if "code" in changes and (changes["code"] is None or not str(changes["code"]).strip()):
        raise HTTPException(status_code=422, detail="Company code cannot be blank — enter a short company code or leave the field unchanged.")
    stat_changed = [k for k in STATUTORY_EDIT_FIELDS if k in changes and getattr(company, k, None) != changes[k]]
    for field, value in changes.items():
        setattr(company, field, value)
    if stat_changed:
        names = ", ".join(k.replace("_", " ").upper() if len(k) <= 5 else k.replace("_", " ") for k in stat_changed[:6])
        notify_event(db, background_tasks, "organization", "statutory_changed",
                     title="Company legal / tax details changed",
                     message=f"{_user.name or _user.email} changed {names}{' …' if len(stat_changed) > 6 else ''} in Organization › Company Info. "
                             "Check documents that print them (invoices, POs, letterheads).",
                     entity_type="company", entity_id=company.id, actor=_user)
    db.commit()
    db.refresh(company)
    return _company_out(company, _user)


# ---------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------

# ── Partners: the company's top approval level ──────────────────────────────
# Partners are portal users (synced from Azure) flagged is_partner. They are
# the last step of the legacy PO approval chain, get management escalations,
# see P2P MIS, and are the default signatory on letters/certificates. Managed
# only here, so there is exactly one place that grants top-level authority.

class PartnersUpdate(BaseModel):
    user_ids: list[int]


def _partner_rows(db: Session) -> list[dict]:
    rows = db.query(User).filter(User.is_partner.is_(True)).order_by(User.name).all()
    return [{"id": u.id, "name": u.name, "email": u.email, "designation": u.designation, "is_active": u.is_active} for u in rows]


@router.get("/partners")
async def list_partners(db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "info", "partners", "view"))):
    return _partner_rows(db)


@router.put("/partners")
async def set_partners(payload: PartnersUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(require_feature_action("organization", "info", "partners", "edit"))):
    wanted = set(payload.user_ids)
    users = db.query(User).filter(User.id.in_(wanted)).all() if wanted else []
    missing = wanted - {u.id for u in users}
    if missing:
        raise HTTPException(status_code=404, detail=f"User id(s) {sorted(missing)} not found — refresh the page and pick again.")
    inactive = [u.name or u.email for u in users if not u.is_active]
    if inactive:
        raise HTTPException(status_code=422, detail=f"{', '.join(inactive)} is deactivated (no longer in Azure / exited) and can't be a partner. Remove them from the list.")
    current = db.query(User).filter(User.is_partner.is_(True)).all()
    removed = [u for u in current if u.id not in wanted]
    added = [u for u in users if not u.is_partner]
    # Partner = top approval authority: a non-admin holding Company Info 'Edit'
    # may maintain the list, but never add or remove themselves.
    if not is_admin_user(user) and any(u.id == user.id for u in added + removed):
        raise HTTPException(
            status_code=403,
            detail="You can't add or remove yourself as a Partner — Partner is the top approval level. "
                   "Ask an admin to make this change.",
        )
    for u in removed:
        u.is_partner = False
    for u in added:
        u.is_partner = True
    if added or removed:
        parts = []
        if added:
            parts.append("added " + ", ".join(u.name or u.email for u in added))
        if removed:
            parts.append("removed " + ", ".join(u.name or u.email for u in removed))
        company = db.query(Company).first()
        db.add(AuditLog(entity_type="company", entity_id=company.id if company else 0, action="partners_updated",
                        performed_by_id=user.id, summary=f"{user.name or user.email} {' and '.join(parts)} as partner"))
        notify_event(db, background_tasks, "organization", "partners_changed", title="Company Partners changed",
                     message=f"{user.name or user.email} {' and '.join(parts)} as Partner (the top approval level). "
                             "Final approvals, escalations and signatories follow the new list.",
                     entity_type="company", entity_id=company.id if company else None, actor=user)
    db.commit()
    return _partner_rows(db)


@router.get("/addresses", response_model=list[CompanyAddressResponse])
async def list_addresses(db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "info", "view"))):
    company = _get_company(db)
    return db.query(CompanyAddress).filter(CompanyAddress.company_id == company.id).order_by(CompanyAddress.id).all()


@router.post("/addresses", response_model=CompanyAddressResponse)
async def create_address(payload: CompanyAddressCreate, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "info", "edit"))):
    company = _get_company(db)
    if payload.is_primary:
        db.query(CompanyAddress).filter(CompanyAddress.company_id == company.id).update({"is_primary": False})
    address = CompanyAddress(company_id=company.id, **payload.model_dump())
    db.add(address)
    db.commit()
    db.refresh(address)
    return address


@router.patch("/addresses/{address_id}", response_model=CompanyAddressResponse)
async def update_address(address_id: int, payload: CompanyAddressUpdate, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "info", "edit"))):
    company = _get_company(db)
    address = db.query(CompanyAddress).filter(CompanyAddress.id == address_id, CompanyAddress.company_id == company.id).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary"):
        db.query(CompanyAddress).filter(CompanyAddress.company_id == company.id, CompanyAddress.id != address_id).update({"is_primary": False})
    for field, value in data.items():
        setattr(address, field, value)
    db.commit()
    db.refresh(address)
    return address


@router.delete("/addresses/{address_id}")
async def delete_address(address_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "info", "edit"))):
    company = _get_company(db)
    address = db.query(CompanyAddress).filter(CompanyAddress.id == address_id, CompanyAddress.company_id == company.id).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    db.delete(address)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------

@router.get("/contacts", response_model=list[CompanyContactResponse])
async def list_contacts(db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "info", "view"))):
    company = _get_company(db)
    return db.query(CompanyContact).filter(CompanyContact.company_id == company.id).order_by(CompanyContact.id).all()


@router.post("/contacts", response_model=CompanyContactResponse)
async def create_contact(payload: CompanyContactCreate, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "info", "edit"))):
    company = _get_company(db)
    if payload.is_primary:
        db.query(CompanyContact).filter(CompanyContact.company_id == company.id).update({"is_primary": False})
    contact = CompanyContact(company_id=company.id, **payload.model_dump())
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@router.patch("/contacts/{contact_id}", response_model=CompanyContactResponse)
async def update_contact(contact_id: int, payload: CompanyContactUpdate, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "info", "edit"))):
    company = _get_company(db)
    contact = db.query(CompanyContact).filter(CompanyContact.id == contact_id, CompanyContact.company_id == company.id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary"):
        db.query(CompanyContact).filter(CompanyContact.company_id == company.id, CompanyContact.id != contact_id).update({"is_primary": False})
    for field, value in data.items():
        setattr(contact, field, value)
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "info", "edit"))):
    company = _get_company(db)
    contact = db.query(CompanyContact).filter(CompanyContact.id == contact_id, CompanyContact.company_id == company.id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Financial Years
# ---------------------------------------------------------------------------

# "Locked" was offered by the UI but nothing enforced it (accounts only blocks
# 'closed'); freezing books up to a date is what lock_date is for.
FY_STATUSES = ("open", "closed")


def _check_fy_status(status: str | None) -> str:
    value = (status or "open").strip().lower()
    if value not in FY_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Status '{status}' isn't supported — use Open or Closed. "
                "To freeze books up to a date, set the Lock Date instead."
            ),
        )
    return value


def _check_fy_overlap(db: Session, company_id: int, name: str, start: date, end: date, exclude_id: int | None = None) -> None:
    q = db.query(CompanyFinancialYear).filter(
        CompanyFinancialYear.company_id == company_id,
        CompanyFinancialYear.start_date <= end,
        CompanyFinancialYear.end_date >= start,
    )
    if exclude_id is not None:
        q = q.filter(CompanyFinancialYear.id != exclude_id)
    clash = q.order_by(CompanyFinancialYear.start_date).first()
    if clash:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{name} overlaps {clash.name} ({clash.start_date:%d-%b-%Y} → {clash.end_date:%d-%b-%Y}). "
                "Adjust the dates so years don't overlap."
            ),
        )


def _posted_journal_count(db: Session, start: date, end: date) -> int:
    from app.modules.accounts.models.journal_entry import JournalEntry
    return db.query(JournalEntry).filter(
        JournalEntry.status == "posted", JournalEntry.posting_date >= start, JournalEntry.posting_date <= end,
    ).count()


def _check_fy_status_matches_books(db: Session, status: str, start: date, end: date) -> None:
    """Open/Closed set here must agree with Accounts' year-end close, which
    owns the closing JV (accounts/services/closing.py)."""
    from app.modules.accounts.models.journal_entry import JournalEntry
    from app.modules.accounts.services.fiscal import fy_code

    code = fy_code(start, end)
    has_close = db.query(JournalEntry).filter(
        JournalEntry.posting_type == "year_end", JournalEntry.financial_year == code,
        JournalEntry.status == "posted",
    ).first() is not None
    if status == "open" and has_close:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Financial year {code} has a posted year-end closing entry, so it can't be reopened here. "
                "Reopen it from Accounts > Year-end close, which reverses the closing entry."
            ),
        )
    if status == "closed" and not has_close and _posted_journal_count(db, start, end):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Financial year {code} has postings but no year-end closing entry, so it can't be marked closed "
                "here. Close it from Accounts > Year-end close, which posts the closing entry and closes the year."
            ),
        )

@router.get("/financial-years", response_model=list[CompanyFinancialYearResponse])
async def list_financial_years(db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "info", "financial_years", "view"))):
    company = _get_company(db)
    return db.query(CompanyFinancialYear).filter(CompanyFinancialYear.company_id == company.id).order_by(CompanyFinancialYear.start_date.desc()).all()


@router.post("/financial-years", response_model=CompanyFinancialYearResponse)
async def create_financial_year(payload: CompanyFinancialYearCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "info", "financial_years", "edit"))):
    company = _get_company(db)
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="End date must be on or after the start date")
    payload.status = _check_fy_status(payload.status)
    _check_fy_overlap(db, company.id, payload.name, payload.start_date, payload.end_date)
    _check_fy_status_matches_books(db, payload.status, payload.start_date, payload.end_date)
    fy = CompanyFinancialYear(company_id=company.id, **payload.model_dump())
    db.add(fy)
    notify_event(db, background_tasks, "organization", "financial_year_changed", title=f"Financial year {fy.name} added",
                 message=f"{_user.name or _user.email} added financial year {fy.name} ({fy.start_date:%d-%b-%Y} → {fy.end_date:%d-%b-%Y}, {fy.status}).",
                 entity_type="company", entity_id=company.id, actor=_user)
    db.commit()
    db.refresh(fy)
    return fy


@router.patch("/financial-years/{fy_id}", response_model=CompanyFinancialYearResponse)
async def update_financial_year(fy_id: int, payload: CompanyFinancialYearUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "info", "financial_years", "edit"))):
    company = _get_company(db)
    fy = db.query(CompanyFinancialYear).filter(CompanyFinancialYear.id == fy_id, CompanyFinancialYear.company_id == company.id).first()
    if not fy:
        raise HTTPException(status_code=404, detail="Financial year not found")
    data = payload.model_dump(exclude_unset=True)
    start = data.get("start_date", fy.start_date)
    end = data.get("end_date", fy.end_date)
    if end < start:
        raise HTTPException(status_code=400, detail="End date must be on or after the start date")
    if "status" in data and data["status"] == fy.status:
        # Unchanged (possibly a legacy value like 'locked') — don't reject an
        # edit to the name/dates/lock date over a status nobody touched.
        del data["status"]
    if "status" in data:
        data["status"] = _check_fy_status(data["status"])
    if start != fy.start_date or end != fy.end_date:
        _check_fy_overlap(db, company.id, data.get("name", fy.name), start, end, exclude_id=fy.id)
    if "status" in data and data["status"] != (fy.status or "open").lower():
        _check_fy_status_matches_books(db, data["status"], start, end)
    old_status = fy.status
    for field, value in data.items():
        setattr(fy, field, value)
    if "status" in data and data["status"] != old_status:
        notify_event(db, background_tasks, "organization", "financial_year_changed", title=f"Financial year {fy.name} is now {fy.status}",
                     message=f"{_user.name or _user.email} changed financial year {fy.name} from {old_status or '—'} to {fy.status}.",
                     entity_type="company", entity_id=company.id, actor=_user)
    db.commit()
    db.refresh(fy)
    return fy


@router.delete("/financial-years/{fy_id}")
async def delete_financial_year(fy_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "info", "financial_years", "edit"))):
    company = _get_company(db)
    fy = db.query(CompanyFinancialYear).filter(CompanyFinancialYear.id == fy_id, CompanyFinancialYear.company_id == company.id).first()
    if not fy:
        raise HTTPException(status_code=404, detail="Financial year not found")
    if (fy.status or "").lower() == "closed":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Can't delete {fy.name} — it is closed. Deleting it would drop the closed status while its "
                "year-end closing entry stays in the books. Reopen it from Accounts > Year-end close first."
            ),
        )
    posted = _posted_journal_count(db, fy.start_date, fy.end_date)
    if posted:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Can't delete {fy.name} — it has {posted} posted journal entr{'y' if posted == 1 else 'ies'} "
                f"dated {fy.start_date:%d-%b-%Y} → {fy.end_date:%d-%b-%Y}. Postings must always fall inside a "
                "financial year; correct the dates or name instead of deleting it."
            ),
        )
    db.delete(fy)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@router.get("/documents", response_model=list[CompanyDocumentResponse])
async def list_documents(db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "info", "documents", "view"))):
    company = _get_company(db)
    return db.query(CompanyDocument).filter(CompanyDocument.company_id == company.id).order_by(CompanyDocument.id.desc()).all()


@router.post("/documents", response_model=CompanyDocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    document_type: str = Form(...),
    document_name: str = Form(...),
    document_number: str | None = Form(None),
    issue_date: date | None = Form(None),
    expiry_date: date | None = Form(None),
    issuing_authority: str | None = Form(None),
    description: str | None = Form(None),
    confidentiality: str | None = Form(None),
    tags: str | None = Form(None),
    remarks: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("organization", "info", "documents", "create")),
):
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    company = _get_company(db)

    folder_path = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/company-documents"
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, file)

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None

    document = CompanyDocument(
        company_id=company.id,
        document_type=document_type,
        document_name=document_name,
        document_number=document_number,
        issue_date=issue_date,
        expiry_date=expiry_date,
        issuing_authority=issuing_authority,
        filename=result["name"],
        content_type=file.content_type,
        size=result["size"],
        sharepoint_path=result["path"],
        sharepoint_url=result.get("webUrl"),
        description=description,
        confidentiality=confidentiality,
        tags=tag_list,
        remarks=remarks,
        created_by_id=user.id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/documents/{document_id}/content")
async def get_document_content(document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "info", "documents", "export"))):
    company = _get_company(db)
    document = db.query(CompanyDocument).filter(CompanyDocument.id == document_id, CompanyDocument.company_id == company.id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, document.sharepoint_path or "")
    return Response(
        content=content,
        media_type=document.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{document.filename}"'},
    )


@router.delete("/documents/{document_id}")
async def delete_document(document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "info", "documents", "delete"))):
    company = _get_company(db)
    document = db.query(CompanyDocument).filter(CompanyDocument.id == document_id, CompanyDocument.company_id == company.id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if settings.SHAREPOINT_SITE_ID and document.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, document.sharepoint_path)
        except HTTPException:
            pass
    db.delete(document)
    db.commit()
    return {"ok": True}
