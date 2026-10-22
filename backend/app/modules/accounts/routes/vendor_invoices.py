from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_tab_access, require_tab_action, require_feature_action, ensure_feature_action, ensure_can_delete
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.schemas.vendor_invoice import (
    VendorInvoiceCreate, VendorInvoiceResponse, MatchPreviewResponse, MatchPreviewLinesPayload, ApproveVariancePayload, VendorInvoiceCancelPayload,
)
from app.modules.accounts.service import (
    check_three_way_match, create_vendor_invoice, cancel_vendor_invoice,
)
from app.modules.accounts.services.outstanding import allocation_history
from app.modules.accounts.services.proof import ensure_vendor_invoice_proof
from app.modules.accounts.routes._common import write_audit, who, service_errors, user_names, gl_labels, tax_lines_response
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.accounts import access

router = APIRouter(prefix="/accounts/vendor-invoices", tags=["Accounts"])


def _load(db: Session, invoice_id: int) -> VendorInvoice | None:
    return db.query(VendorInvoice).options(selectinload(VendorInvoice.lines)).filter(VendorInvoice.id == invoice_id).first()


def _load_in_scope(db: Session, user: User, invoice_id: int) -> VendorInvoice:
    invoice = _load(db, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail=f"Purchase invoice #{invoice_id} doesn't exist — it may have been removed. Refresh the Purchase Invoices list.")
    ensure_in_scope(db, user, invoice)
    return invoice


def _to_response(inv: VendorInvoice, db: Session, approval: dict | None = None) -> VendorInvoiceResponse:
    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == inv.purchase_order_id).first() if inv.purchase_order_id else None
    vendor = db.query(Vendor).filter(Vendor.id == inv.vendor_id).first()
    gl = gl_labels(db, {inv.expense_gl_account_id}).get(inv.expense_gl_account_id)
    entry = db.query(JournalEntry).filter(JournalEntry.id == inv.journal_entry_id).first() if inv.journal_entry_id else None
    posted_by_id = (entry.posted_by_id or entry.created_by_id) if entry else None
    names = user_names(db, {inv.variance_approved_by_id, inv.created_by_id, posted_by_id})
    resp = VendorInvoiceResponse.model_validate(inv)
    return resp.model_copy(update={
        "po_number": po.po_number if po else None,
        "vendor_name": vendor.name if vendor else None,
        "expense_gl_account_code": gl.code if gl else None,
        "journal_entry_number": entry.entry_number if entry else None,
        "variance_approved_by_name": names.get(inv.variance_approved_by_id),
        "created_by_name": names.get(inv.created_by_id),
        "posted_by_id": posted_by_id,
        "posted_by_name": names.get(posted_by_id),
        "lines": tax_lines_response(db, inv.lines),
        **(approval if approval is not None else access.approval_state(db, access.ET_VENDOR_INVOICE, inv.id)),
    })


@router.get("/match-preview", response_model=MatchPreviewResponse)
async def match_preview(
    purchase_order_id: int = Query(...),
    invoice_qty: float = Query(...),
    invoice_amount: float = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("accounts", "purchase_invoices")),
):
    try:
        result = check_three_way_match(db, purchase_order_id=purchase_order_id, invoice_qty=invoice_qty, invoice_amount=invoice_amount)
    except ValueError as e:
        # Not-found and business-rule stops (PO not approved, nothing received
        # yet, over the approved PO value) — the preview shows this reason.
        status_code = 404 if str(e) == "Purchase order not found." else 400
        raise HTTPException(status_code=status_code, detail=str(e))
    return MatchPreviewResponse(**result)


@router.post("/match-preview", response_model=MatchPreviewResponse)
async def match_preview_lines(
    payload: MatchPreviewLinesPayload,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("accounts", "purchase_invoices")),
):
    """Line-level 3-way match preview: each bill line (po_item_id, quantity,
    rate, discount_amount, uom) against its PO line and goods received."""
    from app.modules.accounts.services.po_match import assign_po_lines
    lines = [dict(l) for l in payload.lines if float(l.get("quantity") or 0) > 0]
    qty = sum(float(l.get("quantity") or 0) for l in lines)
    amount = round(sum(float(l.get("quantity") or 0) * float(l.get("rate") or 0) - float(l.get("discount_amount") or 0) for l in lines), 2)
    po = db.get(P2PPurchaseOrder, payload.purchase_order_id)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found.")
    try:
        assign_po_lines(po, lines)
        result = check_three_way_match(db, purchase_order_id=po.id, invoice_qty=qty, invoice_amount=amount, lines=lines)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return MatchPreviewResponse(**result)


@router.get("", response_model=list[VendorInvoiceResponse])
async def list_vendor_invoices(
    status: str | None = Query(None),
    matching_status: str | None = Query(None),
    payment_status: str | None = Query(None),
    invoice_type: str | None = Query(None),
    vendor_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "purchase_invoices")),
):
    query = apply_scope(db.query(VendorInvoice).options(selectinload(VendorInvoice.lines)), user, VendorInvoice)
    if status is not None:
        query = query.filter(VendorInvoice.status == status)
    if matching_status is not None:
        query = query.filter(VendorInvoice.matching_status == matching_status)
    if payment_status is not None:
        query = query.filter(VendorInvoice.payment_status == payment_status)
    if invoice_type is not None:
        query = query.filter(VendorInvoice.invoice_type == invoice_type)
    if vendor_id is not None:
        query = query.filter(VendorInvoice.vendor_id == vendor_id)
    invoices = query.order_by(VendorInvoice.invoice_date.desc(), VendorInvoice.id.desc()).limit(500).all()
    states = access.approval_states(db, access.ET_VENDOR_INVOICE, [i.id for i in invoices if i.status == "pending"])
    return [_to_response(i, db, states.get(i.id, {})) for i in invoices]


@router.get("/{vendor_invoice_id}", response_model=VendorInvoiceResponse)
async def get_vendor_invoice(
    vendor_invoice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "purchase_invoices")),
):
    return _to_response(_load_in_scope(db, user, vendor_invoice_id), db)


@router.get("/{vendor_invoice_id}/settlements")
async def vendor_invoice_settlements(vendor_invoice_id: int, db: Session = Depends(get_db),
                                     user: User = Depends(require_feature_action("accounts", "purchase_invoices", "settlements", "view"))):
    _load_in_scope(db, user, vendor_invoice_id)
    return allocation_history(db, target_type="vendor_invoice", target_id=vendor_invoice_id)


@router.post("", response_model=VendorInvoiceResponse, status_code=201)
async def create_vendor_invoice_route(
    payload: VendorInvoiceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "purchase_invoices", "create")),
):
    with service_errors(db):
        invoice = create_vendor_invoice(
            db, purchase_order_id=payload.purchase_order_id, vendor_id=payload.vendor_id, invoice_number=payload.invoice_number,
            invoice_date=payload.invoice_date, due_date=payload.due_date, lines=[l.model_dump() for l in payload.lines],
            is_reverse_charge=payload.is_reverse_charge, round_off=payload.round_off,
            place_of_supply_state_code=payload.place_of_supply_state_code, narration=payload.narration,
            invoice_amount=payload.invoice_amount, invoice_gst=payload.invoice_gst,
            expense_gl_account_id=payload.expense_gl_account_id, invoice_qty=payload.invoice_qty, created_by_id=user.id,
            currency=payload.currency, exchange_rate=payload.exchange_rate,
        )
    write_audit(db, "vendor_invoice", invoice.id, "created", user, f"{who(user)} recorded vendor invoice '{invoice.invoice_number}' (matching: {invoice.matching_status}).")
    db.commit()
    return _to_response(_load(db, invoice.id), db)


def _approval_args(inv: VendorInvoice) -> dict:
    return dict(entity_id=inv.id, title=f"Purchase invoice {inv.invoice_number}", reference=inv.invoice_number,
                amount=inv.invoice_total, context={"has_variance": inv.matching_status == "variance",
                                                   "invoice_type": inv.invoice_type})


def _ensure_pending(inv: VendorInvoice) -> None:
    if inv.status != "pending":
        raise HTTPException(status_code=400, detail=f"Only a pending (unposted) invoice goes through approval (current status: '{inv.status}').")


@router.post("/{vendor_invoice_id}/submit", response_model=VendorInvoiceResponse)
async def submit_vendor_invoice_route(
    vendor_invoice_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "purchase_invoices", "submit")),
):
    """Send a recorded bill to its approvers (Organization › Approval Workflows,
    'Purchase invoice'): a Finance Manager first when it is outside 3-way-match
    tolerance, then the posting approver. It posts on the last approval."""
    invoice = _load_in_scope(db, user, vendor_invoice_id)
    _ensure_pending(invoice)
    ensure_vendor_invoice_proof(db, invoice)
    access.submit_document(db, access.KEY_VENDOR_INVOICE, requester=user, background_tasks=background_tasks, **_approval_args(invoice))
    write_audit(db, "vendor_invoice", invoice.id, "submitted", user, f"{who(user)} submitted vendor invoice '{invoice.invoice_number}' for approval.")
    db.commit()
    return _to_response(_load(db, invoice.id), db)


def _approve(db: Session, user: User, vendor_invoice_id: int, note: str | None) -> VendorInvoice:
    invoice = _load_in_scope(db, user, vendor_invoice_id)
    _ensure_pending(invoice)
    with service_errors(db):
        req = access.approve_now(db, access.KEY_VENDOR_INVOICE, maker_id=invoice.created_by_id, actor=user, comment=note,
                                 **_approval_args(invoice))
        access.sync_variance_approval(db, invoice, req)
    return invoice


@router.post("/{vendor_invoice_id}/approve-variance", response_model=VendorInvoiceResponse)
async def approve_variance_route(
    vendor_invoice_id: int,
    payload: ApproveVariancePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("accounts", "purchase_invoices", "variance_approval", "approve")),
):
    """Kept for the old button: approves the invoice's current approval stage
    (the Finance Manager's variance stage) through the approval engine."""
    invoice = _load_in_scope(db, user, vendor_invoice_id)
    if invoice.matching_status != "variance":
        raise HTTPException(status_code=400, detail=f"This invoice isn't awaiting variance approval (current matching status: '{invoice.matching_status}').")
    invoice = _approve(db, user, vendor_invoice_id, payload.note)
    if invoice.matching_status == "approved_variance":
        write_audit(db, "vendor_invoice", invoice.id, "variance_approved", user, f"{who(user)} approved the 3-way-match variance on invoice '{invoice.invoice_number}'.")
    db.commit()
    return _to_response(_load(db, invoice.id), db)


@router.post("/{vendor_invoice_id}/post", response_model=VendorInvoiceResponse)
async def post_vendor_invoice_route(
    vendor_invoice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "purchase_invoices", "approve")),
):
    """The approver's one click: approves the invoice's current approval stage
    (submitting it on the maker's behalf if nobody did yet). It posts to the GL
    once the workflow's last stage is approved."""
    pending = _load_in_scope(db, user, vendor_invoice_id)
    if pending.matching_status == "variance":
        # Approving now accepts the 3-way-match variance, which needs the feature.
        ensure_feature_action(user, "accounts", "purchase_invoices", "variance_approval", "approve")
    _approve(db, user, vendor_invoice_id, None)
    db.commit()
    return _to_response(_load(db, vendor_invoice_id), db)


@router.post("/{vendor_invoice_id}/cancel", response_model=VendorInvoiceResponse)
async def cancel_vendor_invoice_route(
    vendor_invoice_id: int,
    payload: VendorInvoiceCancelPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "purchase_invoices")),
):
    # Cancelling an unposted (pending) invoice is its delete: 'Delete' on the tab + own record.
    draft = _load_in_scope(db, user, vendor_invoice_id)
    ensure_can_delete(user, draft, "accounts", "purchase_invoices", what="unposted purchase invoice")
    if draft.status == "pending":
        access.cancel_live(db, access.ET_VENDOR_INVOICE, draft.id, user, payload.reason)
    with service_errors(db):
        invoice = cancel_vendor_invoice(db, vendor_invoice_id=vendor_invoice_id, reason=payload.reason, user_id=user.id)
    write_audit(db, "vendor_invoice", invoice.id, "cancelled", user, f"{who(user)} cancelled vendor invoice '{invoice.invoice_number}': {payload.reason}")
    db.commit()
    return _to_response(_load(db, invoice.id), db)
