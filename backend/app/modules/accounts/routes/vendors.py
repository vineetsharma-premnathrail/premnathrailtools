from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature, can_view_tab
from app.core.permissions import require_any_app_access, require_tab_access, require_tab_action, ensure_feature_action, ensure_can_delete
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.vendor import Vendor, GST_REGISTRATION_TYPES
from app.modules.accounts.services.gst import validate_gstin
from app.modules.accounts.routes._common import write_audit
from app.modules.accounts.services.vendor_referral import REFERRAL_FIELDS, clean_referral, vendor_people
from app.modules.accounts.schemas.vendor import VendorCreate, VendorUpdate, VendorResponse

router = APIRouter(prefix="/accounts/vendors", tags=["Accounts"])


def _clean_tax_fields(data: dict) -> dict:
    """GSTIN is validated (format + check digit) so a typo is caught here, not
    when the vendor's input credit fails to show in GSTR-2B."""
    if "gstin" in data:
        try:
            data["gstin"] = validate_gstin(data["gstin"])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if data["gstin"] and not data.get("pan"):
            data["pan"] = data["gstin"][2:12]
    if "gst_registration_type" in data:
        reg = data["gst_registration_type"] or "regular"
        if reg not in GST_REGISTRATION_TYPES:
            raise HTTPException(status_code=400, detail=f"GST registration type must be one of: {', '.join(GST_REGISTRATION_TYPES)}.")
        if reg == "regular" and "gstin" in data and not data["gstin"]:
            raise HTTPException(status_code=400, detail="A regular GST-registered vendor needs its GSTIN. If the vendor isn't registered, set the registration type to 'unregistered'.")
        data["gst_registration_type"] = reg
    # MSME / Udyam fields (accounts/services/msme.py).
    from app.modules.accounts.services.msme import clean_msme_fields
    try:
        clean_msme_fields(data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return data


def check_msme(v: Vendor) -> None:
    from app.modules.accounts.services.msme import check_vendor
    try:
        check_vendor(v)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


# Vendors › Bank details (feature accounts:vendors.bank_details).
BANK_FIELDS = ("bank_name", "bank_account_no", "ifsc_code", "account_holder_name")


def _hide_bank_details(user: User | None) -> bool:
    """Blank the bank fields for a Finance user whose role is customised to
    leave out Vendors › Bank details. Users who reach this shared list only
    through Procurement / Purchase (no Finance › Vendors tab) keep today's
    response — the feature lives under the Finance tab."""
    return (user is not None and can_view_tab(user, "accounts", "vendors")
            and not can_feature(user, "accounts", "vendors", "bank_details", "view"))


def _ensure_bank_change_allowed(user: User, data: dict, vendor: Vendor | None) -> None:
    """Entering or changing a vendor's bank details needs the feature
    (create on a new vendor, edit on an existing one). Re-sending the
    unchanged values is not a change."""
    def norm(x):
        return (x or "").strip() or None
    changed = [f for f in BANK_FIELDS if f in data
               and norm(data[f]) != norm(getattr(vendor, f, None) if vendor else None)]
    if changed:
        ensure_feature_action(user, "accounts", "vendors", "bank_details", "edit" if vendor else "create")


def _to_response(v: Vendor, db: Session, user: User | None = None, people: dict | None = None) -> VendorResponse:
    gl = db.query(GLAccount).filter(GLAccount.id == v.gl_reconciliation_account_id).first() if v.gl_reconciliation_account_id else None
    update = {"gl_reconciliation_account_code": gl.code if gl else None}
    update.update(people if people is not None else vendor_people(db, [v])[v.id])
    if _hide_bank_details(user):
        update.update({f: None for f in BANK_FIELDS})
    return VendorResponse.model_validate(v).model_copy(update=update)


@router.get("", response_model=list[VendorResponse])
async def list_vendors(
    status: str | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    # Shared vendor master: Procurement's pickers read this list too, so any of
    # Finance / Procurement / Purchase access is enough to look vendors up.
    user: User = Depends(require_any_app_access("accounts", "p2p", "purchase")),
):
    query = db.query(Vendor)
    if status is not None:
        query = query.filter(Vendor.status == status)
    if search:
        like = f"%{search}%"
        query = query.filter((Vendor.code.ilike(like)) | (Vendor.name.ilike(like)))
    vendors = query.order_by(Vendor.name.asc()).all()
    people = vendor_people(db, vendors)
    return [_to_response(v, db, user, people[v.id]) for v in vendors]


@router.post("", response_model=VendorResponse, status_code=201)
async def create_vendor(
    payload: VendorCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "vendors", "create")),
):
    if db.query(Vendor).filter(Vendor.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Vendor code '{payload.code}' already exists")
    data = payload.model_dump()
    clean_referral(db, data)
    _ensure_bank_change_allowed(user, data, None)
    if not data.get("gst_registration_type"):
        data["gst_registration_type"] = "regular" if data.get("gstin") else "unregistered"
    vendor = Vendor(**_clean_tax_fields(data), created_by_id=user.id)
    check_msme(vendor)
    db.add(vendor)
    db.flush()
    write_audit(db, "vendor", vendor.id, "created", user, f"Vendor {vendor.name} ({vendor.code}) added by {user.name or user.email}.")
    db.commit()
    db.refresh(vendor)
    return _to_response(vendor, db, user)


@router.patch("/{vendor_id}", response_model=VendorResponse)
async def update_vendor(
    vendor_id: int,
    payload: VendorUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "vendors", "edit")),
):
    vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if payload.code and payload.code != vendor.code:
        if db.query(Vendor).filter(Vendor.code == payload.code, Vendor.id != vendor_id).first():
            raise HTTPException(status_code=409, detail=f"Vendor code '{payload.code}' already exists")
    changes = payload.model_dump(exclude_unset=True)
    _ensure_bank_change_allowed(user, changes, vendor)
    clean_referral(db, changes, vendor)
    changes = _clean_tax_fields(changes)
    changed = [f for f, value in changes.items() if getattr(vendor, f, None) != value]
    for field, value in changes.items():
        setattr(vendor, field, value)
    check_msme(vendor)
    if changed:
        # Field names only — bank account numbers never go into the log.
        shown = [("bank details" if f in BANK_FIELDS else "referred by" if f in REFERRAL_FIELDS else f) for f in changed]
        write_audit(db, "vendor", vendor.id, "updated", user,
                    f"{user.name or user.email} updated vendor {vendor.name}: {', '.join(dict.fromkeys(shown))}.")
    db.commit()
    db.refresh(vendor)
    return _to_response(vendor, db, user)


@router.delete("/{vendor_id}")
async def delete_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "vendors")),
):
    vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    ensure_can_delete(user, vendor, "accounts", "vendors", what="vendor")
    from app.modules.accounts.models.vendor_invoice import VendorInvoice
    from app.modules.accounts.models.journal_entry import JournalEntryLine
    if (db.query(VendorInvoice).filter(VendorInvoice.vendor_id == vendor_id).first()
            or db.query(JournalEntryLine).filter(JournalEntryLine.vendor_id == vendor_id).first()):
        raise HTTPException(status_code=409, detail=f"Vendor '{vendor.name}' has invoices or ledger entries, so it can't be deleted — set its status to inactive or blocked instead.")
    # The vendor master is shared with Purchase: a PO keeps vendor_id (no FK),
    # so deleting the vendor would orphan the PO and its later invoice.
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.vendor_id == vendor_id).first()
    if po:
        raise HTTPException(status_code=409, detail=f"Vendor '{vendor.name}' is on purchase order '{po.po_number}', so it can't be deleted — set its status to inactive or blocked instead.")
    db.delete(vendor)
    db.commit()
    return {"ok": True}
