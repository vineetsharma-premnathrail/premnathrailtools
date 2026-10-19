"""Picker options for the PP wave-2 fields (job-work vendors on external
operations, sales order lines on work orders, job-work challans, Design
documents on document BOM lines). Served under the Production permission
for the same reason as routes/lookups.py."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.production.schemas.insights import ProductionLookupOption

router = APIRouter(
    prefix="/production/lookups", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)


@router.get("/vendors", response_model=list[ProductionLookupOption])
async def lookup_vendors(search: str | None = None, limit: int = Query(200, ge=1, le=2000), db: Session = Depends(get_db)):
    from app.modules.accounts.models.vendor import Vendor
    q = db.query(Vendor).filter(Vendor.status == "active")
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(Vendor.name.ilike(like) | Vendor.code.ilike(like))
    return [ProductionLookupOption(id=v.id, label=f"{v.code} — {v.name}", code=v.code) for v in q.order_by(Vendor.name).limit(limit).all()]


@router.get("/sales-order-lines", response_model=list[ProductionLookupOption])
async def lookup_sales_order_lines(product_item_id: int | None = None, db: Session = Depends(get_db)):
    """Lines of open sales orders (confirmed / in execution / partly delivered).
    `code` carries the sales order id."""
    from app.modules.sales.models.order import SalesOrder, SalesOrderLine
    q = db.query(SalesOrderLine, SalesOrder).join(SalesOrder, SalesOrder.id == SalesOrderLine.so_id).filter(
        SalesOrder.is_deleted == False, SalesOrder.status.in_(("confirmed", "in_execution", "partially_delivered")),  # noqa: E712
    )
    if product_item_id:
        q = q.filter((SalesOrderLine.product_item_id == product_item_id) | (SalesOrderLine.product_item_id == None))  # noqa: E711
    out = []
    for line, so in q.order_by(SalesOrder.id.desc(), SalesOrderLine.line_number).limit(500).all():
        label = f"{so.display_number} · line {line.line_number} — {(line.description or '')[:60]}"
        if so.customer_name:
            label += f" ({so.customer_name})"
        out.append(ProductionLookupOption(id=line.id, label=label, code=str(so.id), extra=f"{line.quantity:g} {line.uom}"))
    return out


@router.get("/job-work-challans", response_model=list[ProductionLookupOption])
async def lookup_job_work_challans(vendor_id: int | None = None, db: Session = Depends(get_db)):
    from app.modules.store.models.material_issue import StoreMaterialIssue
    q = db.query(StoreMaterialIssue).filter(StoreMaterialIssue.issue_type == "job_work")
    if vendor_id:
        q = q.filter(StoreMaterialIssue.vendor_id == vendor_id)
    return [ProductionLookupOption(
        id=i.id, label=f"{i.issue_number}{' · ' + i.challan_number if i.challan_number else ''} — {i.vendor_name or 'vendor'}",
        code=i.issue_number, extra=str(i.vendor_id or ""),
    ) for i in q.order_by(StoreMaterialIssue.id.desc()).limit(300).all()]


@router.get("/design-documents", response_model=list[ProductionLookupOption])
async def lookup_design_documents(search: str | None = None, db: Session = Depends(get_db)):
    from app.modules.design.models.document import DesignDocument
    q = db.query(DesignDocument).filter(DesignDocument.is_deleted == False, DesignDocument.status != "obsolete")  # noqa: E712
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(DesignDocument.doc_number.ilike(like) | DesignDocument.title.ilike(like))
    return [ProductionLookupOption(id=d.id, label=f"{d.doc_number} — {d.title}", code=d.doc_number)
            for d in q.order_by(DesignDocument.doc_number).limit(500).all()]
