from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.schemas.vendor_invoice import (
    VendorInvoiceCreate, VendorInvoiceResponse, MatchPreviewResponse, ApproveVariancePayload,
)
from app.modules.accounts.service import check_three_way_match, create_vendor_invoice, approve_variance, post_vendor_invoice
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder

router = APIRouter(prefix="/accounts/vendor-invoices", tags=["Accounts"])


def _write_audit(db: Session, entity_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="vendor_invoice", entity_id=entity_id, action=action, performed_by_id=user.id, summary=summary))


def _require_finance_manager(user: User) -> None:
    if not (user.is_finance_manager or user.role == "admin"):
        raise HTTPException(status_code=403, detail="Only a Finance Manager (or admin) can approve a 3-way-match variance.")


def _to_response(inv: VendorInvoice, db: Session) -> VendorInvoiceResponse:
    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == inv.purchase_order_id).first()
    vendor = db.query(Vendor).filter(Vendor.id == inv.vendor_id).first()
    gl_account = db.query(GLAccount).filter(GLAccount.id == inv.expense_gl_account_id).first()
    entry = db.query(JournalEntry).filter(JournalEntry.id == inv.journal_entry_id).first() if inv.journal_entry_id else None
    posted_by_id = entry.created_by_id if entry else None
    user_ids = {inv.variance_approved_by_id, inv.created_by_id, posted_by_id} - {None}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    def _name(user_id: int | None) -> str | None:
        u = users.get(user_id) if user_id else None
        return (u.name or u.email) if u else None

    return VendorInvoiceResponse.model_validate(inv).model_copy(update={
        "po_number": po.po_number if po else None,
        "vendor_name": vendor.name if vendor else None,
        "expense_gl_account_code": gl_account.code if gl_account else None,
        "variance_approved_by_name": _name(inv.variance_approved_by_id),
        "created_by_name": _name(inv.created_by_id),
        "posted_by_id": posted_by_id,
        "posted_by_name": _name(posted_by_id),
    })


@router.get("/match-preview", response_model=MatchPreviewResponse)
async def match_preview(
    purchase_order_id: int = Query(...),
    invoice_qty: float = Query(...),
    invoice_amount: float = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    try:
        result = check_three_way_match(db, purchase_order_id=purchase_order_id, invoice_qty=invoice_qty, invoice_amount=invoice_amount)
    except ValueError as e:
        # Not-found and business-rule stops (PO not approved, nothing received
        # yet, over the approved PO value) — the preview shows this reason.
        status_code = 404 if str(e) == "Purchase order not found." else 400
        raise HTTPException(status_code=status_code, detail=str(e))
    return MatchPreviewResponse(**result)


@router.get("", response_model=list[VendorInvoiceResponse])
async def list_vendor_invoices(
    status: str | None = Query(None),
    matching_status: str | None = Query(None),
    vendor_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    query = db.query(VendorInvoice)
    if status is not None:
        query = query.filter(VendorInvoice.status == status)
    if matching_status is not None:
        query = query.filter(VendorInvoice.matching_status == matching_status)
    if vendor_id is not None:
        query = query.filter(VendorInvoice.vendor_id == vendor_id)
    invoices = query.order_by(VendorInvoice.created_at.desc()).all()
    return [_to_response(i, db) for i in invoices]


@router.get("/{vendor_invoice_id}", response_model=VendorInvoiceResponse)
async def get_vendor_invoice(
    vendor_invoice_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == vendor_invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Vendor invoice not found")
    return _to_response(invoice, db)


@router.post("", response_model=VendorInvoiceResponse, status_code=201)
async def create_vendor_invoice_route(
    payload: VendorInvoiceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    try:
        invoice = create_vendor_invoice(
            db, purchase_order_id=payload.purchase_order_id, invoice_number=payload.invoice_number,
            invoice_date=payload.invoice_date, invoice_amount=payload.invoice_amount, invoice_gst=payload.invoice_gst,
            expense_gl_account_id=payload.expense_gl_account_id, invoice_qty=payload.invoice_qty, created_by_id=user.id,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, invoice.id, "created", user, summary=f"{user.name or user.email} recorded vendor invoice '{invoice.invoice_number}' (matching: {invoice.matching_status}).")
    db.commit()
    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == invoice.id).first()
    return _to_response(invoice, db)


@router.post("/{vendor_invoice_id}/approve-variance", response_model=VendorInvoiceResponse)
async def approve_variance_route(
    vendor_invoice_id: int,
    payload: ApproveVariancePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    _require_finance_manager(user)
    try:
        invoice = approve_variance(db, vendor_invoice_id=vendor_invoice_id, approved_by_id=user.id, note=payload.note)
    except PermissionError as e:
        db.rollback()
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, invoice.id, "variance_approved", user, summary=f"{user.name or user.email} approved the 3-way-match variance on invoice '{invoice.invoice_number}'.")
    db.commit()
    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == invoice.id).first()
    return _to_response(invoice, db)


@router.post("/{vendor_invoice_id}/post", response_model=VendorInvoiceResponse)
async def post_vendor_invoice_route(
    vendor_invoice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    try:
        post_vendor_invoice(db, vendor_invoice_id=vendor_invoice_id, created_by_id=user.id)
    except PermissionError as e:
        db.rollback()
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == vendor_invoice_id).first()
    _write_audit(db, invoice.id, "posted", user, summary=f"{user.name or user.email} posted vendor invoice '{invoice.invoice_number}' to the GL.")
    db.commit()
    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == invoice.id).first()
    return _to_response(invoice, db)
