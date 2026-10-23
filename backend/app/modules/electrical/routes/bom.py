"""A job's electrical BOM, plus the cross-job Purchase Requirements view of
every line that still has to be bought. Linking a line to a P2P purchase
requisition only stores the pointer — the PR itself is raised and processed
in Procurement as usual."""
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature, can_view_tab
from app.core.permissions import require_app_access, require_feature_action, require_tab_access
from app.db.session import get_db
from app.modules.electrical import access
from app.modules.electrical.models.bom import (
    ElectricalBomItem, ELECTRICAL_COMPONENT_CATEGORIES, ELECTRICAL_SELECTION_STATUSES, ELECTRICAL_PROCUREMENT_STATUSES,
)
from app.modules.electrical.models.job import ElectricalJob
from app.modules.electrical.models.panel import ElectricalPanel
from app.modules.electrical.schemas.bom import (
    ElectricalBomItemCreate, ElectricalBomItemUpdate, ElectricalBomItemLinkPrPayload, ElectricalBomItemResponse,
)
from app.modules.electrical.service import (
    ELECTRICAL_APP, OPEN_JOB_STATUSES, can_see_costs, ensure_job_view, get_job_or_404, require_job_feature,
    require_working,
)
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.store.models.item import StoreItem

router = APIRouter(
    prefix="/electrical", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)

# Any Electrical user — record-level access is the job's data scope.
_VIEWER = require_app_access(ELECTRICAL_APP)

# Electrical › RRV Electrical Jobs › BOM (app/core/features/electrical.py).
_CAN_CREATE = require_feature_action("electrical", "jobs", "bom", "create")
_CAN_EDIT = require_feature_action("electrical", "jobs", "bom", "edit")
_CAN_DELETE = require_feature_action("electrical", "jobs", "bom", "delete")
# Linking a BOM line to a PR is a buyer's job too — Purchase Requirements
# editors can do it without full job-edit rights.
_CAN_LINK_PR = require_job_feature("bom", "edit", ("purchase", "edit"))
# Procurement statuses that only make sense once a PR exists in Procurement.
_PR_BACKED = ("pr_raised", "ordered")
_PROCUREMENT_LABELS = {"pr_raised": "PR Raised", "ordered": "Ordered"}
# Statuses that still need Procurement's attention on the Purchase Requirements page.
_OPEN_PROCUREMENT = ("required", "pr_raised", "ordered")


def _to_responses(db: Session, items: list[ElectricalBomItem], user: User, with_job: bool = False) -> list[ElectricalBomItemResponse]:
    """BOM line responses; the estimated cost is blanked for anyone without
    Electrical › RRV Electrical Jobs › BOM costs."""
    show_costs = can_see_costs(user)
    store_ids = {i.store_item_id for i in items if i.store_item_id}
    panel_ids = {i.panel_id for i in items if i.panel_id}
    pr_ids = {i.p2p_request_id for i in items if i.p2p_request_id}
    store = {s.id: s.item_code for s in db.query(StoreItem).filter(StoreItem.id.in_(store_ids)).all()} if store_ids else {}
    panels = {p.id: p.panel_tag for p in db.query(ElectricalPanel).filter(ElectricalPanel.id.in_(panel_ids)).all()} if panel_ids else {}
    prs = {p.id: p for p in db.query(P2PRequest).filter(P2PRequest.id.in_(pr_ids)).all()} if pr_ids else {}
    item_ids = [i.id for i in items if i.selection_status == "selected"]
    live = dict(db.query(ApprovalRequest.entity_id, ApprovalRequest.id).filter(
        ApprovalRequest.entity_type == access.BOM_ENTITY, ApprovalRequest.entity_id.in_(item_ids),
        ApprovalRequest.status == "pending",
    ).all()) if item_ids else {}
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
        resp.approval_request_id = live.get(i.id)
        if not show_costs:
            resp.estimated_unit_cost = None
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


def _require_pr_for_status(line_no: int, procurement_status: str | None, p2p_request_id: int | None) -> None:
    """'PR Raised' / 'Ordered' must be backed by a real purchase requisition —
    otherwise the Purchase Requirement gate could be passed by hand."""
    if procurement_status in _PR_BACKED and not p2p_request_id:
        raise HTTPException(
            status_code=400,
            detail=f"BOM line {line_no} can't be marked '{_PROCUREMENT_LABELS[procurement_status]}' until it is linked to a "
                   "purchase requisition — use 'Link PR' (or 'Raise PR') first, or mark it 'In stock' if Store already holds it.",
        )


def _require_approver(user: User) -> None:
    if not can_feature(user, "electrical", "jobs", "bom", "approve"):
        raise HTTPException(
            status_code=403,
            detail="Only someone with 'Approve' permission on Electrical › RRV Electrical Jobs › BOM "
                   "can approve a component selection — leave the line as 'Selected' and use "
                   "'Submit for approval', or ask an admin to grant the permission in Organization › Role & Permissions.",
        )


def _drop_cost_unless_visible(user: User, data: dict) -> None:
    """Someone who can't see BOM costs can't enter or change them either (the
    form never shows the field, so a blank there must not wipe the cost)."""
    if not can_see_costs(user):
        data.pop("estimated_unit_cost", None)


def _require_not_awaiting(db: Session, item: ElectricalBomItem, updates: dict) -> None:
    """While the selection waits for approval its make / part / status are
    frozen — the approver must decide what was submitted."""
    if not access.live_request(db, access.BOM_ENTITY, item.id):
        return
    frozen = [f for f in ("make", "part_number", "selection_status") if f in updates and updates[f] != getattr(item, f)]
    if frozen:
        raise HTTPException(
            status_code=409,
            detail=f"BOM line {item.line_no}'s component selection is waiting for approval, so its make, part number and "
                   "selection status can't change. Withdraw the approval request on the line first (or wait for the decision).",
        )


@router.get("/jobs/{job_id}/bom", response_model=list[ElectricalBomItemResponse])
async def list_bom(job_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEWER)):
    # Purchase Requirements viewers already see every open BOM line there.
    ensure_job_view(user, can_feature(user, "electrical", "jobs", "bom", "view")
                    or can_view_tab(user, "electrical", "purchase"), "bom")
    get_job_or_404(db, job_id, user=user)
    items = db.query(ElectricalBomItem).filter(
        ElectricalBomItem.job_id == job_id, ElectricalBomItem.is_deleted == False  # noqa: E712
    ).order_by(ElectricalBomItem.line_no).all()
    return _to_responses(db, items, user)


@router.post("/jobs/{job_id}/bom", response_model=ElectricalBomItemResponse)
async def create_bom_item(job_id: int, payload: ElectricalBomItemCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    job = get_job_or_404(db, job_id, lock=True, user=user)
    require_working(job, "change its BOM")
    data = payload.model_dump()
    _drop_cost_unless_visible(user, data)
    data["description"] = data["description"].strip()
    _validate(db, job_id, data)
    _require_selection_fields(data.get("make"), data.get("part_number"), data.get("selection_status"))
    last = db.query(func.max(ElectricalBomItem.line_no)).filter(ElectricalBomItem.job_id == job_id).scalar() or 0
    _require_pr_for_status(last + 1, data.get("procurement_status"), data.get("p2p_request_id"))
    approve_now = data.get("selection_status") == "approved"
    if approve_now:
        _require_approver(user)
        data["selection_status"] = "selected"  # the approval itself goes through the approval engine
    item = ElectricalBomItem(**data, job_id=job_id, line_no=last + 1)
    db.add(item)
    db.flush()
    if approve_now:
        access.approve_bom_item_now(db, item, job, user)
    db.commit()
    db.refresh(item)
    return _to_responses(db, [item], user)[0]


@router.patch("/jobs/{job_id}/bom/{item_id}", response_model=ElectricalBomItemResponse)
async def update_bom_item(job_id: int, item_id: int, payload: ElectricalBomItemUpdate, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True, user=user)
    require_working(job, "change its BOM")
    item = _get_item(db, job_id, item_id)
    updates = payload.model_dump(exclude_unset=True)
    _drop_cost_unless_visible(user, updates)
    if updates.get("description"):
        updates["description"] = updates["description"].strip()
    _validate(db, job_id, updates)
    _require_selection_fields(
        updates.get("make", item.make), updates.get("part_number", item.part_number),
        updates.get("selection_status", item.selection_status),
    )
    # Only a status *change* is checked, so editing remarks / qty on an older
    # line saved before this rule doesn't start failing.
    new_proc = updates.get("procurement_status", item.procurement_status)
    if new_proc != item.procurement_status:
        _require_pr_for_status(item.line_no, new_proc, updates.get("p2p_request_id", item.p2p_request_id))
    _require_not_awaiting(db, item, updates)
    # Approving a selection — or changing the make / part number of an
    # approved one — needs approve rights, and is recorded as a submit +
    # approve on the approval engine.
    approve_now = updates.get("selection_status", item.selection_status) == "approved" and (
        item.selection_status != "approved"
        or updates.get("make", item.make) != item.make
        or updates.get("part_number", item.part_number) != item.part_number
    )
    if approve_now:
        _require_approver(user)
    for field, val in updates.items():
        setattr(item, field, val)
    if approve_now:
        access.approve_bom_item_now(db, item, job, user)
    db.commit()
    db.refresh(item)
    return _to_responses(db, [item], user)[0]


@router.delete("/jobs/{job_id}/bom/{item_id}")
async def delete_bom_item(job_id: int, item_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_DELETE)):
    job = get_job_or_404(db, job_id, lock=True, user=_perm)
    require_working(job, "change its BOM")
    item = _get_item(db, job_id, item_id)
    if item.procurement_status in ("ordered", "received", "issued"):
        raise HTTPException(
            status_code=409,
            detail=f"BOM line {item.line_no} ({item.description}) is already {item.procurement_status}. Set its quantity or remarks instead of deleting a line that has been bought.",
        )
    access.cancel_live(db, access.BOM_ENTITY, item.id, _perm, "BOM line deleted")
    item.is_deleted = True
    item.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"BOM line {item.line_no} deleted"}


@router.post("/jobs/{job_id}/bom/{item_id}/submit", response_model=ElectricalBomItemResponse)
async def submit_bom_selection(
    job_id: int, item_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("electrical", "jobs", "bom", "submit")),
):
    """Sends a line's component selection (make + part number) for approval
    through the central approval engine (Organization › Approval Workflows)."""
    job = get_job_or_404(db, job_id, lock=True, user=user)
    require_working(job, "change its BOM")
    item = _get_item(db, job_id, item_id)
    if item.selection_status != "selected":
        state = "already approved" if item.selection_status == "approved" else "still only proposed"
        raise HTTPException(
            status_code=409,
            detail=f"BOM line {item.line_no} is {state}. Only a line marked 'Selected' (make and part number picked) "
                   "can be submitted for approval.",
        )
    _require_selection_fields(item.make, item.part_number, "selected")
    req = access.submit_bom_item(db, item, job, user)
    access.notify_job_event(
        db, background_tasks, "bom_selection_submitted", job, title="Electrical Component Selection Awaiting Approval",
        message=f"BOM line {item.line_no} ({item.description} — {item.make} {item.part_number}) on {job.job_number} was "
                f"submitted for approval by {user.name or user.email}. Approve it from the job's BOM tab or the approvals inbox.",
        actor=user, skip={s.approver_id for s in req.steps},
    )
    db.commit()
    db.refresh(item)
    return _to_responses(db, [item], user)[0]


@router.post("/jobs/{job_id}/bom/{item_id}/link-pr", response_model=ElectricalBomItemResponse)
async def link_purchase_requisition(
    job_id: int, item_id: int, payload: ElectricalBomItemLinkPrPayload,
    db: Session = Depends(get_db), _perm: User = Depends(_CAN_LINK_PR),
):
    job = get_job_or_404(db, job_id, lock=True, user=_perm)
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
    return _to_responses(db, [item], _perm)[0]


@router.post("/jobs/{job_id}/bom/{item_id}/unlink-pr", response_model=ElectricalBomItemResponse)
async def unlink_purchase_requisition(job_id: int, item_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_LINK_PR)):
    job = get_job_or_404(db, job_id, lock=True, user=_perm)
    require_working(job, "change its BOM")
    item = _get_item(db, job_id, item_id)
    if not item.p2p_request_id:
        raise HTTPException(status_code=409, detail=f"BOM line {item.line_no} isn't linked to a purchase requisition.")
    item.p2p_request_id = None
    if item.procurement_status in _PR_BACKED:
        item.procurement_status = "required"
    db.commit()
    db.refresh(item)
    return _to_responses(db, [item], _perm)[0]


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
    query = access.scope_jobs(query, db, _tab)
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
    return _to_responses(db, items, _tab, with_job=True)
