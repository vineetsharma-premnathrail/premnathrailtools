"""HR & Administration — business travel requests (TR-YYYY-NNNN).

Owner: Agent D. Employees raise their own requests; approval runs through the
central approval engine (hr.travel — default: the requester's reporting
manager plus HR approvers; see services/approvals.py). `approver_id` still
records the manager at submission. Nobody decides their own request."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.permissions import require_feature_action
from app.core.data_scope import apply_scope
from app.modules.hr.services import approvals as hr_approvals
from app.core.sequential_id import next_sequential_id
from app.db.session import get_db
from app.modules.hr.models.travel import HrTravelRequest, TRAVEL_MODES, TRAVEL_STATUSES
from app.modules.hr.services.calendar import today_ist
from app.modules.hr.schemas.travel import (
    HrTravelRequestCreate, HrTravelRequestUpdate, HrTravelRequestDecisionPayload, HrTravelRequestResponse,
)
from app.modules.hr.services.access import (
    can_decide, can_hr, ensure_can_decide, is_hr_for, require_hr_tab, require_me_create, require_me_edit, require_me_view,
)
from app.modules.hr.services.admin_common import users_by_id, display_name, require_choice
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.utils.notifications import notify_user

router = APIRouter(prefix="/hr/travel", tags=["HR"])

# HR-team gate for this file: hr app + Permission Matrix › HR › travel.
require_hr = require_hr_tab("travel")
require_complete_trip = require_feature_action("hr", "travel", "complete_trip", "edit")  # mark a trip completed
# Raising / editing / withdrawing your own trip is self-service: hr:me:create / hr:me:edit.


# ── helpers ─────────────────────────────────────────────────────────────────

def _route(tr: HrTravelRequest) -> str:
    return f"{tr.from_city} → {tr.to_city}"


def _can_cancel(user: User, tr: HrTravelRequest) -> bool:
    if tr.user_id != user.id or not can_hr(user, "me", "edit"):
        return False
    return tr.status == "pending" or (tr.status == "approved" and tr.depart_date > today_ist())


ENTITY = hr_approvals.TRAVEL_ENTITY


def _can_decide(db: Session, viewer: User, r: HrTravelRequest, areqs: dict) -> bool:
    """Engine-routed: whoever the engine lets act now. Pre-engine requests:
    the legacy access.can_decide."""
    if r.status != "pending":
        return False
    if r.id in areqs:
        return hr_approvals.can_decide_engine(db, viewer, areqs[r.id])
    return can_decide(viewer, r.approver_id, r.user_id, "approve", ("travel",))


def _to_responses(db: Session, viewer: User, rows: list[HrTravelRequest]) -> list[HrTravelRequestResponse]:
    users = users_by_id(db, [x for r in rows for x in (r.user_id, r.approver_id, r.decided_by_id)])
    areqs = hr_approvals.latest_by_entity(db, ENTITY, [r.id for r in rows])
    out = []
    for r in rows:
        resp = HrTravelRequestResponse.model_validate(r)
        u = users.get(r.user_id)
        resp.user_name = display_name(u)
        resp.user_email = u.email if u else None
        resp.user_department = u.department if u else None
        resp.approver_name = display_name(users.get(r.approver_id))
        resp.decided_by_name = display_name(users.get(r.decided_by_id))
        resp.can_decide = _can_decide(db, viewer, r, areqs)
        resp.approval_request_id = areqs[r.id].id if r.id in areqs else None
        resp.can_cancel = _can_cancel(viewer, r)
        resp.can_edit = r.user_id == viewer.id and r.status == "pending" and can_hr(viewer, "me", "edit")
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


def _ensure_can_view(db: Session, user: User, tr: HrTravelRequest) -> None:
    if user.id in (tr.user_id, tr.approver_id):
        return
    if is_hr_for(user, ("travel", "approvals")):
        hr_approvals.ensure_scope_unless_party(db, user, tr, tr.user_id, tr.approver_id)
        return
    if hr_approvals.can_decide_engine(db, user, hr_approvals.open_request(db, ENTITY, tr.id)):
        return  # an engine approver / delegate / escalation target of this request
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


def _submit_for_approval(db: Session, tr: HrTravelRequest, requester: User, background_tasks: BackgroundTasks | None = None) -> None:
    """Route through Organization › Approval Workflows (default: reporting
    manager + HR approvers). The engine notifies the approvers and refuses with
    the exact reason when nobody can approve."""
    hr_approvals.submit(
        db, hr_approvals.TRAVEL_KEY, entity_id=tr.id, requester=requester,
        title=f"Travel {_route(tr)} — {display_name(requester)}, {tr.depart_date:%d-%m-%Y}", reference=tr.request_no,
        amount=float(tr.estimated_cost) if tr.estimated_cost is not None else None,
        context={"advance_required": float(tr.advance_required or 0), "travel_mode": tr.travel_mode},
    )
    from app.modules.hr.services import role_events
    role_events.fire(
        db, background_tasks, "travel_submitted", title=f"Travel request waiting for approval — {tr.request_no}",
        message=(f"{display_name(requester)}: {_route(tr)}, from {tr.depart_date:%d-%m-%Y}"
                 + (f", estimated ₹{float(tr.estimated_cost):,.0f}" if tr.estimated_cost is not None else "")
                 + ". Approve or reject it under HR › Approvals."),
        entity_type=ENTITY, entity_id=tr.id, actor=requester, can_open=role_events.employee_opener(db, requester),
        skip=role_events.approver_ids(hr_approvals.open_request(db, ENTITY, tr.id)),
    )


# ── self-service ────────────────────────────────────────────────────────────

@router.get("/mine", response_model=list[HrTravelRequestResponse])
async def list_my_travel(
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(require_me_view),
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
    """Pending requests waiting for the signed-in user: the engine's inbox for
    engine-routed requests; for pre-engine requests their reports' requests,
    plus (for HR) requests whose requester has no manager."""
    cond = HrTravelRequest.approver_id == user.id
    if is_hr_for(user, "approvals"):
        cond = or_(cond, HrTravelRequest.approver_id.is_(None))
    cond = and_(cond, HrTravelRequest.id.notin_(hr_approvals.engine_tracked_ids(ENTITY)))
    engine_ids = hr_approvals.inbox_ids(db, user, ENTITY)
    if engine_ids:
        cond = or_(cond, HrTravelRequest.id.in_(engine_ids))
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
    user: User = Depends(require_me_create),
    background_tasks: BackgroundTasks = None,
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
    _submit_for_approval(db, tr, user, background_tasks)
    db.commit()
    db.refresh(tr)
    return _to_responses(db, user, [tr])[0]


@router.get("/meta")
async def travel_meta(_user: User = Depends(get_current_user)):  # static lists; hr app (router-level) is enough
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
    q = apply_scope(db.query(HrTravelRequest), user, HrTravelRequest)
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
    _ensure_can_view(db, user, tr)
    return _to_responses(db, user, [tr])[0]


@router.patch("/{request_id}", response_model=HrTravelRequestResponse)
async def update_travel_request(
    request_id: int,
    payload: HrTravelRequestUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_me_edit),
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
    # The approval route (which stages apply) was worked out from the cost,
    # advance and travel mode at submit — changing them afterwards would skip
    # stages a bigger amount needs.
    routed = [k for k in ("estimated_cost", "advance_required", "travel_mode")
              if k in data and data[k] != getattr(tr, k)]
    if routed and hr_approvals.open_request(db, ENTITY, tr.id):
        raise HTTPException(
            status_code=409,
            detail=f"{tr.request_no} is already with its approvers, so the {', '.join(k.replace('_', ' ') for k in routed)} "
                   "can't be changed — the approval route depends on them. Cancel it and raise a new request with the new figures.",
        )
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
    if not approve and not (remarks or "").strip():
        raise HTTPException(status_code=400, detail="Enter a reason when rejecting a travel request, so the employee knows what to change.")
    # Engine-routed: the engine checks who may act and calls _on_travel_decided.
    if hr_approvals.decide(db, ENTITY, tr.id, user, approve, (remarks or "").strip() or None,
                          what="travel request", record_pending=tr.status == "pending"):
        return
    # Pre-engine request: routed approver passes on routing alone; anyone else
    # needs hr:approvals:<approve|reject> or hr:travel:<approve|reject>.
    ensure_can_decide(user, tr.approver_id, tr.user_id, "travel request", "approve" if approve else "reject", ("travel",))
    hr_approvals.ensure_scope_unless_party(db, user, tr, tr.user_id, tr.approver_id)  # HR deciders: data access
    _apply_decision(db, user, tr, approve, remarks)


def _apply_decision(db: Session, user: User, tr: HrTravelRequest, approve: bool, remarks: str | None,
                    notify: bool = True, returned: bool = False) -> None:
    if tr.status != "pending":
        who = display_name(db.query(User).filter(User.id == tr.decided_by_id).first()) if tr.decided_by_id else None
        raise HTTPException(
            status_code=409,
            detail=f"{tr.request_no} is already {tr.status}{f' by {who}' if who else ''}, so it cannot be decided again. Refresh the page.",
        )
    tr.status = "approved" if approve else "rejected"
    tr.decided_by_id = user.id
    tr.decided_at = datetime.now(timezone.utc)
    tr.decision_remarks = (remarks or "").strip() or None
    if returned and tr.decision_remarks:
        # A travel request can't be edited once decided: "returned for changes"
        # ends it like a rejection and the employee raises a new one.
        tr.decision_remarks = f"Returned for changes: {tr.decision_remarks}"
    verb = "approved" if approve else "rejected"
    if notify:
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


def _on_travel_decided(db: Session, areq, outcome: str, actor: User) -> None:
    """Approval engine callback (hr.travel). The engine has already notified
    the employee, so no second notification here."""
    tr = _get(db, areq.entity_id, lock=True)
    if outcome in ("approved", "rejected", "returned"):
        _apply_decision(db, actor, tr, outcome == "approved", hr_approvals.decision_comment(areq, actor),
                        notify=False, returned=outcome == "returned")
    elif outcome == "cancelled" and tr.status == "pending":
        tr.status = "cancelled"


hr_approvals.register_hr_type(
    hr_approvals.TRAVEL_KEY, "travel", "Travel request", ENTITY, "/dashboard/hr/approvals", _on_travel_decided,
    description="Business travel (HR › Travel & Claims). Amount = estimated cost.",
    context_fields={
        "advance_required": {"label": "Advance required (₹)", "type": "number"},
        "travel_mode": {"label": "Travel mode", "type": "choice", "choices": list(TRAVEL_MODES),
                        "choice_labels": {"air": "Air", "train": "Train", "bus": "Bus", "car": "Car",
                                          "company_vehicle": "Company vehicle", "other": "Other"}},
    },
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
    user: User = Depends(require_me_edit),
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
    if not was_approved:
        # Close the live approval so it leaves every approver's inbox.
        hr_approvals.withdraw(db, ENTITY, tr.id, user, payload.remarks or None)
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
    user: User = Depends(require_complete_trip),
):
    tr = _get(db, request_id, lock=True)
    hr_approvals.ensure_scope_unless_party(db, user, tr)  # HR data access (Organization › Role & Permissions)
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
