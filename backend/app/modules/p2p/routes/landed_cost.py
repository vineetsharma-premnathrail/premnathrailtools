"""PO delivery costs (planned conditions) and landed-cost vouchers.

  GET    /p2p/purchase-orders/{po_id}/charges                charges, landed rate per line, vouchers
  POST   /p2p/purchase-orders/{po_id}/charges                add a planned delivery cost (before any GRN)
  PATCH  /p2p/purchase-orders/{po_id}/charges/{charge_id}
  DELETE /p2p/purchase-orders/{po_id}/charges/{charge_id}
  POST   /p2p/purchase-orders/{po_id}/landed-cost-vouchers   load a cost billed after receipt

Rules in p2p/landed_cost.py (non-creditable cost only; GST is never loaded)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.core.audit import register_audited
from app.core.data_scope import ensure_in_scope
from app.core.permissions import ensure_feature_action, require_tab_access, require_tab_action
from app.db.session import get_db
import app.modules.p2p.access  # noqa: F401 — registers the Procurement data scopes
from app.modules.main.models.user import User
from app.modules.p2p import landed_cost as lc
from app.modules.p2p.models.landed_cost import P2PLandedCostVoucher, P2PPOCharge
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder

router = APIRouter(prefix="/p2p/purchase-orders", tags=["P2P Purchase Orders"])

register_audited(P2PPOCharge, entity_type="p2p_po_charge", module_key="p2p", label="PO delivery cost",
                 ref=lambda o: f"PO {o.purchase_order_id} {o.charge_type}")
register_audited(P2PLandedCostVoucher, entity_type="p2p_landed_cost_voucher", module_key="p2p", label="Landed-cost voucher",
                 ref=lambda o: o.voucher_number)


class P2PPOChargePayload(BaseModel):
    charge_type: str
    basis: str = "value"
    amount: float
    gst_rate: float | None = None
    description: str | None = None
    vendor_id: int | None = None


class P2PLandedCostVoucherPayload(P2PPOChargePayload):
    voucher_date: date | None = None
    bill_reference: str | None = None
    remarks: str | None = None


def _po(db: Session, po_id: int, user: User) -> P2PPurchaseOrder:
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(P2PPurchaseOrder.id == po_id).first()
    if po is None:
        raise HTTPException(status_code=404, detail="Purchase order not found — it may have been deleted. Refresh the list.")
    ensure_in_scope(db, user, po)
    return po


def _charge(db: Session, po: P2PPurchaseOrder, charge_id: int) -> P2PPOCharge:
    c = db.query(P2PPOCharge).filter(P2PPOCharge.id == charge_id, P2PPOCharge.purchase_order_id == po.id).first()
    if c is None:
        raise HTTPException(status_code=404, detail=f"That delivery cost is no longer on PO {po.po_number} — refresh the page.")
    return c


def _err(e: lc.LandedCostError):
    raise HTTPException(status_code=e.status, detail=str(e))


@router.get("/{po_id}/charges")
async def get_po_charges(po_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("p2p", "purchase_orders"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "delivery_costs", "view")
    return lc.charges_view(db, _po(db, po_id, user))


@router.post("/{po_id}/charges", status_code=201)
async def add_po_charge(po_id: int, payload: P2PPOChargePayload, db: Session = Depends(get_db),
                        user: User = Depends(require_tab_action("p2p", "purchase_orders", "edit"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "delivery_costs", "create")
    po = _po(db, po_id, user)
    try:
        lc.ensure_charges_editable(db, po)
        data = lc.clean_charge(payload.model_dump())
    except lc.LandedCostError as e:
        _err(e)
    db.add(P2PPOCharge(purchase_order_id=po.id, created_by_id=user.id, **data))
    db.commit()
    return lc.charges_view(db, po)


@router.patch("/{po_id}/charges/{charge_id}")
async def update_po_charge(po_id: int, charge_id: int, payload: P2PPOChargePayload, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("p2p", "purchase_orders", "edit"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "delivery_costs", "edit")
    po = _po(db, po_id, user)
    c = _charge(db, po, charge_id)
    try:
        lc.ensure_charges_editable(db, po)
        data = lc.clean_charge(payload.model_dump())
    except lc.LandedCostError as e:
        _err(e)
    for k, v in data.items():
        setattr(c, k, v)
    db.commit()
    return lc.charges_view(db, po)


@router.delete("/{po_id}/charges/{charge_id}")
async def delete_po_charge(po_id: int, charge_id: int, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("p2p", "purchase_orders", "edit"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "delivery_costs", "delete")
    po = _po(db, po_id, user)
    c = _charge(db, po, charge_id)
    try:
        lc.ensure_charges_editable(db, po)
    except lc.LandedCostError as e:
        _err(e)
    db.delete(c)
    db.commit()
    return lc.charges_view(db, po)


@router.post("/{po_id}/landed-cost-vouchers", status_code=201)
async def post_landed_cost_voucher(po_id: int, payload: P2PLandedCostVoucherPayload, db: Session = Depends(get_db),
                                   user: User = Depends(require_tab_action("p2p", "purchase_orders", "edit"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "delivery_costs", "create")
    po = _po(db, po_id, user)
    try:
        v = lc.post_voucher(db, po, payload.model_dump(), user.id)
    except lc.LandedCostError as e:
        db.rollback()
        _err(e)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"The landed cost couldn't be loaded into stock: {e}")
    db.commit()
    db.refresh(v)
    return lc.voucher_row(v)
