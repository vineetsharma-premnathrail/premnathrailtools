"""Product-wise order book / quotation history (product detail page).

The Product Mapping screen was removed on 2026-10-28: quotation lines now pick
the product (and its application) directly, and products/linking.py still
links typed text by exact match on save."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import can_access_module, can_feature, can_view_tab
from app.core.permissions import require_app_access, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.products.models.product import FinishedProduct

router = APIRouter(prefix="/products", tags=["Products - Mapping"], dependencies=[Depends(require_app_access("products"))])

# ── Product-wise order book / quotation history ─────────────────────────

def _product(db: Session, product_id: int) -> FinishedProduct:
    p = db.get(FinishedProduct, product_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Product #{product_id} not found — go back to the product list.")
    return p


def _sees_prices(user: User) -> bool:
    """Products › Products › Prices & sales values (sensitive switch)."""
    return can_feature(user, "sales", "products", "prices", "view")


@router.get("/{product_id}/order-book")
async def order_book(product_id: int, open_only: bool = False, db: Session = Depends(get_db),
                     user: User = Depends(require_feature_action("sales", "products", "order_book", "view"))):
    """Sales order lines of this product (VA05 by material). Values are
    Sales data, so the user also needs the Sales module."""
    # Sales › Products tabs are under Sales too, so "any Sales tab" isn't enough —
    # the order values need Sales Orders itself.
    if not can_view_tab(user, "sales", "orders"):
        raise HTTPException(status_code=403, detail="The order book shows Sales order values — you need access to the Sales "
                                                    "module (Sales › Sales Orders) to see it. Ask an admin to add it to your role.")
    from app.modules.sales.models.order import SALES_ORDER_OPEN_STATUSES, SalesOrder, SalesOrderLine
    _product(db, product_id)
    q = db.query(SalesOrderLine, SalesOrder).join(SalesOrder, SalesOrder.id == SalesOrderLine.so_id).filter(
        SalesOrderLine.product_id == product_id, SalesOrder.is_deleted == False)  # noqa: E712
    if open_only:
        q = q.filter(SalesOrder.status.in_(SALES_ORDER_OPEN_STATUSES))
    rows = []
    totals = {"ordered_qty": 0.0, "open_qty": 0.0, "order_value": 0.0, "open_value": 0.0}
    for ln, so in q.order_by(SalesOrder.id.desc()).limit(1000).all():
        qty = float(ln.quantity or 0)
        open_qty = max(0.0, qty - float(ln.qty_delivered or 0) - float(ln.qty_cancelled or 0)) if so.status in SALES_ORDER_OPEN_STATUSES else 0.0
        value = float(ln.taxable_amount or 0)
        unit = value / qty if qty else 0.0
        rows.append({"so_id": so.id, "so_number": so.so_number or f"Draft #{so.id}", "status": so.status, "customer_id": so.customer_id,
                     "customer_name": so.customer_name, "customer_po_number": so.customer_po_number, "po_date": so.customer_po_date,
                     "line_number": ln.line_number, "description": ln.description, "quantity": qty, "qty_delivered": float(ln.qty_delivered or 0),
                     "qty_invoiced": float(ln.qty_invoiced or 0), "open_qty": open_qty, "unit_price": float(ln.unit_price or 0),
                     "discount_percent": float(ln.discount_percent or 0), "taxable_amount": value})
        if so.status not in ("cancelled", "draft"):
            totals["ordered_qty"] += qty
            totals["order_value"] += value
        totals["open_qty"] += open_qty
        totals["open_value"] += round(open_qty * unit, 2)
    totals = {k: round(v, 2) for k, v in totals.items()}
    if not _sees_prices(user):
        for r in rows:
            r["unit_price"] = r["discount_percent"] = r["taxable_amount"] = None
        totals["order_value"] = totals["open_value"] = None
    return {"rows": rows, "totals": totals}


@router.get("/{product_id}/quotation-history")
async def quotation_history(product_id: int, db: Session = Depends(get_db),
                            user: User = Depends(require_feature_action("sales", "products", "quotation_history", "view"))):
    """Quoted prices of this product over time (and the inquiries that asked
    for it). Quotations are CRM data, so the user also needs CRM."""
    if not can_access_module(user, "crm"):
        raise HTTPException(status_code=403, detail="Quotation history shows CRM quotations — you need access to the CRM module "
                                                    "(CRM › Inquiries & Tenders) to see it. Ask an admin to add it to your role.")
    from app.modules.crm.models.inquiry import Inquiry, InquiryLineItem, Quotation, QuotationLineItem
    from app.modules.crm.models.organization import Organization
    _product(db, product_id)
    q = (db.query(QuotationLineItem, Quotation, Inquiry, Organization.name)
         .join(Quotation, Quotation.id == QuotationLineItem.quotation_id)
         .join(Inquiry, Inquiry.id == Quotation.inquiry_id)
         .outerjoin(Organization, Organization.id == Inquiry.org_id)
         .filter(QuotationLineItem.product_id == product_id, Inquiry.is_deleted == False))  # noqa: E712
    quotes = [{"quotation_id": qt.id, "quot_number": qt.quot_number, "quote_date": qt.quote_date, "valid_until": qt.valid_until,
               "customer_response": qt.customer_response, "inquiry_id": inq.id, "inquiry_ref": inq.universal_id,
               "customer_name": org, "quantity": ln.quantity, "unit_price": ln.unit_price, "list_price": ln.list_price,
               "price_override_reason": ln.price_override_reason, "total": ln.total}
              for ln, qt, inq, org in q.order_by(Quotation.quote_date.desc().nullslast(), Quotation.id.desc()).limit(500).all()]
    if not _sees_prices(user):
        for r in quotes:
            r["unit_price"] = r["list_price"] = r["total"] = None
    inq_ids = {i for (i,) in db.query(Inquiry.id).filter(Inquiry.product_id == product_id, Inquiry.is_deleted == False).all()}  # noqa: E712
    inq_ids |= {i for (i,) in db.query(InquiryLineItem.inquiry_id).filter(InquiryLineItem.product_id == product_id).all()}
    inquiries = [{"inquiry_id": i.id, "inquiry_ref": i.universal_id, "status": i.status, "customer_name": org,
                  "quantity": i.quantity, "created_at": i.created_at}
                 for i, org in db.query(Inquiry, Organization.name).outerjoin(Organization, Organization.id == Inquiry.org_id)
                 .filter(Inquiry.id.in_(inq_ids)).order_by(Inquiry.id.desc()).limit(500).all()] if inq_ids else []
    return {"quotations": quotes, "inquiries": inquiries}
