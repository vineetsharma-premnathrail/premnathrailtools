"""Product master merge — the Product Mapping screen (rows not yet linked to
the product master) and the product-wise order book / quotation history.

Mapping is exact-or-manual (products/linking.py): the screen lists every
distinct text / legacy catalogue row nothing matched, and a person picks the
product; the pick is applied to every row with that same text."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permission_registry import can_access_module, can_feature
from app.core.permissions import require_app_access, require_feature_action, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.products import linking
from app.modules.products.models.product import FinishedProduct

router = APIRouter(prefix="/products", tags=["Products - Mapping"], dependencies=[Depends(require_app_access("products"))])

_VIEW = require_tab_access("sales", "product_mapping")
_EDIT = require_tab_action("sales", "product_mapping", "edit")

SOURCES = {
    "crm_products": "CRM product catalogue (legacy)",
    "inquiries": "Inquiries — product",
    "inquiry_lines": "Inquiries — extra product lines",
    "quotation_lines": "Quotation lines",
    "so_lines": "Sales order lines",
}


class ProductMappingAssignPayload(BaseModel):
    source: str
    product_id: int
    crm_product_id: int | None = None
    text: str | None = None
    model: str | None = None


def _models():
    from app.modules.crm.models.inquiry import Inquiry, InquiryLineItem, QuotationLineItem
    from app.modules.crm.models.product import Product as CrmProduct
    from app.modules.sales.models.order import SalesOrderLine
    return Inquiry, InquiryLineItem, QuotationLineItem, CrmProduct, SalesOrderLine


def _norm(col):
    return func.lower(func.trim(func.coalesce(col, "")))


def _groups(rows) -> list[dict]:
    out: dict[tuple, dict] = {}
    for text, model, rid in rows:
        key = ((text or "").strip().lower(), (model or "").strip().lower())
        if not key[0] and not key[1]:
            continue
        g = out.setdefault(key, {"text": (text or "").strip() or None, "model": (model or "").strip() or None, "count": 0, "ids": []})
        g["count"] += 1
        if len(g["ids"]) < 20:
            g["ids"].append(rid)
    return sorted(out.values(), key=lambda g: (-g["count"], (g["text"] or g["model"] or "").lower()))


@router.get("/mapping/unmapped")
async def unmapped(db: Session = Depends(get_db), _user: User = Depends(_VIEW)):
    Inquiry, InquiryLineItem, QuotationLineItem, CrmProduct, SalesOrderLine = _models()
    crm = db.query(CrmProduct).filter(CrmProduct.product_id.is_(None), CrmProduct.is_deleted == False).order_by(CrmProduct.name).all()  # noqa: E712
    inq = db.query(Inquiry.product, Inquiry.product_category, Inquiry.id).filter(
        Inquiry.product_id.is_(None), Inquiry.is_deleted == False, func.coalesce(Inquiry.product, "") != "").all()  # noqa: E712
    inql = db.query(InquiryLineItem.product, InquiryLineItem.product_category, InquiryLineItem.id).filter(
        InquiryLineItem.product_id.is_(None), func.coalesce(InquiryLineItem.product, "") != "").all()
    ql = db.query(QuotationLineItem.description, QuotationLineItem.model_number, QuotationLineItem.id).filter(
        QuotationLineItem.product_id.is_(None)).all()
    sol = db.query(SalesOrderLine.description, SalesOrderLine.rrv_model, SalesOrderLine.id).filter(
        SalesOrderLine.product_id.is_(None), SalesOrderLine.line_type.in_(("rrv", "other"))).all()
    return {
        "sources": SOURCES,
        "crm_products": [{"crm_product_id": p.id, "text": p.name, "model": p.model_number, "category": p.category, "count": 1} for p in crm],
        # Inquiry rows group by product text only (category is shown, not matched).
        "inquiries": _groups([(t, None, i) for t, _c, i in inq]),
        "inquiry_lines": _groups([(t, None, i) for t, _c, i in inql]),
        "quotation_lines": _groups(ql),
        "so_lines": _groups(sol),
    }


def _apply(db: Session, source: str, product_id: int, *, crm_product_id=None, text=None, model=None) -> int:
    Inquiry, InquiryLineItem, QuotationLineItem, CrmProduct, SalesOrderLine = _models()
    t, m = (text or "").strip().lower(), (model or "").strip().lower()
    if source == "crm_products":
        row = db.get(CrmProduct, crm_product_id) if crm_product_id else None
        if row is None:
            raise HTTPException(status_code=422, detail="Pick the CRM catalogue row to map (it may have been deleted — reload).")
        row.product_id = product_id
        n = 1 + db.query(SalesOrderLine).filter(SalesOrderLine.crm_product_id == row.id, SalesOrderLine.product_id.is_(None)).update(
            {SalesOrderLine.product_id: product_id}, synchronize_session=False)
        return n
    if not t and not m:
        raise HTTPException(status_code=422, detail="Nothing to map — the row has no product text.")
    if source == "inquiries":
        q = db.query(Inquiry).filter(Inquiry.product_id.is_(None), _norm(Inquiry.product) == t)
        return q.update({Inquiry.product_id: product_id}, synchronize_session=False)
    if source == "inquiry_lines":
        q = db.query(InquiryLineItem).filter(InquiryLineItem.product_id.is_(None), _norm(InquiryLineItem.product) == t)
        return q.update({InquiryLineItem.product_id: product_id}, synchronize_session=False)
    if source == "quotation_lines":
        q = db.query(QuotationLineItem).filter(QuotationLineItem.product_id.is_(None), _norm(QuotationLineItem.description) == t,
                                               _norm(QuotationLineItem.model_number) == m)
        return q.update({QuotationLineItem.product_id: product_id}, synchronize_session=False)
    if source == "so_lines":
        q = db.query(SalesOrderLine).filter(SalesOrderLine.product_id.is_(None), _norm(SalesOrderLine.description) == t,
                                            _norm(SalesOrderLine.rrv_model) == m)
        return q.update({SalesOrderLine.product_id: product_id}, synchronize_session=False)
    raise HTTPException(status_code=422, detail=f"Unknown source '{source}' — one of: {', '.join(SOURCES)}.")


@router.post("/mapping/assign")
async def assign(payload: ProductMappingAssignPayload, db: Session = Depends(get_db), user: User = Depends(_EDIT)):
    product = db.get(FinishedProduct, payload.product_id)
    if product is None:
        raise HTTPException(status_code=422, detail=f"Product #{payload.product_id} not found — pick the product again.")
    if product.status == "discontinued":
        raise HTTPException(status_code=409, detail=f"{product.code} is discontinued — map to the product that replaced it, "
                                                    "or set this product back to Phased out first if history really belongs to it.")
    n = _apply(db, payload.source, product.id, crm_product_id=payload.crm_product_id, text=payload.text, model=payload.model)
    from app.modules.main.models.audit_log import AuditLog
    db.add(AuditLog(entity_type="product", entity_id=product.id, action="mapping_assigned", performed_by_id=user.id,
                    summary=f"{n} {SOURCES.get(payload.source, payload.source).lower()} row(s) "
                            f"'{payload.text or payload.crm_product_id}' mapped to {product.code} by {user.name or user.email}."))
    db.commit()
    return {"updated": n, "product_id": product.id}


@router.post("/mapping/auto-link")
async def auto_link(db: Session = Depends(get_db), _user: User = Depends(_EDIT)):
    """Re-runs the exact match over every unlinked row — useful after new
    products were added to the master."""
    Inquiry, InquiryLineItem, QuotationLineItem, CrmProduct, SalesOrderLine = _models()
    m = linking.Matcher.load(db)
    n = 0
    for p in db.query(CrmProduct).filter(CrmProduct.product_id.is_(None)).all():
        if (pid := m.match(p.name, p.model_number)):
            p.product_id, n = pid, n + 1
    db.flush()
    crm_map = dict(db.query(CrmProduct.id, CrmProduct.product_id).filter(CrmProduct.product_id.isnot(None)).all())
    for r in db.query(Inquiry).filter(Inquiry.product_id.is_(None)).all():
        if (pid := m.match(r.product)):
            r.product_id, n = pid, n + 1
    for r in db.query(InquiryLineItem).filter(InquiryLineItem.product_id.is_(None)).all():
        if (pid := m.match(r.product)):
            r.product_id, n = pid, n + 1
    for r in db.query(QuotationLineItem).filter(QuotationLineItem.product_id.is_(None)).all():
        if (pid := m.match(r.description, r.model_number)):
            r.product_id, n = pid, n + 1
    for r in db.query(SalesOrderLine).filter(SalesOrderLine.product_id.is_(None)).all():
        pid = crm_map.get(r.crm_product_id) if r.crm_product_id else None
        pid = pid or m.match(r.description, r.rrv_model)
        if pid:
            r.product_id, n = pid, n + 1
    db.commit()
    return {"linked": n}


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
    if not can_access_module(user, "sales"):
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
