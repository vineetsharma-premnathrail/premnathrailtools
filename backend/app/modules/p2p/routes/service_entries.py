"""Service entry sheets (SAP ML81N) for service PO lines.

A service line (job work charges, AMC, calibration, consultancy — Item Master
type "service") is never received into store stock and never goes on a GRN.
Whoever got the service records what was done (quantity, period); accepting
the entry is the "receipt": it moves the PO / PR fulfilment status and is
what the vendor's invoice line is matched against (accounts 3-way match)."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import ensure_in_scope
from app.core.permissions import ensure_feature_action, ensure_tab_action, require_any_app_access
import app.modules.p2p.access  # noqa: F401 — registers the Procurement data scopes
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.models.service_entry import P2PServiceEntry
from app.modules.p2p.routes.goods_receipts import _RECEIVABLE_PO_STATUSES, _po_approval_block_reason, _sync_po_and_pr_status
from app.modules.p2p.schemas.service_entry import (
    P2PServiceEntriesOverview, P2PServiceEntryCancelPayload, P2PServiceEntryCreate, P2PServiceEntryResponse, P2PServiceLineSummary,
)
from app.modules.p2p.service import accepted_service_qty_by_po_item, generate_ses_number

router = APIRouter(tags=["P2P"])


def _po_tab(action: str):
    """Requesters (p2p) and the purchase team (purchase) both work service
    entries; the Permission Matrix action on Procurement › Purchase Orders decides."""
    module_dep = require_any_app_access("p2p", "purchase")

    def _dependency(user: User = Depends(module_dep)) -> User:
        ensure_tab_action(user, "p2p", "purchase_orders", action)
        return user

    return _dependency


def _get_po(db: Session, po_id: int, user: User, for_update: bool = False) -> P2PPurchaseOrder:
    q = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(P2PPurchaseOrder.id == po_id)
    po = (q.with_for_update() if for_update else q).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    ensure_in_scope(db, user, po)
    return po


def _get_entry(db: Session, entry_id: int, user: User) -> tuple[P2PServiceEntry, P2PPurchaseOrder]:
    entry = db.query(P2PServiceEntry).filter(P2PServiceEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Service entry #{entry_id} not found.")
    po = _get_po(db, entry.purchase_order_id, user, for_update=True)
    return entry, po


def _invoiced_qty(db: Session, po_item_id: int) -> float:
    from app.modules.accounts.models.vendor_invoice import VendorInvoice, VendorInvoiceLine

    return float(db.query(func.coalesce(func.sum(VendorInvoiceLine.quantity), 0))
                 .join(VendorInvoice, VendorInvoiceLine.vendor_invoice_id == VendorInvoice.id)
                 .filter(VendorInvoiceLine.po_item_id == po_item_id, VendorInvoice.status != "cancelled").scalar() or 0)


def _to_response(db: Session, e: P2PServiceEntry) -> P2PServiceEntryResponse:
    resp = P2PServiceEntryResponse.model_validate(e)
    if e.po_item is not None:
        resp.item_name, resp.unit = e.po_item.item_name, e.po_item.unit
    ids = {e.created_by_id, e.accepted_by_id} - {None}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    if e.created_by_id in users:
        resp.created_by_name = users[e.created_by_id].name or users[e.created_by_id].email
    if e.accepted_by_id in users:
        resp.accepted_by_name = users[e.accepted_by_id].name or users[e.accepted_by_id].email
    return resp


def _audit(db: Session, po: P2PPurchaseOrder, action: str, user: User, summary: str) -> None:
    if po.p2p_request_id:
        db.add(AuditLog(entity_type="p2p_request", entity_id=po.p2p_request_id, action=action, performed_by_id=user.id, summary=summary))


@router.get("/p2p/purchase-orders/{po_id}/service-entries", response_model=P2PServiceEntriesOverview)
async def list_service_entries(po_id: int, db: Session = Depends(get_db), user: User = Depends(_po_tab("view"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "service_entries", "view")
    po = _get_po(db, po_id, user)
    entries = db.query(P2PServiceEntry).filter(P2PServiceEntry.purchase_order_id == po.id).order_by(P2PServiceEntry.id.desc()).all()
    accepted = accepted_service_qty_by_po_item(db, po.id)
    lines = []
    for it in po.items:
        if it.category != "service":
            continue
        draft = sum(e.quantity for e in entries if e.po_item_id == it.id and e.status == "draft")
        acc = accepted.get(it.id, 0.0)
        lines.append(P2PServiceLineSummary(
            po_item_id=it.id, item_name=it.item_name, item_code=it.item_code, unit=it.unit, ordered_quantity=it.quantity,
            accepted_quantity=round(acc, 4), pending_entry_quantity=round(draft, 4),
            open_quantity=round(max(it.quantity - acc - draft, 0.0), 4),
        ))
    return P2PServiceEntriesOverview(purchase_order_id=po.id, po_number=po.po_number, service_lines=lines,
                                     entries=[_to_response(db, e) for e in entries])


@router.post("/p2p/purchase-orders/{po_id}/service-entries", response_model=P2PServiceEntryResponse, status_code=201)
async def create_service_entry(po_id: int, payload: P2PServiceEntryCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                               user: User = Depends(_po_tab("create"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "service_entries", "create")
    po = _get_po(db, po_id, user, for_update=True)
    if po.status not in _RECEIVABLE_PO_STATUSES:
        raise HTTPException(status_code=409, detail=f"PO {po.po_number} is '{po.status}' — a service can only be confirmed on an issued PO that is still open.")
    block = _po_approval_block_reason(db, po)
    if block:
        raise HTTPException(status_code=409, detail=block)
    line = next((i for i in po.items if i.id == payload.po_item_id), None)
    if line is None:
        raise HTTPException(status_code=422, detail=f"Line #{payload.po_item_id} is not on PO {po.po_number}.")
    if line.category != "service":
        raise HTTPException(status_code=422, detail=f"'{line.item_name}' is a {line.category} line, not a service — goods are received on a GRN in Store › GRN & Inspection.")
    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail=f"Enter how much of '{line.item_name}' was done — the quantity must be more than 0.")
    service_date = payload.service_date or date.today()
    if service_date > date.today():
        raise HTTPException(status_code=422, detail=f"Service date {service_date:%d-%m-%Y} is in the future — confirm a service once it has been done.")
    if po.po_date and service_date < po.po_date:
        raise HTTPException(status_code=422, detail=f"Service date {service_date:%d-%m-%Y} is before PO {po.po_number}'s date ({po.po_date:%d-%m-%Y}).")
    if payload.period_from and payload.period_to and payload.period_from > payload.period_to:
        raise HTTPException(status_code=422, detail="The service period's 'from' date is after its 'to' date — swap them.")
    open_entries = db.query(func.coalesce(func.sum(P2PServiceEntry.quantity), 0)).filter(
        P2PServiceEntry.po_item_id == line.id, P2PServiceEntry.status.in_(("draft", "accepted"))).scalar() or 0
    remaining = line.quantity - float(open_entries)
    if payload.quantity > remaining + 1e-9:
        raise HTTPException(status_code=409, detail=(
            f"'{line.item_name}': {payload.quantity:g} {line.unit or ''} is more than the {max(remaining, 0):g} still open on PO "
            f"{po.po_number} (ordered {line.quantity:g}, already entered {float(open_entries):g}). The PO must be amended to confirm more."))
    entry = P2PServiceEntry(
        ses_number=generate_ses_number(db), purchase_order_id=po.id, po_item_id=line.id, service_date=service_date,
        period_from=payload.period_from, period_to=payload.period_to, quantity=payload.quantity,
        description=(payload.description or "").strip() or None, status="draft", created_by_id=user.id,
    )
    db.add(entry)
    db.flush()
    _audit(db, po, "service_entry_recorded", user,
           f"{user.name or user.email} recorded service entry {entry.ses_number} for '{line.item_name}' ({payload.quantity:g} {line.unit or ''}) on PO '{po.po_number}'.")
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.service_entry_waiting(db, background_tasks, po, entry, user)
    db.commit()
    db.refresh(entry)
    return _to_response(db, entry)


@router.post("/p2p/service-entries/{entry_id}/accept", response_model=P2PServiceEntryResponse)
async def accept_service_entry(entry_id: int, db: Session = Depends(get_db), user: User = Depends(_po_tab("approve"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "service_entries", "approve")
    entry, po = _get_entry(db, entry_id, user)
    if entry.status != "draft":
        raise HTTPException(status_code=409, detail=f"Service entry {entry.ses_number} is already {entry.status}.")
    entry.status = "accepted"
    entry.accepted_by_id = user.id
    entry.accepted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.flush()
    _sync_po_and_pr_status(db, po, user.id)
    _audit(db, po, "service_entry_accepted", user,
           f"{user.name or user.email} accepted service entry {entry.ses_number} on PO '{po.po_number}' — it now counts as received.")
    db.commit()
    db.refresh(entry)
    return _to_response(db, entry)


@router.post("/p2p/service-entries/{entry_id}/cancel", response_model=P2PServiceEntryResponse)
async def cancel_service_entry(entry_id: int, payload: P2PServiceEntryCancelPayload, db: Session = Depends(get_db),
                               user: User = Depends(_po_tab("cancel"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "service_entries", "cancel")
    entry, po = _get_entry(db, entry_id, user)
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say why this service entry is being cancelled — it is kept on the PO history.")
    if entry.status == "cancelled":
        raise HTTPException(status_code=409, detail=f"Service entry {entry.ses_number} is already cancelled.")
    if entry.status == "accepted":
        accepted = accepted_service_qty_by_po_item(db, po.id).get(entry.po_item_id, 0.0)
        invoiced = _invoiced_qty(db, entry.po_item_id)
        if invoiced > accepted - entry.quantity + 1e-9:
            raise HTTPException(status_code=409, detail=(
                f"The vendor's invoice already covers this service ({invoiced:g} invoiced; only {accepted - entry.quantity:g} would stay accepted). "
                "Cancel or credit-note the invoice in Finance first, then cancel the service entry."))
    was_accepted = entry.status == "accepted"
    entry.status = "cancelled"
    entry.cancelled_by_id = user.id
    entry.cancelled_at = datetime.now(timezone.utc).replace(tzinfo=None)
    entry.cancel_reason = reason
    db.flush()
    if was_accepted:
        _sync_po_and_pr_status(db, po, user.id)
    _audit(db, po, "service_entry_cancelled", user,
           f"{user.name or user.email} cancelled service entry {entry.ses_number} on PO '{po.po_number}'. Reason: {reason}")
    db.commit()
    db.refresh(entry)
    return _to_response(db, entry)
