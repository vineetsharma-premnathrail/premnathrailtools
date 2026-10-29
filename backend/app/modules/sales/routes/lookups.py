"""Pickers for the Sales forms: customers (CRM organisations, with GSTIN /
state), contacts, products, RRV builds available to link, inspection
agencies (Quality master list), plants and Sales users."""
from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.sales.models.order import (
    SALES_ORDER_TYPES, SALES_PRICE_BASES, SALES_LD_PERIODS, SALES_LD_BASES, SALES_WARRANTY_RULES, SALES_LINE_TYPES,
    SALES_ORDER_TYPE_LABELS, SALES_CURRENCIES, SALES_DEFAULT_CURRENCY, SALES_DEFAULT_ORDER_TYPE,
    SALES_MILESTONE_TYPES, SALES_ORDER_STATUSES, SALES_SCHEDULE_STATUSES,
)
from app.modules.sales.models.extension import SALES_EXTENSION_REASONS
from app.modules.sales.models.attachment import SALES_ATTACHMENT_DOC_TYPES

router = APIRouter(prefix="/sales/lookups", tags=["Sales"], dependencies=[Depends(require_app_access("sales"))])

_AGENCY_FALLBACK = [("rites", "RITES"), ("rdso", "RDSO"), ("customer", "Customer"), ("other", "Other")]


@router.get("/meta")
async def meta():
    return {
        "order_types": SALES_ORDER_TYPES, "order_type_labels": SALES_ORDER_TYPE_LABELS,
        "default_order_type": SALES_DEFAULT_ORDER_TYPE, "currencies": SALES_CURRENCIES,
        "default_currency": SALES_DEFAULT_CURRENCY, "price_bases": SALES_PRICE_BASES, "ld_periods": SALES_LD_PERIODS,
        "ld_bases": SALES_LD_BASES, "warranty_rules": SALES_WARRANTY_RULES, "line_types": SALES_LINE_TYPES,
        "milestone_types": SALES_MILESTONE_TYPES, "order_statuses": SALES_ORDER_STATUSES,
        "schedule_statuses": SALES_SCHEDULE_STATUSES, "extension_reasons": SALES_EXTENSION_REASONS,
        "attachment_doc_types": SALES_ATTACHMENT_DOC_TYPES,
    }


@router.get("/payment-terms")
async def payment_terms(db: Session = Depends(get_db)):
    """The saved Payment Terms (CRM › Settings list, the same the quotation form
    picks from) — read-only here so Sales users without CRM access can pick one."""
    from app.modules.crm.models.payment_term import PaymentTerm
    rows = db.query(PaymentTerm).filter(PaymentTerm.is_deleted == False).order_by(PaymentTerm.label.asc()).all()  # noqa: E712
    return [{"id": t.id, "label": t.label, "description": t.description} for t in rows]


@router.get("/customers")
async def customers(search: str | None = None, db: Session = Depends(get_db)):
    from app.modules.crm.models.organization import Organization
    q = db.query(Organization).filter(Organization.is_deleted == False)  # noqa: E712
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(Organization.name.ilike(like), Organization.gst_number.ilike(like), Organization.org_code.ilike(like)))
    return [{"id": o.id, "name": o.name, "gst_number": o.gst_number, "state": o.state, "city": o.city,
             "address": o.address, "railway_zone": o.railway_zone, "credit_limit": o.credit_limit, "credit_days": o.credit_days}
            for o in q.order_by(Organization.name).limit(500).all()]


@router.get("/customers/{customer_id}/contacts")
async def contacts(customer_id: int, db: Session = Depends(get_db)):
    from app.modules.crm.models.organization import OrgContact
    return [{"id": c.id, "name": c.name, "designation": c.designation, "mobile": c.mobile, "email": c.email}
            for c in db.query(OrgContact).filter(OrgContact.org_id == customer_id).order_by(OrgContact.name).all()]


@router.get("/products")
async def products(db: Session = Depends(get_db)):
    from app.modules.crm.models.product import Product
    return [{"id": p.id, "name": p.name, "model_number": p.model_number, "category": p.category, "unit": p.unit,
             "default_price": p.default_price}
            for p in db.query(Product).filter(Product.is_deleted == False).order_by(Product.name).all()]  # noqa: E712


@router.get("/builds")
async def builds(search: str | None = None, db: Session = Depends(get_db)):
    """RRV builds not yet tied to an order (and not cancelled)."""
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    q = db.query(ProductionRrvBuild).filter(
        ProductionRrvBuild.is_deleted == False, ProductionRrvBuild.status != "cancelled",  # noqa: E712
        ProductionRrvBuild.sales_schedule_id.is_(None),
    )
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(ProductionRrvBuild.build_number.ilike(like), ProductionRrvBuild.rrv_model.ilike(like)))
    return [{"id": b.id, "build_number": b.build_number, "rrv_model": b.rrv_model, "status": b.status,
             "customer_name": b.customer_name, "target_handover_date": b.target_handover_date}
            for b in q.order_by(ProductionRrvBuild.id.desc()).limit(200).all()]


@router.get("/inspection-agencies")
async def inspection_agencies(db: Session = Depends(get_db)):
    try:
        from app.modules.quality.models.masters import QualityMasterValue
        rows = db.query(QualityMasterValue).filter(QualityMasterValue.list_key == "inspection_agencies",
                                                   QualityMasterValue.is_active.is_(True)).order_by(QualityMasterValue.sort_order).all()
        if rows:
            return [{"value": r.value, "label": r.label} for r in rows]
    except Exception:  # Quality master list not available — use the seed values
        db.rollback()
    return [{"value": v, "label": lbl} for v, lbl in _AGENCY_FALLBACK]


@router.get("/branches")
async def branches(db: Session = Depends(get_db)):
    from app.modules.organization.models.branch import Branch
    return [{"id": b.id, "name": b.name} for b in db.query(Branch).order_by(Branch.name).all()]


@router.get("/users")
async def users(db: Session = Depends(get_db)):
    return [{"id": u.id, "name": u.name or u.email, "email": u.email}
            for u in db.query(User).filter(User.is_active == True).order_by(User.name).all() if "sales" in u.get_apps()]  # noqa: E712


@router.get("/finished-products")
async def finished_products(search: str | None = None, db: Session = Depends(get_db)):
    """Product Management master (COMMPR01) for SO lines — active products
    first; phased-out ones are still listed for spares / service orders."""
    from app.modules.products.models.product import FinishedProduct
    q = db.query(FinishedProduct).filter(FinishedProduct.status.in_(("active", "phased_out")))
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(FinishedProduct.code.ilike(like), FinishedProduct.name.ilike(like), FinishedProduct.model_number.ilike(like)))
    return [{"id": p.id, "code": p.code, "name": p.name, "model_number": p.model_number, "product_type": p.product_type,
             "status": p.status, "hsn_code": p.hsn_code, "uom": p.uom, "warranty_months": p.warranty_months}
            for p in q.order_by(FinishedProduct.status, FinishedProduct.name).limit(500).all()]


@router.get("/orders/{so_id}/freight")
async def freight_for_order(so_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("sales"))):
    """The freight condition (VK11) that applies to this order's customer on
    its PO date, as the amount of a freight line — null when none applies."""
    from fastapi import HTTPException
    from app.core.data_scope import ensure_in_scope
    from app.modules.sales.models.order import SalesOrder
    from app.modules.sales.pricing import freight_suggestion
    so = db.query(SalesOrder).filter(SalesOrder.id == so_id, SalesOrder.is_deleted == False).first()  # noqa: E712
    if so is None:
        raise HTTPException(status_code=404, detail=f"Sales order #{so_id} not found — it may have been deleted.")
    ensure_in_scope(db, user, so)
    return {"freight": freight_suggestion(db, so)}
