"""Spare consumption on service requests (SAP goods issue 261 to a service
order + reversal 262 for unused parts).

Spares sent to a customer site for an SR leave Store on a Material Issue of
type "service" that names the SR (and so its machine and customer) and
travels on a delivery challan. Every movement goes through the Store
ledger (post_stock_transaction), so stock and stock value are right, and
the SR line keeps the quantities and the weighted issue cost:

  qty_issued / qty_returned   net consumed = issued − returned
  unit_cost                   weighted issue cost (valuation), for the
                              SR's actual material cost / warranty cost
  unit_price                  customer price on a chargeable job

Two ways in, one booking rule (book_issue_on_sr):
  • the SR Materials tab → Issue from Store (issue_spare here);
  • Store › Material Issue with type "service" (store/routes/material_issues
    calls book_store_issue after posting) — each issued item is booked on the
    SR line for the same Item Master item (never matched by name), or a new
    line is added for it.
Unused spares come back with return_spare (a return_in at the issuing
store, referenced to the SR)."""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import ensure_tab_action
from app.core.permission_registry import is_admin_user
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_request import ServiceRequest

_CLOSED = ("closed", "cancelled")


def _fmt(q: float) -> str:
    return f"{q:g}"


def ensure_store_issuer(user) -> None:
    """Goods leave Store only by a Store user (Store › Material Issues ›
    Create) — the service engineer asks, Store issues."""
    if is_admin_user(user):
        return
    try:
        ensure_tab_action(user, "store", "issues", "create")
    except HTTPException:
        raise HTTPException(
            status_code=403,
            detail="Issuing spares from Store needs Store › Material Issues › Create in the Permission Matrix. "
                   "Ask the Store team to issue it from this SR (or from Store › Material Issue, type Service), "
                   "or ask an admin to grant you that permission.",
        )


def ensure_sr_open(sr: ServiceRequest, action: str) -> None:
    status = (sr.status or "").lower()
    if status in _CLOSED:
        raise HTTPException(
            status_code=409,
            detail=f"{sr.request_number} is {status}, so spares can't be {action} against it — reopen it "
                   "(set the status back to In Progress, with a reason) first.",
        )


def item_unit_cost(item) -> float:
    return float(getattr(item, "moving_average_cost", None) or getattr(item, "standard_cost", None) or 0.0)


def book_issue_on_sr(mat: ServiceMaterial, *, quantity: float, location_id: int, unit_cost: float) -> None:
    """Adds an issued quantity to an SR material line with a weighted cost."""
    if mat.location_id and mat.location_id != location_id:
        raise HTTPException(
            status_code=409,
            detail=f"'{mat.material_name}' was already issued from another store on this SR — issue it from that same store, "
                   "or add a separate material line for the other store.",
        )
    prev = mat.net_issued
    mat.unit_cost = round(((prev * (mat.unit_cost or 0)) + quantity * unit_cost) / (prev + quantity), 4) if prev + quantity > 0 else unit_cost
    mat.qty_issued = (mat.qty_issued or 0) + quantity
    mat.location_id = location_id
    if mat.qty_issued > (mat.quantity or 0):
        mat.quantity = mat.qty_issued  # issued more than planned: the line follows what really went out
    mat.status = "issued"


def issue_spare(
    db: Session, sr: ServiceRequest, mat: ServiceMaterial, user, *, location_id: int, quantity: float,
    challan_number: str, vehicle_number: str | None = None, site_address: str | None = None,
    issue_date: date | None = None, remarks: str | None = None,
):
    """Creates a "service" Material Issue for one SR line and posts it."""
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
    from app.modules.store.service import generate_material_issue_number
    from app.modules.store.services.plant_access import ensure_location_allowed
    from app.modules.store.services.stock_ledger import post_stock_transaction

    ensure_store_issuer(user)
    ensure_sr_open(sr, "issued")
    if not mat.store_item_id:
        raise HTTPException(
            status_code=422,
            detail=f"'{mat.material_name}' is a free-text line with no Item Master item, so Store can't issue it. "
                   "Add the spare again by picking it from the Item Master.",
        )
    if quantity is None or quantity <= 0:
        raise HTTPException(status_code=422, detail="Issue quantity must be greater than 0.")
    challan_number = (challan_number or "").strip()
    if not challan_number:
        raise HTTPException(status_code=422, detail="Enter the delivery challan no. — spares going to a customer site always travel on a challan.")
    if len(challan_number) > 50:
        raise HTTPException(status_code=422, detail="Challan number is too long — keep it to 50 characters or fewer.")
    issue_date = issue_date or date.today()
    if issue_date > date.today():
        raise HTTPException(status_code=422, detail=f"Issue date {issue_date:%d-%m-%Y} is in the future — stock can only be issued for today or earlier.")
    location = db.get(StoreLocation, location_id)
    if not location or not location.is_active:
        raise HTTPException(status_code=404, detail="Store not found or inactive — pick the store to issue from again.")
    ensure_location_allowed(db, user, location.id)
    item = db.get(StoreItem, mat.store_item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Item Master item #{mat.store_item_id} of '{mat.material_name}' no longer exists.")
    if mat.location_id and mat.location_id != location.id:
        book_issue_on_sr(mat, quantity=quantity, location_id=location.id, unit_cost=0)  # raises the store-mismatch 409

    project = db.get(Project, sr.project_id)
    issue = StoreMaterialIssue(
        issue_number=generate_material_issue_number(db), location_id=location.id, issue_type="service",
        service_request_id=sr.id, erp_project_id=sr.project_id,
        customer_id=project.customer_id if project else None,
        project_or_work_order=sr.request_number,
        challan_number=challan_number, vehicle_number=(vehicle_number or "").strip() or None,
        site_address=(site_address or "").strip() or (", ".join(x for x in (project.site_name, project.site_location, project.site_state) if x) if project else None) or None,
        issue_date=issue_date, issued_by_id=user.id, requested_by_id=sr.assigned_service_person_id or sr.created_by_id,
        remarks=remarks or f"Spares for {sr.request_number}",
    )
    db.add(issue)
    db.flush()
    try:  # batch determination (FIFO / FEFO) for batch-managed items
        from app.modules.store.services.batches import allocate_issue
        splits = allocate_issue(db, item, location.id, quantity, None, {})
    except ImportError:
        splits = [(None, quantity)]
    value, moved = 0.0, 0.0
    try:
        for batch_no, qty in splits:
            db.add(StoreMaterialIssueItem(issue_id=issue.id, item_id=item.id, quantity=qty, batch_number=batch_no, remarks=mat.material_name))
            txn = post_stock_transaction(
                db, item_id=item.id, location_id=location.id, transaction_type="issue", quantity=qty, batch_number=batch_no,
                reference_type="material_issue", reference_number=issue.issue_number, transaction_date=issue_date,
                remarks=f"Service {sr.request_number}", created_by_id=user.id,
            )
            rate = float(txn.unit_cost) if getattr(txn, "unit_cost", None) is not None else item_unit_cost(item)
            value += rate * qty
            moved += qty
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"{e} Transfer stock in, or raise a purchase requisition from this SR.")
    cost = round(value / moved, 4) if moved > 0 else item_unit_cost(item)
    book_issue_on_sr(mat, quantity=quantity, location_id=location.id, unit_cost=cost)
    return issue


def return_spare(db: Session, sr: ServiceRequest, mat: ServiceMaterial, user, *, quantity: float, remarks: str | None = None):
    from app.modules.store.services.plant_access import ensure_location_allowed
    from app.modules.store.services.stock_ledger import post_stock_transaction

    ensure_store_issuer(user)
    ensure_sr_open(sr, "returned")
    outstanding = mat.net_issued
    if quantity is None or quantity <= 0:
        raise HTTPException(status_code=422, detail="Return quantity must be greater than 0.")
    if quantity - outstanding > 1e-9:
        raise HTTPException(
            status_code=422,
            detail=f"Only {_fmt(outstanding)} {mat.unit} of '{mat.material_name}' is still out on {sr.request_number}, "
                   f"so {_fmt(quantity)} can't come back.",
        )
    ensure_location_allowed(db, user, mat.location_id)
    try:
        post_stock_transaction(
            db, item_id=mat.store_item_id, location_id=mat.location_id, transaction_type="return_in", quantity=quantity,
            reference_type="service_request", reference_number=sr.request_number,
            remarks=remarks or f"Unused spare returned from {sr.request_number}", created_by_id=user.id,
            unit_cost=mat.unit_cost,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(e))
    mat.qty_returned = (mat.qty_returned or 0) + quantity
    if mat.net_issued <= 1e-9:
        mat.status = "returned"


def book_store_issue(db: Session, issue) -> None:
    """Hook for Store › Material Issue type "service": fills the SR's machine
    and customer on the issue and books each issued item on the SR's line
    for that Item Master item (or a new line). Raises 409/422 with the real
    reason, before anything is committed."""
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.stock_transaction import StoreStockTransaction

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == issue.service_request_id,
                                         ServiceRequest.is_deleted == False).first()  # noqa: E712
    if sr is None:
        raise HTTPException(status_code=422, detail="Service request not found — it may be in the Recycle Bin. Pick the SR again.")
    ensure_sr_open(sr, "issued")
    project = db.get(Project, sr.project_id)
    issue.erp_project_id = sr.project_id
    if project is not None and project.customer_id and not issue.customer_id:
        issue.customer_id = project.customer_id
    issue.project_or_work_order = issue.project_or_work_order or sr.request_number
    lines = db.query(ServiceMaterial).filter(ServiceMaterial.service_request_id == sr.id,
                                             ServiceMaterial.is_deleted == False).all()  # noqa: E712
    for it in issue.items:
        item = db.get(StoreItem, it.item_id)
        txn = db.query(StoreStockTransaction).filter(
            StoreStockTransaction.reference_number == issue.issue_number, StoreStockTransaction.item_id == it.item_id,
            StoreStockTransaction.transaction_type == "issue",
        ).order_by(StoreStockTransaction.id.desc()).first()
        cost = float(txn.unit_cost) if txn is not None and txn.unit_cost is not None else item_unit_cost(item)
        mat = next((m for m in lines if m.store_item_id == it.item_id and (not m.location_id or m.location_id == issue.location_id)), None)
        if mat is None:
            mat = ServiceMaterial(
                service_request_id=sr.id, material_name=item.item_name if item else f"Item {it.item_id}",
                part_number=item.item_code if item else None, quantity=it.quantity, unit=(item.uom if item and item.uom else "pcs"),
                store_item_id=it.item_id, status="issued", phase="actual",
                is_warranty_covered=not bool(sr.is_chargeable), reason=f"Issued on {issue.issue_number}",
            )
            db.add(mat)
            lines.append(mat)
            db.flush()
        book_issue_on_sr(mat, quantity=it.quantity, location_id=issue.location_id, unit_cost=cost)
    from app.modules.erp.routes.service_requests import _recompute_billing
    _recompute_billing(db, sr)
