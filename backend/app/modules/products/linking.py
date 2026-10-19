"""Product master merge (SAP COMMPR01): every product reference points at the
Product Management master (`products`).

Sources that used to carry their own product:
  crm_products                 legacy CRM catalogue (product_id = the mapping)
  crm_inquiries.product        free text
  crm_inquiry_line_items       free text
  crm_quotation_line_items     free text description / model number
  sales_order_lines            crm_product_id (legacy) / rrv_model / description

Matching is EXACT only (case and outer spaces ignored, never fuzzy):
  1. the text equals a product code, or a product model number; else
  2. the text equals a product name — and, when a model is given too, the
     product's model number equals it.
A text that matches no product, or more than one, stays unlinked and is
listed on the Product Mapping screen, where a person picks the product.

`before_flush` links new / edited rows the same way, so documents created
after the merge link themselves without each module having to."""
from __future__ import annotations

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session


def _n(v) -> str:
    return (v or "").strip().lower()


class Matcher:
    """Exact lookup over the product master (loaded once)."""

    def __init__(self, rows):
        self.by_code: dict[str, set[int]] = {}
        self.by_model: dict[str, set[int]] = {}
        self.by_name: dict[str, list[tuple[int, str]]] = {}
        for pid, code, name, model in rows:
            if _n(code):
                self.by_code.setdefault(_n(code), set()).add(pid)
            if _n(model):
                self.by_model.setdefault(_n(model), set()).add(pid)
            if _n(name):
                self.by_name.setdefault(_n(name), []).append((pid, _n(model)))

    @classmethod
    def load(cls, db_or_conn) -> "Matcher":
        from sqlalchemy import text
        exec_ = db_or_conn.execute
        return cls(exec_(text("SELECT id, code, name, model_number FROM products")).fetchall())

    def match(self, text: str | None, model: str | None = None) -> int | None:
        t, m = _n(text), _n(model)
        for key in (m, t):
            if not key:
                continue
            hits = self.by_code.get(key, set()) | self.by_model.get(key, set())
            if len(hits) == 1:
                return next(iter(hits))
            if len(hits) > 1:
                return None
        if t and t in self.by_name:
            cands = self.by_name[t]
            if m:
                cands = [c for c in cands if c[1] == m]
            ids = {c[0] for c in cands}
            if len(ids) == 1:
                return next(iter(ids))
        return None


def match_crm_product(m: Matcher, name, model) -> int | None:
    return m.match(name, model)


# ── Auto-link on save ───────────────────────────────────────────────────

def _changed(obj, *attrs) -> bool:
    st = inspect(obj)
    if st.pending or st.transient:
        return True
    return any(st.attrs[a].history.has_changes() for a in attrs)


def _link(session: Session, matcher_box: list, obj) -> None:
    from app.modules.crm.models.inquiry import Inquiry, InquiryLineItem, QuotationLineItem
    from app.modules.crm.models.product import Product as CrmProduct
    from app.modules.sales.models.order import SalesOrderLine

    if getattr(obj, "product_id", None):
        return

    def matcher() -> Matcher:
        if not matcher_box:
            matcher_box.append(Matcher.load(session))
        return matcher_box[0]

    if isinstance(obj, (Inquiry, InquiryLineItem)):
        if obj.product and _changed(obj, "product"):
            obj.product_id = matcher().match(obj.product)
    elif isinstance(obj, QuotationLineItem):
        if (obj.description or obj.model_number) and _changed(obj, "description", "model_number"):
            obj.product_id = matcher().match(obj.description, obj.model_number)
    elif isinstance(obj, CrmProduct):
        if obj.name and _changed(obj, "name", "model_number"):
            obj.product_id = matcher().match(obj.name, obj.model_number)
    elif isinstance(obj, SalesOrderLine):
        if obj.crm_product_id and _changed(obj, "crm_product_id"):
            mapped = session.query(CrmProduct.product_id).filter(CrmProduct.id == obj.crm_product_id).scalar()
            if mapped:
                obj.product_id = mapped
                return
        if (obj.rrv_model or obj.description) and _changed(obj, "rrv_model", "description"):
            obj.product_id = matcher().match(obj.description, obj.rrv_model)


@event.listens_for(Session, "before_flush")
def _auto_link_products(session: Session, flush_context, instances) -> None:
    from app.modules.crm.models.inquiry import Inquiry, InquiryLineItem, QuotationLineItem
    from app.modules.crm.models.product import Product as CrmProduct
    from app.modules.sales.models.order import SalesOrderLine

    kinds = (Inquiry, InquiryLineItem, QuotationLineItem, CrmProduct, SalesOrderLine)
    todo = [o for o in list(session.new) + list(session.dirty) if isinstance(o, kinds)]
    if not todo:
        return
    box: list = []
    with session.no_autoflush:
        for obj in todo:
            try:
                _link(session, box, obj)
            except Exception:  # noqa: BLE001 — linking is a convenience; it never blocks a save
                pass
        for obj in todo:
            if isinstance(obj, QuotationLineItem) and obj in session.new:
                _price_quotation_line(session, obj)


def _price_quotation_line(session: Session, ln) -> None:
    """Quotation line pricing (VK11): record the condition price; a typed
    price / discount that differs needs a reason. Lump-sum lines (no unit
    price) are not priced per line."""
    from fastapi import HTTPException
    from app.modules.crm.models.inquiry import Inquiry, Quotation
    from app.modules.products import pricing

    if not ln.product_id:
        return
    q = ln.quotation if ln.quotation is not None else (session.get(Quotation, ln.quotation_id) if ln.quotation_id else None)
    org_id = session.query(Inquiry.org_id).filter(Inquiry.id == q.inquiry_id).scalar() if q is not None and q.inquiry_id else None
    r = pricing.resolve(session, product_id=ln.product_id, customer_id=org_id, on=(q.quote_date if q is not None else None))
    ln.list_price = r["price"]
    if r["price"] is None or ln.unit_price is None:
        return
    problem = pricing.override_problem(r, unit_price=ln.unit_price, discount_percent=0, label=f"Quotation line '{ln.description or ln.model_number or ''}'")
    if problem and not (ln.price_override_reason or "").strip():
        raise HTTPException(status_code=422, detail=problem + " — enter a reason for the manual price on the line, or use the price-list price.")
    if not problem:
        ln.price_override_reason = None
