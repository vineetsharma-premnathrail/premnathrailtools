"""Finance › Sales Invoices › "Create from Sales Order" (SAP VF01): pick a
confirmed order and one of its due billing milestones, get a draft sales
invoice copied from the order (accounts/services/billing.py). The draft then
goes through the normal submit / approve / post of ar_transactions.py."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_feature_action
from app.db.session import get_db
from app.modules.accounts.routes._common import write_audit, who
from app.modules.accounts.routes.ar_transactions import _load, _to_response
from app.modules.accounts.schemas.ar_transaction import ARTransactionResponse
from app.modules.accounts.services import billing
from app.modules.main.models.user import User

router = APIRouter(prefix="/accounts/sales-billing", tags=["Accounts"])


class SalesBillingInvoiceCreate(BaseModel):
    so_id: int
    billing_plan_line_id: int
    # Delivery-linked milestones: the vehicles / lots to bill (empty = every billable one).
    schedule_ids: list[int] = Field(default_factory=list)
    invoice_date: date
    narration: str | None = None
    round_off: float = 0
    eway_bill_no: str | None = None
    eway_bill_date: date | None = None
    vehicle_no: str | None = None


@router.get("/orders")
async def billable_orders(db: Session = Depends(get_db),
                          _user: User = Depends(require_feature_action("accounts", "sales_invoices", "bill_from_so", "create"))):
    """Confirmed orders with something billable now — the SO picker."""
    from app.modules.sales.models.order import SalesOrder
    q = db.query(SalesOrder).options(selectinload(SalesOrder.lines), selectinload(SalesOrder.schedules),
                                     selectinload(SalesOrder.billing_lines)).filter(
        SalesOrder.is_deleted == False, SalesOrder.status.in_(billing.BILLABLE_ORDER_STATUSES))  # noqa: E712
    out = []
    for so in q.order_by(SalesOrder.id.desc()).limit(500).all():
        views = billing.milestone_views(db, so)
        due = round(sum(v["due_amount"] for v in views), 2)
        out.append({"so_id": so.id, "so_number": so.so_number, "customer_id": so.customer_id, "customer_name": so.customer_name,
                    "customer_po_number": so.customer_po_number, "status": so.status, "grand_total": float(so.grand_total or 0),
                    "invoiced": round(sum(v["invoiced_amount"] for v in views), 2), "due_amount": due})
    out.sort(key=lambda o: (-o["due_amount"], o["so_number"] or ""))
    return out


@router.get("/orders/{so_id}")
async def billable_milestones(so_id: int, db: Session = Depends(get_db),
                              _user: User = Depends(require_feature_action("accounts", "sales_invoices", "bill_from_so", "create"))):
    from app.modules.sales.views import get_order
    so = get_order(db, so_id)
    billing.sync_order(db, so)
    db.commit()
    so = get_order(db, so_id)
    return {"so_id": so.id, "so_number": so.so_number, "customer_name": so.customer_name, "customer_gstin": so.customer_gstin,
            "place_of_supply_state_code": so.place_of_supply_state_code, "customer_po_number": so.customer_po_number,
            "customer_po_date": so.customer_po_date, "status": so.status, "milestones": billing.milestone_views(db, so)}


@router.post("/invoices", response_model=ARTransactionResponse, status_code=201)
async def create_invoice_from_sales_order(payload: SalesBillingInvoiceCreate, db: Session = Depends(get_db),
                                          user: User = Depends(require_feature_action("accounts", "sales_invoices", "bill_from_so", "create"))):
    try:
        txn = billing.create_invoice_from_so(
            db, so_id=payload.so_id, billing_plan_line_id=payload.billing_plan_line_id, schedule_ids=payload.schedule_ids or None,
            invoice_date=payload.invoice_date, created_by_id=user.id, narration=payload.narration, round_off=payload.round_off,
            eway_bill_no=payload.eway_bill_no, eway_bill_date=payload.eway_bill_date, vehicle_no=payload.vehicle_no,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
    write_audit(db, "ar_transaction", txn.id, "created", user,
                f"{who(user)} drafted a sales invoice for {txn.total_amount:,.2f} from sales order #{payload.so_id}.")
    db.commit()
    return _to_response(_load(db, txn.id), db)
