"""Procurement side of Before-PO receipts: see what Store holds without a PO and
make the requisition its PO is uploaded on.

POs are made in Tally, never in the portal (owner, 2026-10-30): "Create
requisition" raises a requisition for the receipt's vendor and items with a
closed single-quotation RFQ, and the buyer then uploads the Tally PO on that
requisition (rfq.upload_po), which links the receipt to the PO. The normal PO
approval engine (approvers + a Partner) and the GRN gating apply unchanged.
Requisition approval is skipped on purpose: the goods are already in, and the PO
approval is the money control. Gate: Procurement tab `purchase_orders`."""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

import app.modules.p2p.access  # noqa: F401 - registers the Procurement data scopes
from app.core import assignee_rules
from app.core.data_scope import ensure_in_scope
from app.core.permission_registry import can_perform, is_admin_user
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.p2p.item_link import item_snapshot
from app.modules.p2p.models.p2p_request import LINE_CATEGORY, P2PRequest, resolve_line_buyer_id
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.vendor_quotation import VendorQuotation
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.pre_po import attachment_content_response, receipt_to_response, save_attachment
from app.modules.p2p.pricing import mask_for
from app.modules.p2p.routes.p2p_requests import BUYER_RULE_KEY, _write_audit as _write_pr_audit
from app.modules.p2p.routes.rfq import _ensure_vendor_can_get_po, _purchase_tab, _to_response as _rfq_response
from app.modules.p2p.schemas.rfq import RFQResponse
from app.modules.p2p.service import generate_p2p_number, generate_rfq_number
from app.modules.store.models.item import StoreItem
from app.modules.store.models.pre_po_receipt import StorePrePoReceipt
from app.modules.store.schemas.pre_po_receipt import PrePoReceiptResponse

router = APIRouter(prefix="/p2p/pre-po-receipts", tags=["P2P"])

# A stock purchase: purpose "stock" (store refill), a material requisition. Like every requisition raised
# from the PR form it has no category of its own (LINE_CATEGORY): each line's item type picks its buyer.
_PURPOSE = "stock"
_CATEGORY = LINE_CATEGORY


class PrePoRequisitionResponse(BaseModel):
    rfq: RFQResponse


@router.get("/pending", response_model=list[PrePoReceiptResponse])
async def list_pending_pre_po_receipts(
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "view")),
):
    """Receipts Store is holding that still need a PO, oldest number first.
    Buyers see receipts of every plant (no plant filter) - the same rule as the
    GRN purchase-team access; the Purchase Orders tab permission is the gate."""
    receipts = (db.query(StorePrePoReceipt).options(selectinload(StorePrePoReceipt.items))
                .filter(StorePrePoReceipt.status == "pending_po")
                .order_by(StorePrePoReceipt.receipt_number.asc()).limit(limit).all())
    return [receipt_to_response(db, r) for r in receipts]


@router.post("/{receipt_id}/create-requisition", response_model=PrePoRequisitionResponse)
async def create_requisition_for_pre_po_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "create")),
):
    # Making the requisition makes the caller its buyer of its requisition, so the same assign-buyer rule applies
    # (Role & Permissions > Procurement > Purchase Requisitions > Assign buyer).
    assignee_rules.ensure_allowed(db, user, BUYER_RULE_KEY, user)
    receipt = (db.query(StorePrePoReceipt).options(selectinload(StorePrePoReceipt.items))
               .filter(StorePrePoReceipt.id == receipt_id).with_for_update().first())
    if receipt is None:
        raise HTTPException(status_code=404, detail="Before-PO receipt not found - it may have been removed. Reload the Before PO list.")
    if receipt.status == "pending_po" and receipt.p2p_request_id:
        pr_no = db.query(P2PRequest.p2p_number).filter(P2PRequest.id == receipt.p2p_request_id).scalar()
        raise HTTPException(status_code=409, detail=f"Receipt {receipt.receipt_number} already has requisition {pr_no} — open it and upload the Tally PO there.")
    if receipt.status != "pending_po":
        reason = {"po_created": "a PO has already been made for it", "closed": "its PO was received in full",
                  "cancelled": "Store cancelled it"}.get(receipt.status, f"its status is '{receipt.status}'")
        raise HTTPException(status_code=409, detail=f"Receipt {receipt.receipt_number} is not waiting for a PO: {reason}. Reload the Before PO list.")
    if not receipt.items:
        raise HTTPException(status_code=409, detail=f"Receipt {receipt.receipt_number} has no item lines, so there is nothing to order - ask Store to cancel it and record it again.")
    if receipt.vendor_id:
        _ensure_vendor_can_get_po(db, receipt.vendor_id)

    store_items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([l.store_item_id for l in receipt.items])).all()}
    today = date.today()
    requester = db.get(User, receipt.created_by_id) if receipt.created_by_id else None
    note = f"Created from Before-PO receipt {receipt.receipt_number} (goods already received on {receipt.received_date:%d-%b-%Y})"

    pr = P2PRequest(
        p2p_number=generate_p2p_number(db, _CATEGORY), category_code=_CATEGORY, purpose=_PURPOSE,
        project_label=f"Store stock - {receipt.receipt_number}", requirement_type="Material", request_date=today,
        department=getattr(requester, "department", None), requested_by_id=receipt.created_by_id or user.id,
        assigned_buyer_id=user.id, assignment_date=today, priority="medium", status="vendor_selected",
        vendor=receipt.vendor_name, selected_vendor=receipt.vendor_name, remarks=note + ".",
    )
    db.add(pr)
    db.flush()
    for line in receipt.items:
        master = store_items.get(line.store_item_id)
        row = P2PRequestItem(p2p_request_id=pr.id, quantity=line.quantity, fulfillment_status="sent_to_procurement")
        if master is not None:
            for field, value in item_snapshot(master).items():
                setattr(row, field, value)
            row.make = master.make
            row.buyer_id = resolve_line_buyer_id(db, master.item_type)
        else:
            row.store_item_id, row.item_name, row.unit = line.store_item_id, line.item_name, line.unit
        db.add(row)

    rfq = RFQ(
        rfq_number=generate_rfq_number(db), p2p_request_id=pr.id, status="locked", is_single_quotation=True,
        single_quotation_reason=f"Goods were received before the PO ({receipt.receipt_number}); the PO goes to the vendor who delivered them.",
        created_by_id=user.id, locked_by_id=user.id, locked_at=datetime.now(timezone.utc), source="before_po",
    )
    db.add(rfq)
    db.flush()
    db.add(VendorQuotation(
        rfq_id=rfq.id, p2p_request_id=pr.id, vendor_id=receipt.vendor_id, vendor_name=receipt.vendor_name,
        is_selected=True, technical_status="qualified", commercial_status="approved", submitted_at=receipt.received_date,
        created_by_id=user.id, remarks=f"Single source - {receipt.receipt_number}"))
    db.flush()
    db.refresh(pr)
    _write_pr_audit(db, pr.id, "created_from_pre_po_receipt", user, summary=f"{user.name or user.email}: {note}.",
                    new_status="vendor_selected")

    # Waits for its PO: the buyer uploads the Tally PO on this requisition, which links it (rfq.upload_po).
    receipt.p2p_request_id = pr.id
    db.commit()
    db.refresh(rfq)
    return {"rfq": mask_for(user, "rfq", _rfq_response(db, rfq))}


def _receipt_or_404(db: Session, receipt_id: int) -> StorePrePoReceipt:
    receipt = (db.query(StorePrePoReceipt).options(selectinload(StorePrePoReceipt.items), selectinload(StorePrePoReceipt.attachments))
               .filter(StorePrePoReceipt.id == receipt_id).first())
    if receipt is None:
        raise HTTPException(status_code=404, detail="Before-PO receipt not found - it may have been removed. Reload the Before PO list.")
    return receipt


@router.get("/by-po/{po_id}", response_model=PrePoReceiptResponse | None)
async def get_receipt_of_po(
    po_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "view")),
):
    """The Before-PO receipt a PO was made from, or null for an ordinary PO."""
    po = db.get(P2PPurchaseOrder, po_id)
    if po is None:
        raise HTTPException(status_code=404, detail="Purchase order not found - reload the list and open it again.")
    ensure_in_scope(db, user, po)
    receipt = (db.query(StorePrePoReceipt).options(selectinload(StorePrePoReceipt.items), selectinload(StorePrePoReceipt.attachments))
               .filter(StorePrePoReceipt.purchase_order_id == po_id).first())
    return receipt_to_response(db, receipt) if receipt else None


@router.post("/{receipt_id}/attachments", response_model=PrePoReceiptResponse)
async def attach_file_to_pre_po_receipt(
    receipt_id: int,
    file: UploadFile = File(...),
    doc_type: str = Form("other"),
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "view")),
):
    """Procurement attaches the vendor invoice / challan from the PO page."""
    if not (is_admin_user(user) or can_perform(user, "p2p", "purchase_orders", "create") or can_perform(user, "p2p", "purchase_orders", "edit")):
        raise HTTPException(status_code=403, detail="You need 'Create' or 'Edit' on Procurement > Purchase Orders to attach files here. Ask an admin to grant it.")
    receipt = _receipt_or_404(db, receipt_id)
    await save_attachment(db, receipt, user, file, doc_type)
    db.commit()
    db.refresh(receipt)
    return receipt_to_response(db, receipt)


@router.get("/{receipt_id}/attachments/{attachment_id}/content")
async def get_pre_po_receipt_attachment(
    receipt_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "view")),
):
    return await attachment_content_response(_receipt_or_404(db, receipt_id), attachment_id)
