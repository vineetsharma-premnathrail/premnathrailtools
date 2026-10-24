"""Procurement → Vendors: the vendor master (owned by Accounts, table
`vendors`) managed from Procurement, plus each vendor's documents and catalog.

One master for both teams (decided 2026-10-07): RFQ vendor slots and POs link
to it, so Finance matches the vendor invoice to the PO. Procurement edits the
commercial / contact fields; bank, credit and GL fields stay with Finance
(Accounts → Vendors) — segregation of duties.

Access: reads (list/detail/catalog/meta) — Procurement › Vendors view, the
Purchase desk or Accounts (cross-module lookup); every write needs the
matching Procurement › Vendors action (admins always)."""
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.notify_rules import fire_rule
from app.core.permission_registry import can_view_tab
from app.core.permissions import GRANT_HINT, ensure_can_delete, ensure_feature_action, require_tab_action
from app.modules.p2p.pricing import mask_for, sees_prices
from app.modules.main.routes.auth import get_current_user
from app.db.session import get_db
from app.modules.accounts.models.vendor import GST_REGISTRATION_TYPES, VENDOR_STATUSES, Vendor
from app.modules.accounts.models.vendor_catalog_item import VendorCatalogItem
from app.modules.accounts.models.vendor_document import VENDOR_DOC_TYPES, VendorDocument
from app.modules.accounts.routes.vendors import _clean_tax_fields, check_msme
from app.modules.accounts.services.vendor_referral import REFERRAL_FIELDS, clean_referral, vendor_people
from app.modules.erp.importing import (
    check_date_range, check_rows, csv_template, in_range, ist_date, norm_key, parse_export_ids, parse_number,
    norm_header, read_rows, text, xlsx_response,
)
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.utils.sharepoint import build_sharepoint_folder_path, download_file_content, upload_file_to_sharepoint

router = APIRouter(prefix="/p2p/vendors", tags=["P2P - Vendors"])


def _lookup(user: User = Depends(get_current_user)) -> User:
    """Read access to the vendor master. Besides 'View' on Procurement ›
    Vendors, the Purchase desk (RFQ vendor slots, PO drafts pick vendors from
    here) and Accounts (the shared master, owned by Finance) keep reading it —
    a cross-module lookup, so it is not tied to the Vendors tab alone."""
    if can_view_tab(user, "p2p", "vendors") or {"purchase", "accounts"} & set(user.get_apps()):
        return user
    raise HTTPException(status_code=403, detail=f"You don't have 'View' permission on Procurement › Vendors. {GRANT_HINT}")


_create = require_tab_action("p2p", "vendors", "create")
_edit = require_tab_action("p2p", "vendors", "edit")
_export = require_tab_action("p2p", "vendors", "export")
_import = require_tab_action("p2p", "vendors", "import")
_view = require_tab_action("p2p", "vendors", "view")


def _ensure_vendor_feature(user: User, feature: str, action: str) -> None:
    """A Procurement › Vendors feature (core/features/p2p.py). It governs the
    holders of Vendors › View; the Purchase desk and Accounts read the vendor
    master as a cross-module lookup (_lookup) and are not affected."""
    if can_view_tab(user, "p2p", "vendors"):
        ensure_feature_action(user, "p2p", "vendors", feature, action)

_NOT_FOUND = "Vendor not found — it may have been removed. Refresh the vendor list."


# ---------------------------------------------------------------- schemas

class VendorPayload(BaseModel):
    code: str | None = None          # blank on create = next V-0001 style code
    name: str | None = None          # vendor company name
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    gstin: str | None = None
    pan: str | None = None
    gst_registration_type: str | None = None
    website: str | None = None
    terms_conditions: str | None = None
    status: str | None = None
    # MSME (accounts/services/msme.py): payment limit + 43B(h).
    payment_days: int | None = None
    msme_category: str | None = None
    udyam_number: str | None = None
    msme_activity: str | None = None
    msme_valid_from: date | None = None
    # Who referred the vendor (accounts/services/vendor_referral.py).
    referral_type: str | None = None  # employee / external / direct
    referred_by_user_id: int | None = None
    referred_by_name: str | None = None
    referred_by_phone: str | None = None


class CatalogItemPayload(BaseModel):
    item_name: str | None = None
    part_code: str | None = None
    make: str | None = None
    unit: str | None = None
    unit_price: float | None = None
    currency: str | None = None
    dimensions: str | None = None
    technical_spec: str | None = None
    lead_time_days: int | None = None
    remarks: str | None = None
    is_active: bool | None = None
    # ME11 info record fields (2026-10-14): the Item Master item this line is
    # (the key PO prices default by), MOQ and validity.
    store_item_id: int | None = None
    min_order_qty: float | None = None
    valid_from: date | None = None
    valid_to: date | None = None


# ---------------------------------------------------------------- helpers

def _audit(db: Session, vendor_id: int, action: str, user: User, summary: str) -> None:
    db.add(AuditLog(entity_type="vendor", entity_id=vendor_id, action=action, performed_by_id=user.id, summary=summary,
                    module_key="p2p", subtab_key="vendors"))


def _next_code(db: Session) -> str:
    nums = []
    for (code,) in db.query(Vendor.code).filter(Vendor.code.like("V-%")).all():
        tail = code[2:]
        if tail.isdigit():
            nums.append(int(tail))
    return f"V-{(max(nums) + 1) if nums else 1:04d}"


def _get(db: Session, vendor_id: int) -> Vendor:
    v = db.get(Vendor, vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return v


def _row(v: Vendor, docs: int = 0, items: int = 0, people: dict | None = None) -> dict:
    return {
        **(people or {"created_by_name": None, "referred_by_user_name": None, "referred_by_label": None}),
        "created_by_id": v.created_by_id, "referral_type": v.referral_type, "referred_by_user_id": v.referred_by_user_id,
        "referred_by_name": v.referred_by_name, "referred_by_phone": v.referred_by_phone,
        "id": v.id, "code": v.code, "name": v.name, "contact_name": v.contact_name, "contact_phone": v.contact_phone,
        "contact_email": v.contact_email, "address": v.address, "city": v.city, "state": v.state, "pin_code": v.pin_code,
        "gstin": v.gstin, "pan": v.pan, "gst_registration_type": v.gst_registration_type, "website": v.website,
        "terms_conditions": v.terms_conditions, "status": v.status, "payment_days": v.payment_days,
        "msme_category": v.msme_category, "udyam_number": v.udyam_number, "msme_activity": v.msme_activity,
        "msme_valid_from": v.msme_valid_from.isoformat() if v.msme_valid_from else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "document_count": docs, "catalog_count": items,
    }


def _counts(db: Session, ids: list[int]) -> tuple[dict, dict]:
    if not ids:
        return {}, {}
    docs = dict(db.query(VendorDocument.vendor_id, func.count(VendorDocument.id)).filter(VendorDocument.vendor_id.in_(ids)).group_by(VendorDocument.vendor_id).all())
    items = dict(db.query(VendorCatalogItem.vendor_id, func.count(VendorCatalogItem.id)).filter(
        VendorCatalogItem.vendor_id.in_(ids), VendorCatalogItem.is_active == True,  # noqa: E712
    ).group_by(VendorCatalogItem.vendor_id).all())
    return docs, items


def _clean(data: dict, *, creating: bool, db: Session | None = None, current: Vendor | None = None) -> dict:
    for k, v in list(data.items()):
        if isinstance(v, str):
            data[k] = v.strip() or None
    if creating or "name" in data:
        if not data.get("name"):
            raise HTTPException(status_code=422, detail="Vendor company name is required.")
    if data.get("status") is not None and data["status"] not in VENDOR_STATUSES:
        raise HTTPException(status_code=422, detail=f"Status must be one of: {', '.join(VENDOR_STATUSES)}.")
    if creating and not data.get("gst_registration_type"):
        data["gst_registration_type"] = "regular" if data.get("gstin") else "unregistered"
    if db is not None:
        clean_referral(db, data, current)
    return _clean_tax_fields(data)


def _import_referral(db: Session, raw: str | None) -> dict:
    """'Referred By' cell: blank = not recorded; 'Direct' = nobody; an active
    employee's email = that employee; anything else = an external referrer."""
    if not raw:
        return {}
    if raw.strip().lower() in ("direct", "none", "no referral"):
        return {"referral_type": "direct"}
    u = db.query(User).filter(func.lower(User.email) == raw.strip().lower(), User.is_active == True).first()  # noqa: E712
    if u:
        return {"referral_type": "employee", "referred_by_user_id": u.id}
    return {"referral_type": "external", "referred_by_name": raw.strip()}


def _dup_check(db: Session, data: dict, exclude_id: int | None = None) -> None:
    q = db.query(Vendor)
    if exclude_id:
        q = q.filter(Vendor.id != exclude_id)
    if data.get("code") and q.filter(Vendor.code == data["code"]).first():
        raise HTTPException(status_code=409, detail=f"Vendor code '{data['code']}' is already used — leave it blank for the next free code.")
    if data.get("gstin"):
        clash = q.filter(Vendor.gstin == data["gstin"]).first()
        if clash:
            raise HTTPException(status_code=409, detail=f"GSTIN {data['gstin']} is already on vendor {clash.name} ({clash.code}) — open that vendor instead.")


# ---------------------------------------------------------------- vendors

@router.get("/meta")
def vendor_meta(_user: User = Depends(_lookup)):
    return {
        "statuses": list(VENDOR_STATUSES),
        "gst_registration_types": list(GST_REGISTRATION_TYPES),
        "doc_types": [{"value": k, "label": v} for k, v in VENDOR_DOC_TYPES.items()],
    }


@router.get("")
def list_vendors(
    search: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(_lookup),
):
    q = db.query(Vendor)
    if status:
        q = q.filter(Vendor.status == status)
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(Vendor.name.ilike(like), Vendor.code.ilike(like), Vendor.gstin.ilike(like), Vendor.city.ilike(like),
                         Vendor.contact_name.ilike(like)))
    vendors = q.order_by(Vendor.name).all()
    docs, items = _counts(db, [v.id for v in vendors])
    people = vendor_people(db, vendors)
    return [_row(v, docs.get(v.id, 0), items.get(v.id, 0), people[v.id]) for v in vendors]


@router.get("/for-item")
def vendors_for_item(store_item_id: int = Query(...), db: Session = Depends(get_db), _user: User = Depends(_lookup)):
    """Active vendors with an info record (catalog line linked to the Item
    Master) for `store_item_id` — used when picking RFQ vendors, cheapest
    first. Keyed by the Item Master id only: catalog lines are never matched
    to an item by name or part code (link old lines in Procurement › Info
    Records)."""
    rows = db.query(VendorCatalogItem, Vendor).join(Vendor, Vendor.id == VendorCatalogItem.vendor_id).filter(
        Vendor.status == "active", VendorCatalogItem.is_active == True,  # noqa: E712
        VendorCatalogItem.store_item_id == store_item_id,
    ).all()
    rows.sort(key=lambda r: (r[0].unit_price is None, r[0].unit_price or 0))
    return mask_for(_user, "vendors", [
        {"vendor_id": v.id, "vendor_name": v.name, "item_name": c.item_name, "part_code": c.part_code, "make": c.make,
         "unit": c.unit, "unit_price": c.unit_price, "currency": c.currency, "lead_time_days": c.lead_time_days,
         "store_item_id": c.store_item_id, "min_order_qty": c.min_order_qty} for c, v in rows])


@router.post("", status_code=201)
def create_vendor(payload: VendorPayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(_create)):
    data = _clean(payload.model_dump(exclude_unset=True), creating=True, db=db)
    data["code"] = data.get("code") or _next_code(db)
    data["status"] = data.get("status") or "active"
    _dup_check(db, data)
    v = Vendor(**data, created_by_id=user.id)
    check_msme(v)
    db.add(v)
    db.flush()
    _audit(db, v.id, "created", user, f"Vendor {v.name} ({v.code}) added by {user.name or user.email}.")
    fire_rule(db, background_tasks, "p2p", "vendor_create", "New Vendor Added",
              f"Vendor {v.name} ({v.code}) was added by {user.name or user.email}.", "vendor", v.id, user,
              [("Vendor", v.name), ("Code", v.code), ("GSTIN", v.gstin or ""), ("City", v.city or ""),
               ("Contact", " · ".join(x for x in (v.contact_name, v.contact_phone) if x)), ("Added by", user.name or user.email)])
    db.commit()
    db.refresh(v)
    return _row(v, people=vendor_people(db, [v])[v.id])


@router.get("/export")
def export_vendors(
    search: str | None = None,
    ids: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(_export),
):
    selected = parse_export_ids(ids, "vendors")
    check_date_range(date_from, date_to)
    if selected is not None:
        vendors = db.query(Vendor).filter(Vendor.id.in_(selected)).order_by(Vendor.name).all()
    else:
        q = db.query(Vendor)
        if search and search.strip():
            like = f"%{search.strip()}%"
            q = q.filter(or_(Vendor.name.ilike(like), Vendor.code.ilike(like), Vendor.gstin.ilike(like), Vendor.city.ilike(like),
                             Vendor.contact_name.ilike(like)))
        vendors = [v for v in q.order_by(Vendor.name).all() if in_range(ist_date(v.created_at), date_from, date_to)]
    docs, items = _counts(db, [v.id for v in vendors])
    people = vendor_people(db, vendors)
    headers = ["Code", "Company", "Contact Person", "Phone", "Email", "Address", "City", "State", "PIN", "GSTIN", "PAN",
               "GST Registration", "Website", "Status", "Catalog Items", "Documents", "Terms & Conditions", "Added On", "Added By", "Referred By"]
    rows = [[v.code, v.name, v.contact_name or "", v.contact_phone or "", v.contact_email or "", v.address or "", v.city or "",
             v.state or "", v.pin_code or "", v.gstin or "", v.pan or "", v.gst_registration_type or "", v.website or "",
             v.status, items.get(v.id, 0), docs.get(v.id, 0), v.terms_conditions or "", ist_date(v.created_at) or "",
             people[v.id]["created_by_name"] or "", people[v.id]["referred_by_label"] or ""] for v in vendors]
    return xlsx_response("Vendors", headers, rows, "vendors.xlsx")


VENDOR_IMPORT_COLUMNS = [
    ("company_name", "Company Name *"), ("contact_person", "Contact Person"), ("phone", "Phone"), ("email", "Email"),
    ("address", "Address"), ("city", "City"), ("state", "State"), ("pin_code", "PIN"), ("gstin", "GSTIN"),
    ("website", "Website"), ("terms_conditions", "Terms & Conditions"),
    ("referred_by", "Referred By"),
]


@router.get("/import/template")
def vendor_import_template(_user: User = Depends(_import)):
    return csv_template(VENDOR_IMPORT_COLUMNS, [["Shree Hydraulics Pvt Ltd", "Rakesh Jain", "9876543210", "sales@shreehyd.in",
                                                 "Plot 12, MIDC", "Pune", "Maharashtra", "411019", "", "shreehyd.in", "30 days credit", "Direct"]],
                        "vendor_import_template.csv")


@router.post("/import")
async def import_vendors(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(_import)):
    """Adds new vendors; a row whose company name (or GSTIN) is already in the
    master is reported as existing and left unchanged."""
    rows = _rekey(read_rows(file.filename, await file.read()), VENDOR_IMPORT_COLUMNS)
    check_rows(rows, ["company_name"])
    existing_names = {norm_key(n) for (n,) in db.query(Vendor.name).all()}
    existing_gst = {g for (g,) in db.query(Vendor.gstin).filter(Vendor.gstin.isnot(None)).all()}
    created, existing, errors = [], [], []
    for n, r in enumerate(rows, start=2):
        name = text(r, "company_name")
        if not name:
            errors.append({"row": n, "reason": "Company Name is empty."})
            continue
        data = {"name": name, "contact_name": text(r, "contact_person"), "contact_phone": text(r, "phone"),
                "contact_email": text(r, "email"), "address": text(r, "address"), "city": text(r, "city"),
                "state": text(r, "state"), "pin_code": text(r, "pin_code"), "gstin": text(r, "gstin"),
                "website": text(r, "website"), "terms_conditions": text(r, "terms_conditions")}
        data.update(_import_referral(db, text(r, "referred_by")))
        if norm_key(name) in existing_names or (data["gstin"] and data["gstin"].upper() in existing_gst):
            existing.append(name)
            continue
        try:
            data = _clean(data, creating=True, db=db)
        except HTTPException as e:
            errors.append({"row": n, "reason": f"{name}: {e.detail}"})
            continue
        v = Vendor(**data, code=_next_code(db), status="active", created_by_id=user.id)
        db.add(v)
        db.flush()
        existing_names.add(norm_key(name))
        if v.gstin:
            existing_gst.add(v.gstin)
        created.append(name)
    if created:
        db.add(AuditLog(entity_type="vendor", entity_id=None, action="imported", performed_by_id=user.id, module_key="p2p",
                        subtab_key="vendors", summary=f"{len(created)} vendor(s) imported from {file.filename} by {user.name or user.email}."))
    db.commit()
    return {"created": created, "existing": existing, "errors": errors}


@router.get("/{vendor_id}")
def get_vendor(vendor_id: int, db: Session = Depends(get_db), _user: User = Depends(_lookup)):
    v = _get(db, vendor_id)
    docs, items = _counts(db, [v.id])
    return _row(v, docs.get(v.id, 0), items.get(v.id, 0), vendor_people(db, [v])[v.id])


@router.patch("/{vendor_id}")
def update_vendor(vendor_id: int, payload: VendorPayload, db: Session = Depends(get_db), user: User = Depends(_edit)):
    v = _get(db, vendor_id)
    data = _clean(payload.model_dump(exclude_unset=True), creating=False, db=db, current=v)
    if "code" in data and not data["code"]:
        raise HTTPException(status_code=422, detail="Vendor code can't be blank.")
    _dup_check(db, data, exclude_id=v.id)
    changed = [k for k, val in data.items() if getattr(v, k) != val]
    for k, val in data.items():
        setattr(v, k, val)
    check_msme(v)
    if changed:
        shown = list(dict.fromkeys("referred by" if k in REFERRAL_FIELDS else k for k in changed))
        _audit(db, v.id, "updated", user, f"{user.name or user.email} updated vendor {v.name}: {', '.join(shown)}.")
    db.commit()
    docs, items = _counts(db, [v.id])
    return _row(v, docs.get(v.id, 0), items.get(v.id, 0), vendor_people(db, [v])[v.id])


# ---------------------------------------------------------------- documents

def _doc_row(d: VendorDocument) -> dict:
    return {"id": d.id, "doc_type": d.doc_type, "doc_type_label": VENDOR_DOC_TYPES.get(d.doc_type, d.doc_type),
            "file_name": d.file_name, "file_size": d.file_size, "mime_type": d.mime_type,
            "uploaded_by_id": d.uploaded_by_id, "uploaded_by_name": d.uploaded_by_name, "created_at": d.created_at.isoformat() if d.created_at else None}


@router.get("/{vendor_id}/documents")
def list_documents(vendor_id: int, db: Session = Depends(get_db), _user: User = Depends(_view)):
    ensure_feature_action(_user, "p2p", "vendors", "documents", "view")
    _get(db, vendor_id)
    return [_doc_row(d) for d in db.query(VendorDocument).filter(VendorDocument.vendor_id == vendor_id).order_by(VendorDocument.created_at.desc()).all()]


@router.post("/{vendor_id}/documents")
async def upload_documents(
    vendor_id: int,
    doc_type: str = Form("other"),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_edit),
):
    ensure_feature_action(user, "p2p", "vendors", "documents", "create")
    v = _get(db, vendor_id)
    if doc_type not in VENDOR_DOC_TYPES:
        raise HTTPException(status_code=422, detail=f"Document type must be one of: {', '.join(VENDOR_DOC_TYPES.values())}.")
    files = [f for f in files if f and f.filename]
    if not files:
        raise HTTPException(status_code=422, detail="Choose at least one file to upload.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) isn't configured on the server — ask IT to set SHAREPOINT_SITE_ID.")
    folder = build_sharepoint_folder_path(user.name or user.email or "", v.name, f"vendors/{v.code}", root_folder="Procurement-media")
    saved = []
    for f in files:
        res = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, f)
        d = VendorDocument(vendor_id=v.id, doc_type=doc_type, file_name=res["name"], sharepoint_path=res["path"],
                           sharepoint_url=res.get("webUrl"), file_size=res.get("size"), mime_type=f.content_type,
                           uploaded_by_id=user.id, uploaded_by_name=user.name or user.email)
        db.add(d)
        saved.append(d)
    _audit(db, v.id, "document_added", user, f"{user.name or user.email} added {len(saved)} {VENDOR_DOC_TYPES[doc_type]} file(s) to {v.name}.")
    db.commit()
    return [_doc_row(d) for d in saved]


@router.get("/{vendor_id}/documents/{doc_id}/content")
async def document_content(vendor_id: int, doc_id: int, db: Session = Depends(get_db), _user: User = Depends(_view)):
    ensure_feature_action(_user, "p2p", "vendors", "documents", "view")
    d = db.query(VendorDocument).filter(VendorDocument.id == doc_id, VendorDocument.vendor_id == vendor_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Document not found on this vendor — refresh the page.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) isn't configured on the server.")
    content, ctype = await download_file_content(settings.SHAREPOINT_SITE_ID, d.sharepoint_path or "")
    return Response(content=content, media_type=d.mime_type or ctype, headers={"Content-Disposition": f'inline; filename="{d.file_name}"'})


@router.delete("/{vendor_id}/documents/{doc_id}")
def delete_document(vendor_id: int, doc_id: int, db: Session = Depends(get_db), user: User = Depends(_lookup)):
    ensure_feature_action(user, "p2p", "vendors", "documents", "delete")
    d = db.query(VendorDocument).filter(VendorDocument.id == doc_id, VendorDocument.vendor_id == vendor_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Document not found on this vendor — refresh the page.")
    # Company delete rule: 'Delete' on Procurement › Vendors AND only a
    # document you uploaded yourself (admins any).
    ensure_can_delete(user, d, "p2p", "vendors", what="vendor document")
    _audit(db, vendor_id, "document_removed", user, f"{user.name or user.email} removed document {d.file_name}.")
    db.delete(d)
    db.commit()
    return {"message": "Document removed"}


# ---------------------------------------------------------------- catalog

def _item_row(c: VendorCatalogItem) -> dict:
    return {"id": c.id, "item_name": c.item_name, "part_code": c.part_code, "make": c.make, "unit": c.unit,
            "unit_price": c.unit_price, "currency": c.currency, "dimensions": c.dimensions, "technical_spec": c.technical_spec,
            "lead_time_days": c.lead_time_days, "remarks": c.remarks, "is_active": c.is_active,
            "store_item_id": c.store_item_id, "min_order_qty": c.min_order_qty, "valid_from": c.valid_from, "valid_to": c.valid_to,
            "last_po_number": c.last_po_number, "last_po_date": c.last_po_date, "last_po_price": c.last_po_price}


def _check_store_item(db: Session, payload: "CatalogItemPayload") -> None:
    if payload.store_item_id:
        from app.modules.store.models.item import StoreItem
        if db.get(StoreItem, payload.store_item_id) is None:
            raise HTTPException(status_code=422, detail="That Item Master item doesn't exist — pick the item again.")


def _apply_item(c: VendorCatalogItem, data: dict) -> None:
    for k, val in data.items():
        if isinstance(val, str):
            val = val.strip() or None
        setattr(c, k, val)
    if not c.item_name:
        raise HTTPException(status_code=422, detail="Item name is required.")
    if c.unit_price is not None and c.unit_price < 0:
        raise HTTPException(status_code=422, detail="Price can't be negative.")
    if c.lead_time_days is not None and c.lead_time_days < 0:
        raise HTTPException(status_code=422, detail="Lead time can't be negative.")
    c.currency = (c.currency or "INR").upper()
    if c.valid_from and c.valid_to and c.valid_to < c.valid_from:
        raise HTTPException(status_code=422, detail="'Valid to' is before 'Valid from' — fix the validity dates.")


@router.get("/{vendor_id}/catalog")
def list_catalog(vendor_id: int, db: Session = Depends(get_db), _user: User = Depends(_lookup)):
    _ensure_vendor_feature(_user, "catalog", "view")
    _get(db, vendor_id)
    rows = [_item_row(c) for c in db.query(VendorCatalogItem).filter(VendorCatalogItem.vendor_id == vendor_id).order_by(VendorCatalogItem.item_name).all()]
    return mask_for(_user, "vendors", rows)


@router.post("/{vendor_id}/catalog", status_code=201)
def add_catalog_item(vendor_id: int, payload: CatalogItemPayload, db: Session = Depends(get_db), user: User = Depends(_edit)):
    ensure_feature_action(user, "p2p", "vendors", "catalog", "create")
    v = _get(db, vendor_id)
    c = VendorCatalogItem(vendor_id=v.id)
    _check_store_item(db, payload)
    _apply_item(c, payload.model_dump(exclude_unset=True))
    db.add(c)
    db.commit()
    return _item_row(c)


@router.patch("/{vendor_id}/catalog/{item_id}")
def update_catalog_item(vendor_id: int, item_id: int, payload: CatalogItemPayload, db: Session = Depends(get_db), user: User = Depends(_edit)):
    ensure_feature_action(user, "p2p", "vendors", "catalog", "edit")
    c = db.query(VendorCatalogItem).filter(VendorCatalogItem.id == item_id, VendorCatalogItem.vendor_id == vendor_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Catalog item not found — refresh the page.")
    _check_store_item(db, payload)
    _apply_item(c, payload.model_dump(exclude_unset=True))
    db.commit()
    return _item_row(c)


# A catalog line is part of the vendor record — removing one is an 'Edit' of
# the vendor, not a delete of a standalone record.
@router.delete("/{vendor_id}/catalog/{item_id}")
def delete_catalog_item(vendor_id: int, item_id: int, db: Session = Depends(get_db), user: User = Depends(_edit)):
    ensure_feature_action(user, "p2p", "vendors", "catalog", "delete")
    c = db.query(VendorCatalogItem).filter(VendorCatalogItem.id == item_id, VendorCatalogItem.vendor_id == vendor_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Catalog item not found — refresh the page.")
    db.delete(c)
    db.commit()
    return {"message": "Catalog item removed"}


CATALOG_COLUMNS = [
    ("item_name", "Item Name *"), ("part_code", "Part Code"), ("make", "Make"), ("unit", "Unit"), ("unit_price", "Price"),
    ("currency", "Currency"), ("dimensions", "Dimensions"), ("technical_spec", "Technical Specification"),
    ("lead_time_days", "Lead Time (days)"), ("remarks", "Remarks"),
]


@router.get("/{vendor_id}/catalog/template")
def catalog_template(vendor_id: int, db: Session = Depends(get_db), _user: User = Depends(_import)):
    ensure_feature_action(_user, "p2p", "vendors", "catalog", "import")
    _get(db, vendor_id)
    return csv_template(CATALOG_COLUMNS, [["Hydraulic hose 1/2\"", "HH-12", "Parker", "Mtr", "450", "INR", "12.7 mm ID",
                                           "2-wire braid, 275 bar", "7", ""]], "vendor_catalog_template.csv")


@router.post("/{vendor_id}/catalog/import")
async def import_catalog(vendor_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(_import)):
    """Adds the vendor's items; an item with the same name + part code is updated in place (new price etc.)."""
    ensure_feature_action(user, "p2p", "vendors", "catalog", "import")
    v = _get(db, vendor_id)
    rows = _rekey(read_rows(file.filename, await file.read()), CATALOG_COLUMNS)
    check_rows(rows, ["item_name"])
    current = {(norm_key(c.item_name), norm_key(c.part_code)): c
               for c in db.query(VendorCatalogItem).filter(VendorCatalogItem.vendor_id == v.id).all()}
    added = updated = 0
    errors = []
    for n, r in enumerate(rows, start=2):
        name = text(r, "item_name")
        if not name:
            errors.append({"row": n, "reason": "Item Name is empty."})
            continue
        try:
            price = parse_number(r, "unit_price", "Price")
            lead = parse_number(r, "lead_time_days", "Lead Time (days)")
        except ValueError as e:
            errors.append({"row": n, "reason": f"{name}: {e}"})
            continue
        data = {"item_name": name, "part_code": text(r, "part_code"), "make": text(r, "make"), "unit": text(r, "unit"),
                "unit_price": price, "currency": text(r, "currency") or "INR", "dimensions": text(r, "dimensions"),
                "technical_spec": text(r, "technical_spec"), "lead_time_days": int(lead) if lead is not None else None,
                "remarks": text(r, "remarks"), "is_active": True}
        key = (norm_key(name), norm_key(data["part_code"]))
        c = current.get(key)
        if c is None:
            c = VendorCatalogItem(vendor_id=v.id)
            db.add(c)
            current[key] = c
            added += 1
        else:
            updated += 1
        _apply_item(c, data)
    _audit(db, v.id, "catalog_imported", user, f"{user.name or user.email} imported the catalog of {v.name} from {file.filename}: "
                                               f"{added} added, {updated} updated, {len(errors)} skipped.")
    db.commit()
    return {"added": added, "updated": updated, "errors": errors}


@router.get("/{vendor_id}/catalog/export")
def export_catalog(vendor_id: int, db: Session = Depends(get_db), _user: User = Depends(_export)):
    ensure_feature_action(_user, "p2p", "vendors", "catalog", "export")
    if not sees_prices(_user, "vendors"):
        raise HTTPException(status_code=403, detail=(
            "The catalog export carries the vendor's prices, and your role doesn't show prices on Vendors "
            f"(p2p:vendors.prices:view). {GRANT_HINT}"))
    v = _get(db, vendor_id)
    items = db.query(VendorCatalogItem).filter(VendorCatalogItem.vendor_id == v.id).order_by(VendorCatalogItem.item_name).all()
    headers = [h.rstrip(" *") for _, h in CATALOG_COLUMNS] + ["Active"]
    rows = [[c.item_name, c.part_code or "", c.make or "", c.unit or "", c.unit_price if c.unit_price is not None else "",
             c.currency, c.dimensions or "", c.technical_spec or "", c.lead_time_days if c.lead_time_days is not None else "",
             c.remarks or "", "Yes" if c.is_active else "No"] for c in items]
    return xlsx_response("Catalog", headers, rows, f"{v.code}_catalog.xlsx")


def _rekey(rows: list[dict], columns: list[tuple[str, str]]) -> list[dict]:
    """Template headers are labels ("Price", "Lead Time (days)"); map each
    normalised label (and the bare key) onto the column key the import reads."""
    alias = {}
    for key, label in columns:
        alias[norm_header(label)] = key
        alias[norm_header(key)] = key
    return [{alias.get(k, k): v for k, v in r.items()} for r in rows]
