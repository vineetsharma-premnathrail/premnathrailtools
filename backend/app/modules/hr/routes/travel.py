"""HR & Administration — business travel requests (TR-YYYY-NNNN).

Owner: Agent D. Employees raise their own requests; the approver captured at
submission is the requester's reporting manager (NULL if none, in which case
any HR user decides). Nobody decides their own request."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.sequential_id import next_sequential_id
from app.db.session import get_db
from app.modules.hr.models.travel import HrTravelRequest, TRAVEL_MODES, TRAVEL_STATUSES
from app.modules.hr.schemas.travel import (
    HrTravelRequestCreate, HrTravelRequestUpdate, HrTravelRequestDecisionPayload, HrTravelRequestResponse,
)
from app.modules.hr.services.access import can_decide, ensure_can_decide, is_hr, require_hr
from app.modules.hr.services.admin_common import users_by_id, display_name, require_choice
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.utils.notifications import notify_user

router = APIRouter(prefix="/hr/travel", tags=["HR"])


# ── helpers ─────────────────────────────────────────────────────────────────

def _route(tr: HrTravelRequest) -> str:
    return f"{tr.from_city} → {tr.to_city}"


def _can_cancel(user: User, tr: HrTravelRequest) -> bool:
    if tr.user_id != user.id:
        return False
    return tr.status == "pending" or (tr.status == "approved" and tr.depart_date > date.today())


def _to_responses(db: Session, viewer: User, rows: list[HrTravelRequest]) -> list[HrTravelRequestResponse]:
    users = users_by_id(db, [x for r in rows for x in (r.user_id, r.approver_id, r.decided_by_id)])
    out = []
    for r in rows:
        resp = HrTravelRequestResponse.model_validate(r)
        u = users.get(r.user_id)
        resp.user_name = display_name(u)
        resp.user_email = u.email if u else None
        resp.user_department = u.department if u else None
        resp.approver_name = display_name(users.get(r.approver_id))
        resp.decided_by_name = display_name(users.get(r.decided_by_id))
        resp.can_decide = r.status == "pending" and can_decide(viewer, r.approver_id, r.user_id)
        resp.can_cancel = _can_cancel(viewer, r)
        resp.can_edit = r.user_id == viewer.id and r.status == "pending"
        out.append(resp)
    return out


def _get(db: Session, request_id: int, lock: bool = False) -> HrTravelRequest:
    """`lock=True` for state changes (SELECT ... FOR UPDATE) so two people
    deciding/cancelling the same request at once are serialised."""
    q = db.query(HrTravelRequest).filter(HrTravelRequest.id == request_id)
    if lock:
        q = q.with_for_update().populate_existing()
    tr = q.first()
    if not tr:
        raise HTTPException(status_code=404, detail=f"Travel request #{request_id} was not found. Refresh the list — it may have been removed.")
    return tr


def _ensure_can_view(user: User, tr: HrTravelRequest) -> None:
    if user.id in (tr.user_id, tr.approver_id) or is_hr(user):
        return
    raise HTTPException(
        status_code=403,
        detail="You can only open your own travel requests or ones waiting for your approval. HR can see every request.",
    )


def _validate(travel_mode: str | None, depart: date | None, ret: date | None) -> None:
    require_choice(travel_mode, TRAVEL_MODES, "travel mode")
    if depart and ret and ret < depart:
        raise HTTPException(
            status_code=400,
            detail=f"Return date ({ret:%d-%m-%Y}) is before the departure date ({depart:%d-%m-%Y}). Pick a return date on or after departure.",
        )


def _approver_for(user: User) -> int | None:
    mid = user.reporting_manager_id
    return mid if mid and mid != user.id else None


def _notify_approvers(db: Session, tr: HrTravelRequest, requester: User) -> None:
    msg = (
        f"{display_name(requester)} requested travel {_route(tr)} on {tr.depart_date:%d-%m-%Y} ({tr.request_no}). "
        "Open HR → Approvals to decide."
    )
    if tr.approver_id:
        notify_user(db, tr.approver_id, "Travel request awaiting your approval", msg,
                    "hr_travel_submitted", entity_type="hr_travel_request", entity_id=tr.id)


# ── self-service ────────────────────────────────────────────────────────────

@router.get("/mine", response_model=list[HrTravelRequestResponse])
async def list_my_travel(
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(HrTravelRequest).filter(HrTravelRequest.user_id == user.id)
    if status_filter:
        require_choice(status_filter, TRAVEL_STATUSES, "travel status")
        q = q.filter(HrTravelRequest.status == status_filter)
    rows = q.order_by(HrTravelRequest.depart_date.desc(), HrTravelRequest.id.desc()).all()
    return _to_responses(db, user, rows)


@router.get("/approvals", response_model=list[HrTravelRequestResponse])
async def list_travel_approvals(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Pending requests waiting for the signed-in user: their reports'
    requests, plus (for HR) requests whose requester has no manager."""
    cond = HrTravelRequest.approver_id == user.id
    if is_hr(user):
        cond = or_(cond, HrTravelRequest.approver_id.is_(None))
    rows = (
        db.query(HrTravelRequest)
        .filter(HrTravelRequest.status == "pending", HrTravelRequest.user_id != user.id, cond)
        .order_by(HrTravelRequest.depart_date.asc(), HrTravelRequest.id.asc()).all()
    )
    return _to_responses(db, user, rows)


@router.post("", response_model=HrTravelRequestResponse, status_code=201)
async def create_travel_request(
    payload: HrTravelRequestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _validate(payload.travel_mode, payload.depart_date, payload.return_date)
    if payload.from_city.strip().lower() == payload.to_city.strip().lower():
        raise HTTPException(
            status_code=400,
            detail=f"From and To city are both '{payload.to_city}'. Enter the city you are travelling to — local conveyance goes directly on an expense claim.",
        )
    tr = HrTravelRequest(
        request_no=next_sequential_id(db, prefix=f"TR-{date.today().year}-", column=HrTravelRequest.request_no),
        user_id=user.id, approver_id=_approver_for(user), status="pending",
        **{**payload.model_dump(), "from_city": payload.from_city.strip(), "to_city": payload.to_city.strip()},
    )
    db.add(tr)
    db.flush()
    _notify_approvers(db, tr, user)
    db.commit()
    db.refresh(tr)
    return _to_responses(db, user, [tr])[0]


@router.get("/meta")
async def travel_meta(_user: User = Depends(get_current_user)):
    return {"modes": list(TRAVEL_MODES), "statuses": list(TRAVEL_STATUSES)}


# ── HR list ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[HrTravelRequestResponse])
async def list_travel_requests(
    status_filter: str | None = Query(None, alias="status"),
    user_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    q = db.query(HrTravelRequest)
    if status_filter:
        require_choice(status_filter, TRAVEL_STATUSES, "travel status")
        q = q.filter(HrTravelRequest.status == status_filter)
    if user_id:
        q = q.filter(HrTravelRequest.user_id == user_id)
    if date_from:
        q = q.filter(HrTravelRequest.depart_date >= date_from)
    if date_to:
        q = q.filter(HrTravelRequest.depart_date <= date_to)
    if search and search.strip():
        term = f"%{search.strip()}%"
        uids = [u.id for u in db.query(User.id).filter(or_(User.name.ilike(term), User.email.ilike(term))).all()]
        conds = [
            HrTravelRequest.request_no.ilike(term), HrTravelRequest.from_city.ilike(term),
            HrTravelRequest.to_city.ilike(term), HrTravelRequest.purpose.ilike(term),
            HrTravelRequest.project_reference.ilike(term),
        ]
        if uids:
            conds.append(HrTravelRequest.user_id.in_(uids))
        q = q.filter(or_(*conds))
    rows = q.order_by(HrTravelRequest.depart_date.desc(), HrTravelRequest.id.desc()).limit(500).all()
    return _to_responses(db, user, rows)


# ── single request ──────────────────────────────────────────────────────────

@router.get("/{request_id}", response_model=HrTravelRequestResponse)
async def get_travel_request(
    request_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tr = _get(db, request_id)
    _ensure_can_view(user, tr)
    return _to_responses(db, user, [tr])[0]


@router.patch("/{request_id}", response_model=HrTravelRequestResponse)
async def update_travel_request(
    request_id: int,
    payload: HrTravelRequestUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tr = _get(db, request_id)
    if tr.user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the employee who raised this travel request can edit it.")
    if tr.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"{tr.request_no} is already {tr.status}, so it can no longer be edited. Cancel it and raise a new request if the plan changed.",
        )
    data = payload.model_dump(exclude_unset=True)
    for required in ("purpose", "from_city", "to_city", "depart_date", "travel_mode"):
        if required in data and data[required] in (None, ""):
            raise HTTPException(status_code=400, detail=f"{required.replace('_', ' ').capitalize()} cannot be blank on a travel request.")
    _validate(data.get("travel_mode"), data.get("depart_date", tr.depart_date), data.get("return_date", tr.return_date))
    for k, v in data.items():
        setattr(tr, k, v.strip() if isinstance(v, str) and k in ("from_city", "to_city") else v)
    db.commit()
    db.refresh(tr)
    return _to_responses(db, user, [tr])[0]


def _decide(db: Session, user: User, tr: HrTravelRequest, approve: bool, remarks: str | None) -> None:
    ensure_can_decide(user, tr.approver_id, tr.user_id, "travel request")
    if tr.status != "pending":
        who = display_name(db.query(User).filter(User.id == tr.decided_by_id).first()) if tr.decided_by_id else None
        raise HTTPException(
            status_code=409,
            detail=f"{tr.request_no} is already {tr.status}{f' by {who}' if who else ''}, so it cannot be decided again. Refresh the page.",
        )
    if not approve and not (remarks or "").strip():
        raise HTTPException(status_code=400, detail="Enter a reason when rejecting a travel request, so the employee knows what to change.")
    tr.status = "approved" if approve else "rejected"
    tr.decided_by_id = user.id
    tr.decided_at = datetime.now(timezone.utc)
    tr.decision_remarks = (remarks or "").strip() or None
    verb = "approved" if approve else "rejected"
    notify_user(
        db, tr.user_id, f"Travel request {verb}",
        f"{display_name(user)} {verb} your travel request {tr.request_no} ({_route(tr)})"
        + (f": {tr.decision_remarks}" if tr.decision_remarks else "."),
        f"hr_travel_{verb}", entity_type="hr_travel_request", entity_id=tr.id,
    )
    record_audit(
        db, entity_type="hr_travel_request", entity_id=tr.id, action=verb, module_key="hr",
        summary=f"Travel request {tr.request_no} {verb}" + (f": {tr.decision_remarks}" if tr.decision_remarks else ""),
        user_id=user.id,
    )


@router.post("/{request_id}/approve", response_model=HrTravelRequestResponse)
async def approve_travel_request(
    request_id: int,
    payload: HrTravelRequestDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tr = _get(db, request_id, lock=True)
    _decide(db, user, tr, True, payload.remarks)
    db.commit()
    db.refresh(tr)
    return _to_responses(db, user, [tr])[0]


@router.post("/{request_id}/reject", response_model=HrTravelRequestResponse)
async def reject_travel_request(
    request_id: int,
    payload: HrTravelRequestDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tr = _get(db, request_id, lock=True)
    _decide(db, user, tr, False, payload.remarks)
    db.commit()
    db.refresh(tr)
    return _to_responses(db, user, [tr])[0]


@router.post("/{request_id}/cancel", response_model=HrTravelRequestResponse)
async def cancel_travel_request(
    request_id: int,
    payload: HrTravelRequestDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tr = _get(db, request_id, lock=True)
    if tr.user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the employee who raised this travel request can cancel it.")
    if not _can_cancel(user, tr):
        if tr.status == "approved":
            detail = (
                f"{tr.request_no} was due to start on {tr.depart_date:%d-%m-%Y}, so it can no longer be cancelled. "
                "Ask HR to close it if the trip did not happen."
            )
        else:
            detail = f"{tr.request_no} is already {tr.status}, so it cannot be cancelled."
        raise HTTPException(status_code=409, detail=detail)
    was_approved = tr.status == "approved"
    tr.status = "cancelled"
    if payload.remarks:
        tr.decision_remarks = f"{tr.decision_remarks}\nCancelled: {payload.remarks}" if tr.decision_remarks else f"Cancelled: {payload.remarks}"
    target = tr.decided_by_id if was_approved else tr.approver_id
    if target and target != user.id:
        notify_user(
            db, target, "Travel request cancelled",
            f"{display_name(user)} cancelled travel request {tr.request_no} ({_route(tr)}).",
            "hr_travel_cancelled", entity_type="hr_travel_request", entity_id=tr.id,
        )
    db.commit()
    db.refresh(tr)
    return _to_responses(db, user, [tr])[0]


@router.post("/{request_id}/complete", response_model=HrTravelRequestResponse)
async def complete_travel_request(
    request_id: int,
    payload: HrTravelRequestDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    tr = _get(db, request_id, lock=True)
    if tr.status != "approved":
        raise HTTPException(
            status_code=409,
            detail=f"{tr.request_no} is {tr.status}; only approved trips can be marked completed.",
        )
    tr.status = "completed"
    if payload.remarks:
        tr.decision_remarks = f"{tr.decision_remarks}\nCompleted: {payload.remarks}" if tr.decision_remarks else f"Completed: {payload.remarks}"
    record_audit(
        db, entity_type="hr_travel_request", entity_id=tr.id, action="completed", module_key="hr",
        summary=f"Travel request {tr.request_no} marked completed", user_id=user.id,
    )
    db.commit()
    db.refresh(tr)
    return _to_responses(db, user, [tr])[0]
