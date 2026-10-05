from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.schemas.material_issue import StoreMaterialIssueCreate, StoreMaterialIssueResponse
from app.modules.store.service import generate_material_issue_number
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.modules.store.routes.doc_types import doc_type_labels, get_doc_type
from app.modules.store.routes.settings import challan_rules, return_date_issue_types, vendor_issue_types

router = APIRouter(prefix="/store/material-issues", tags=["Store"])


def _to_response(db: Session, issue: StoreMaterialIssue) -> StoreMaterialIssueResponse:
    location = db.query(StoreLocation).filter(StoreLocation.id == issue.location_id).first()
    department = db.query(Department).filter(Department.id == issue.department_id).first() if issue.department_id else None
    user_ids = {issue.requested_by_id, issue.issued_by_id} - {None}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([it.item_id for it in issue.items])).all()} if issue.items else {}

    resp = StoreMaterialIssueResponse.model_validate(issue)
    resp.location_name = location.name if location else None
    resp.issue_type_label = doc_type_labels(db, "issue").get(issue.issue_type) if issue.issue_type else None
    resp.department_name = department.name if department else None
    if issue.p2p_request_id:
        from app.modules.p2p.models.p2p_request import P2PRequest
        pr = db.query(P2PRequest).filter(P2PRequest.id == issue.p2p_request_id).first()
        if pr:
            resp.p2p_number = pr.p2p_number
            resp.department_name = resp.department_name or pr.department
    if issue.requested_by_id and issue.requested_by_id in users:
        resp.requested_by_name = users[issue.requested_by_id].name or users[issue.requested_by_id].email
    if issue.issued_by_id and issue.issued_by_id in users:
        resp.issued_by_name = users[issue.issued_by_id].name or users[issue.issued_by_id].email
    for line, item_resp in zip(issue.items, resp.items):
        item = items_by_id.get(line.item_id)
        item_resp.item_code = item.item_code if item else None
        item_resp.item_name = item.item_name if item else None
        item_resp.uom = item.uom if item else None
    return resp


@router.get("", response_model=list[StoreMaterialIssueResponse])
async def list_material_issues(
    location_id: int | None = Query(None),
    department_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreMaterialIssue).options(selectinload(StoreMaterialIssue.items))
    if location_id is not None:
        query = query.filter(StoreMaterialIssue.location_id == location_id)
    if department_id is not None:
        query = query.filter(StoreMaterialIssue.department_id == department_id)
    issues = query.order_by(StoreMaterialIssue.created_at.desc()).all()
    return [_to_response(db, i) for i in issues]


@router.get("/{issue_id}", response_model=StoreMaterialIssueResponse)
async def get_material_issue(
    issue_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    issue = db.query(StoreMaterialIssue).options(selectinload(StoreMaterialIssue.items)).filter(StoreMaterialIssue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Material issue not found")
    return _to_response(db, issue)


@router.post("", response_model=StoreMaterialIssueResponse)
async def create_material_issue(
    payload: StoreMaterialIssueCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item is required")
    location = db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Store not found")
    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([p.item_id for p in payload.items])).all()}
    for p in payload.items:
        if p.item_id not in items_by_id:
            raise HTTPException(status_code=422, detail=f"Item {p.item_id} not found")
        if p.quantity <= 0:
            raise HTTPException(status_code=422, detail=f"Quantity for '{items_by_id[p.item_id].item_name}' must be greater than zero")
    # Optional at the API level (issues raised from a PR have no type);
    # the Store issue form always sends one.
    issue_type_row = get_doc_type(db, "issue", payload.issue_type, field="issue type") if payload.issue_type else None

    challan_number = (payload.challan_number or "").strip() or None
    if challan_number and len(challan_number) > 50:
        raise HTTPException(status_code=422, detail="Challan number is too long — keep it to 50 characters or fewer.")
    rules = challan_rules(db)
    needed_by = (
        f"issue type '{issue_type_row.label}'" if issue_type_row and issue_type_row.value in rules["issue_types"]
        else f"store '{location.name}'" if location.id in rules["location_ids"]
        else None
    )
    if needed_by and not challan_number:
        raise HTTPException(
            status_code=422,
            detail=f"Enter the Challan Number — it's mandatory for {needed_by} (Store → Settings → Issue Rules).",
        )

    vendor_name = (payload.vendor_name or "").strip() or None
    if vendor_name and len(vendor_name) > 255:
        raise HTTPException(status_code=422, detail="Vendor name is too long — keep it to 255 characters or fewer.")
    if not vendor_name and issue_type_row and issue_type_row.value in vendor_issue_types(db):
        raise HTTPException(
            status_code=422,
            detail=f"Enter the Vendor — issue type '{issue_type_row.label}' sends material to an outside vendor (Store → Settings → Issue Rules).",
        )

    issue_date = payload.issue_date or date.today()
    expected_return_date = payload.expected_return_date
    if not expected_return_date and issue_type_row and issue_type_row.value in return_date_issue_types(db):
        raise HTTPException(
            status_code=422,
            detail=f"Enter the Date — it's mandatory for issue type '{issue_type_row.label}' (Store → Settings → Issue Rules).",
        )
    if expected_return_date and expected_return_date < issue_date:
        raise HTTPException(
            status_code=422,
            detail=f"Date ({expected_return_date:%d-%m-%Y}) is before the issue date ({issue_date:%d-%m-%Y}) — pick a date on or after the issue date.",
        )

    issue = StoreMaterialIssue(
        issue_number=generate_material_issue_number(db),
        location_id=payload.location_id,
        requested_by_id=payload.requested_by_id,
        department_id=payload.department_id,
        project_or_work_order=payload.project_or_work_order,
        issue_type=payload.issue_type or None,
        challan_number=challan_number,
        vendor_name=vendor_name,
        expected_return_date=expected_return_date,
        issue_date=issue_date,
        issued_by_id=user.id,
        remarks=payload.remarks,
    )
    db.add(issue)
    db.flush()

    for p in payload.items:
        db.add(StoreMaterialIssueItem(
            issue_id=issue.id, item_id=p.item_id, quantity=p.quantity,
            batch_number=p.batch_number, remarks=p.remarks,
        ))
    try:
        # Item-id order, so two issues listing the same items differently
        # lock the balance rows in the same sequence and can't deadlock.
        for p in sorted(payload.items, key=lambda x: x.item_id):
            post_stock_transaction(
                db, item_id=p.item_id, location_id=payload.location_id, transaction_type="issue",
                quantity=p.quantity, batch_number=p.batch_number, reference_type="material_issue",
                reference_number=issue.issue_number, transaction_date=issue.issue_date,
                created_by_id=user.id, vendor_name=vendor_name,
            )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(e))

    db.commit()
    db.refresh(issue)
    issue = db.query(StoreMaterialIssue).options(selectinload(StoreMaterialIssue.items)).filter(StoreMaterialIssue.id == issue.id).first()
    return _to_response(db, issue)
