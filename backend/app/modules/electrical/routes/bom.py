"""A job's electrical BOM, plus the cross-job Purchase Requirements view of
every line that still has to be bought. Linking a line to a P2P purchase
requisition only stores the pointer — the PR itself is raised and processed
in Procurement as usual."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.electrical.models.bom import (
    ElectricalBomItem, ELECTRICAL_COMPONENT_CATEGORIES, ELECTRICAL_SELECTION_STATUSES, ELECTRICAL_PROCUREMENT_STATUSES,
)
from app.modules.electrical.models.job import ElectricalJob
from app.modules.electrical.models.panel import ElectricalPanel
from app.modules.electrical.schemas.bom import (
    ElectricalBomItemCreate, ElectricalBomItemUpdate, ElectricalBomItemLinkPrPayload, ElectricalBomItemResponse,
)
from app.modules.electrical.service import ELECTRICAL_APP, OPEN_JOB_STATUSES, get_job_or_404, require_working
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.store.models.item import StoreItem

router = APIRouter(
    prefix="/electrical", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)

_CAN_EDIT = require_tab_action(ELECTRICAL_APP, "jobs", "edit")
# Statuses that still need Procurement's attention on the Purchase Requirements page.
_OPEN_PROCUREMENT = ("required", "pr_raised", "ordered")


def _to_responses(db: Session, items: list[ElectricalBomItem], with_job: bool = False) -> list[ElectricalBomItemResponse]:
    store_ids = {i.store_item_id for i in items if i.store_item_id}
    panel_ids = {i.panel_id for i in items if i.panel_id}
    pr_ids = {i.p2p_request_id for i in items if i.p2p_request_id}
    store = {s.id: s.item_code for s in db.query(StoreItem).filter(StoreItem.id.in_(store_ids)).all()} if store_ids else {}
    panels = {p.id: p.panel_tag for p in db.query(ElectricalPanel).filter(ElectricalPanel.id.in_(panel_ids)).all()} if panel_ids else {}
    prs = {p.id: p for p in db.query(P2PRequest).filter(P2PRequest.id.in_(pr_ids)).all()} if pr_ids else {}
    jobs = {}
    if with_job:
        job_ids = {i.job_id for i in items}
        jobs = {j.id: j for j in db.query(ElectricalJob).filter(ElectricalJob.id.in_(job_ids)).all()} if job_ids else {}
    out = []
    for i in items:
        resp = ElectricalBomItemResponse.model_validate(i)
        resp.store_item_code = store.get(i.store_item_id)
        resp.panel_tag = panels.get(i.panel_id)
        pr = prs.get(i.p2p_request_id)
        resp.p2p_number = pr.p2p_number if pr else None
        resp.p2p_status = pr.status if pr else None
        if with_job and i.job_id in jobs:
            resp.job_number = jobs[i.job_id].job_number
            resp.job_title = jobs[i.job_id].title
        out.append(resp)
    return out


def _get_item(db: Session, job_id: int, item_id: int) -> ElectricalBomItem:
    item = db.query(ElectricalBomItem).filter(
        ElectricalBomItem.id == item_id, ElectricalBomItem.job_id == job_id, ElectricalBomItem.is_deleted == False  # noqa: E712
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail=f"BOM line #{item_id} not found on this job (it may have been deleted).")
    return item


def _validate(db: Session, job_id: int, data: dict) -> None:
    if data.get("category") and data["category"] not in ELECTRICAL_COMPONENT_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category '{data['category']}'. Use one of: {', '.join(ELECTRICAL_COMPONENT_CATEGORIES)}.")
    if data.get("selection_status") and data["selection_status"] not in ELECTRICAL_SELECTION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid selection status '{data['selection_status']}'. Use one of: {', '.join(ELECTRICAL_SELECTION_STATUSES)}.")
    if data.get("procurement_status") and data["procurement_status"] not in ELECTRICAL_PROCUREMENT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid procurement status '{data['procurement_status']}'. Use one of: {', '.join(ELECTRICAL_PROCUREMENT_STATUSES)}.")
    if data.get("store_item_id") and not db.query(StoreItem).filter(StoreItem.id == data["store_item_id"]).first():
        raise HTTPException(status_code=404, detail=f"Store item #{data['store_item_id']} not found. Pick the item again.")
    if data.get("panel_id") and not db.query(ElectricalPanel).filter(
        ElectricalPanel.id == data["panel_id"], ElectricalPanel.job_id == job_id, ElectricalPanel.is_deleted == False  # noqa: E712
    ).first():
        raise HTTPException(status_code=404, detail=f"Panel #{data['panel_id']} isn't on this job. Pick one of this job's panels.")


def _require_selection_fields(make: str | None, part_number: str | None, selection_status: str | None) -> None:
    if selection_status in ("selected", "approved") and not ((make or "").strip() and (part_number or "").strip()):
        raise HTTPException(status_code=400, detail="Enter both the make and the part number before marking a component as selected.")


@router.get("/jobs/{job_id}/bom", response_model=list[ElectricalBomItemResponse])
async def list_bom(job_id: int, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    items = db.query(ElectricalBomItem).filter(
        ElectricalBomItem.job_id == job_id, ElectricalBomItem.is_deleted == False  # noqa: E712
    ).order_by(ElectricalBomItem.line_no).all()
    return _to_responses(db, items)


@router.post("/jobs/{job_id}/bom", response_model=ElectricalBomItemResponse)
async def create_bom_item(job_id: int, payload: ElectricalBomItemCreate, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "change its BOM")
    data = payload.model_dump()
    data["description"] = data["description"].strip()
    _validate(db, job_id, data)
    _require_selection_fields(data.get("make"), data.get("part_number"), data.get("selection_status"))
    last = db.query(func.max(ElectricalBomItem.line_no)).filter(ElectricalBomItem.job_id == job_id).scalar() or 0
    item = ElectricalBomItem(**data, job_id=job_id, line_no=last + 1)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_responses(db, [item])[0]


@router.patch("/jobs/{job_id}/bom/{item_id}", response_model=ElectricalBomItemResponse)
async def update_bom_item(job_id: int, item_id: int, payload: ElectricalBomItemUpdate, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "change its BOM")
    item = _get_item(db, job_id, item_id)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("description"):
        updates["description"] = updates["description"].strip()
    _validate(db, job_id, updates)
    _require_selection_fields(
        updates.get("make", item.make), updates.get("part_number", item.part_number),
        updates.get("selection_status", item.selection_status),
    )
    for field, val in updates.items():
        setattr(item, field, val)
    db.commit()
    db.refresh(item)
    return _to_responses(db, [item])[0]


@router.delete("/jobs/{job_id}/bom/{item_id}")
async def delete_bom_item(job_id: int, item_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "change its BOM")
    item = _get_item(db, job_id, item_id)
    if item.procurement_status in ("ordered", "received", "issued"):
        raise HTTPException(
            status_code=409,
            detail=f"BOM line {item.line_no} ({item.description}) is already {item.procurement_status}. Set its quantity or remarks instead of deleting a line that has been bought.",
        )
    item.is_deleted = True
    item.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"BOM line {item.line_no} deleted"}


@router.post("/jobs/{job_id}/bom/{item_id}/link-pr", response_model=ElectricalBomItemResponse)
async def link_purchase_requisition(
    job_id: int, item_id: int, payload: ElectricalBomItemLinkPrPayload,
    db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT),
):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "change its BOM")
    item = _get_item(db, job_id, item_id)
    number = payload.p2p_number.strip().upper()
    pr = db.query(P2PRequest).filter(func.upper(P2PRequest.p2p_number) == number).first()
    if not pr:
        raise HTTPException(status_code=404, detail=f"No purchase requisition numbered '{payload.p2p_number.strip()}' exists in Procurement. Check the PR number (e.g. P2P-ELE-2026-0001).")
    if pr.status in ("rejected", "cancelled"):
        raise HTTPException(status_code=409, detail=f"{pr.p2p_number} was {pr.status} — link a live purchase requisition instead.")
    item.p2p_request_id = pr.id
    if item.procurement_status in ("required", "in_stock"):
        item.procurement_status = "pr_raised"
    db.commit()
    db.refresh(item)
    return _to_responses(db, [item])[0]


@router.post("/jobs/{job_id}/bom/{item_id}/unlink-pr", response_model=ElectricalBomItemResponse)
async def unlink_purchase_requisition(job_id: int, item_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "change its BOM")
    item = _get_item(db, job_id, item_id)
    if not item.p2p_request_id:
        raise HTTPException(status_code=409, detail=f"BOM line {item.line_no} isn't linked to a purchase requisition.")
    item.p2p_request_id = None
    if item.procurement_status == "pr_raised":
        item.procurement_status = "required"
    db.commit()
    db.refresh(item)
    return _to_responses(db, [item])[0]


@router.get("/purchase-requirements", response_model=list[ElectricalBomItemResponse])
async def list_purchase_requirements(
    procurement_status: str | None = Query(None, description="One status, or omit for everything still open"),
    job_id: int | None = None,
    category: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access(ELECTRICAL_APP, "purchase")),
):
    query = db.query(ElectricalBomItem).join(ElectricalJob, ElectricalJob.id == ElectricalBomItem.job_id).filter(
        ElectricalBomItem.is_deleted == False, ElectricalJob.is_deleted == False,  # noqa: E712
        ElectricalJob.status.in_((*OPEN_JOB_STATUSES, "handed_over")),
    )
    query = query.filter(ElectricalBomItem.procurement_status == procurement_status) if procurement_status else query.filter(
        ElectricalBomItem.procurement_status.in_(_OPEN_PROCUREMENT)
    )
    if job_id:
        query = query.filter(ElectricalBomItem.job_id == job_id)
    if category:
        query = query.filter(ElectricalBomItem.category == category)
    if search:
        like = f"%{search}%"
        query = query.filter(
            ElectricalBomItem.description.ilike(like) | ElectricalBomItem.part_number.ilike(like)
            | ElectricalBomItem.make.ilike(like) | ElectricalJob.job_number.ilike(like)
        )
    items = query.order_by(ElectricalJob.job_number, ElectricalBomItem.line_no).all()
    return _to_responses(db, items, with_job=True)
