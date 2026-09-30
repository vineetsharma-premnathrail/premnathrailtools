"""HR & Administration — visitor / gate management.

Owner: Agent D. Reception (the hr app) runs the board: check-in, check-out,
cancel, see everyone. Any logged-in employee may pre-register a visitor
with themself as host and see the visitors they host or registered."""
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.sequential_id import next_sequential_id
from app.db.session import get_db
from app.modules.hr.models.visitor import HrVisitor, VISITOR_STATUSES
from app.modules.hr.schemas.visitor import (
    HrVisitorCreate, HrVisitorUpdate, HrVisitorCheckInPayload, HrVisitorCheckOutPayload,
    HrVisitorCancelPayload, HrVisitorResponse, HrVisitorBoardResponse,
)
from app.modules.hr.services.access import is_hr, require_hr
from app.modules.hr.services.admin_common import (
    users_by_id, branches_by_id, display_name, require_active_user, require_branch, require_choice,
)
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.utils.notifications import notify_user

router = APIRouter(prefix="/hr/visitors", tags=["HR"])

# All plants are in India (no DST), so "today" on the board is an IST day.
IST = timezone(timedelta(hours=5, minutes=30))


def _day_window(d: date) -> tuple[datetime, datetime]:
    start = datetime.combine(d, time.min, tzinfo=IST)
    return start, start + timedelta(days=1)


def _last4(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = "".join(ch for ch in value if not ch.isspace())
    return cleaned[-4:] if cleaned else None


def _to_responses(db: Session, rows: list[HrVisitor]) -> list[HrVisitorResponse]:
    users = users_by_id(db, [x for v in rows for x in (v.host_user_id, v.created_by_id)])
    branches = branches_by_id(db, [v.branch_id for v in rows])
    out = []
    for v in rows:
        resp = HrVisitorResponse.model_validate(v)
        host = users.get(v.host_user_id)
        resp.host_name = display_name(host)
        resp.host_department = host.department if host else None
        resp.created_by_name = display_name(users.get(v.created_by_id))
        b = branches.get(v.branch_id)
        resp.branch_name = b.name if b else None
        out.append(resp)
    return out


def _get_visitor(db: Session, visitor_id: int) -> HrVisitor:
    v = db.query(HrVisitor).filter(HrVisitor.id == visitor_id).first()
    if not v:
        raise HTTPException(status_code=404, detail=f"Visitor entry #{visitor_id} was not found. Refresh the visitor list.")
    return v


def _is_own(user: User, v: HrVisitor) -> bool:
    return user.id in (v.host_user_id, v.created_by_id)


def _ensure_can_view(user: User, v: HrVisitor) -> None:
    if not (is_hr(user) or _is_own(user, v)):
        raise HTTPException(
            status_code=403,
            detail="You can only see visitors you host or registered. Reception (HR) can see every visitor.",
        )


def _status_word(s: str) -> str:
    return s.replace("_", " ")


# ── self-service ────────────────────────────────────────────────────────────

@router.get("/mine", response_model=list[HrVisitorResponse])
async def list_my_visitors(
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(HrVisitor).filter(or_(HrVisitor.host_user_id == user.id, HrVisitor.created_by_id == user.id))
    if status_filter:
        require_choice(status_filter, VISITOR_STATUSES, "visitor status")
        q = q.filter(HrVisitor.status == status_filter)
    rows = q.order_by(func.coalesce(HrVisitor.expected_at, HrVisitor.created_at).desc()).limit(200).all()
    return _to_responses(db, rows)


@router.post("", response_model=HrVisitorResponse, status_code=201)
async def create_visitor(
    payload: HrVisitorCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Pre-register a visitor. Non-HR users are always the host. Reception
    can pick any host and, for walk-ins, check the visitor in immediately."""
    hr = is_hr(user)
    if not hr and payload.host_user_id not in (None, user.id):
        raise HTTPException(
            status_code=403,
            detail="You can only pre-register visitors that you will host yourself. Ask reception (HR) to register a visitor for someone else.",
        )
    if not hr and payload.check_in_now:
        raise HTTPException(
            status_code=403,
            detail="Only reception (HR) can check a visitor in. Pre-register the visitor and reception will check them in at the gate.",
        )
    host_id = payload.host_user_id if hr and payload.host_user_id else user.id
    host = require_active_user(db, host_id, "host")
    require_branch(db, payload.branch_id)
    branch_id = payload.branch_id if payload.branch_id is not None else host.branch_id

    data = payload.model_dump(exclude={"host_user_id", "check_in_now", "branch_id", "badge_no", "id_proof_last4"})
    v = HrVisitor(
        visit_no=next_sequential_id(db, prefix=f"VIS-{date.today().year}-", column=HrVisitor.visit_no),
        host_user_id=host.id, branch_id=branch_id, created_by_id=user.id,
        id_proof_last4=_last4(payload.id_proof_last4), badge_no=payload.badge_no,
        status="expected", **data,
    )
    if payload.check_in_now:
        v.status = "checked_in"
        v.check_in_at = datetime.now(timezone.utc)
    db.add(v)
    db.flush()
    if payload.check_in_now:
        notify_user(
            db, host.id, "Your visitor has arrived",
            f"{v.visitor_name}{f' ({v.visitor_company})' if v.visitor_company else ''} has checked in at reception"
            f"{f' with badge {v.badge_no}' if v.badge_no else ''}.",
            "hr_visitor_checked_in", entity_type="hr_visitor", entity_id=v.id,
        )
    elif host.id != user.id:
        notify_user(
            db, host.id, "Visitor registered for you",
            f"Reception registered {v.visitor_name} to visit you" + (f" on {v.expected_at.astimezone(IST):%d-%m-%Y %H:%M}." if v.expected_at else "."),
            "hr_visitor_registered", entity_type="hr_visitor", entity_id=v.id,
        )
    db.commit()
    db.refresh(v)
    return _to_responses(db, [v])[0]


# ── reception (HR) ──────────────────────────────────────────────────────────

@router.get("/board", response_model=HrVisitorBoardResponse)
async def visitor_board(
    on_date: date | None = Query(None, alias="date"),
    branch_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    """Reception board for one day: expected today, everyone still inside
    (whatever day they came in), and those who left today."""
    d = on_date or datetime.now(IST).date()
    start, end = _day_window(d)
    base = db.query(HrVisitor)
    if branch_id:
        base = base.filter(HrVisitor.branch_id == branch_id)
    expected = base.filter(
        HrVisitor.status == "expected",
        or_(
            (HrVisitor.expected_at >= start) & (HrVisitor.expected_at < end),
            (HrVisitor.expected_at.is_(None)) & (HrVisitor.created_at >= start) & (HrVisitor.created_at < end),
        ),
    ).order_by(HrVisitor.expected_at.asc().nulls_last()).all()
    inside = base.filter(HrVisitor.status == "checked_in").order_by(HrVisitor.check_in_at.asc()).all()
    checked_out = base.filter(
        HrVisitor.status == "checked_out", HrVisitor.check_out_at >= start, HrVisitor.check_out_at < end,
    ).order_by(HrVisitor.check_out_at.desc()).all()
    return HrVisitorBoardResponse(
        date=d.isoformat(),
        expected=_to_responses(db, expected),
        inside=_to_responses(db, inside),
        checked_out=_to_responses(db, checked_out),
    )


@router.get("", response_model=list[HrVisitorResponse])
async def list_visitors(
    date_from: date | None = None,
    date_to: date | None = None,
    branch_id: int | None = None,
    host_user_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    limit: int = Query(300, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    when = func.coalesce(HrVisitor.check_in_at, HrVisitor.expected_at, HrVisitor.created_at)
    q = db.query(HrVisitor)
    if date_from:
        q = q.filter(when >= _day_window(date_from)[0])
    if date_to:
        q = q.filter(when < _day_window(date_to)[1])
    if branch_id:
        q = q.filter(HrVisitor.branch_id == branch_id)
    if host_user_id:
        q = q.filter(HrVisitor.host_user_id == host_user_id)
    if status_filter:
        require_choice(status_filter, VISITOR_STATUSES, "visitor status")
        q = q.filter(HrVisitor.status == status_filter)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(or_(
            HrVisitor.visit_no.ilike(term), HrVisitor.visitor_name.ilike(term), HrVisitor.visitor_company.ilike(term),
            HrVisitor.visitor_phone.ilike(term), HrVisitor.badge_no.ilike(term), HrVisitor.vehicle_no.ilike(term),
        ))
    rows = q.order_by(when.desc()).limit(limit).all()
    return _to_responses(db, rows)


@router.get("/{visitor_id}", response_model=HrVisitorResponse)
async def get_visitor(
    visitor_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    v = _get_visitor(db, visitor_id)
    _ensure_can_view(user, v)
    return _to_responses(db, [v])[0]


@router.patch("/{visitor_id}", response_model=HrVisitorResponse)
async def update_visitor(
    visitor_id: int,
    payload: HrVisitorUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    v = _get_visitor(db, visitor_id)
    hr = is_hr(user)
    if not hr:
        if not _is_own(user, v):
            raise HTTPException(status_code=403, detail="You can only edit visitors you host or registered. Ask reception (HR) to change this entry.")
        if v.status != "expected":
            raise HTTPException(
                status_code=409,
                detail=f"This visitor is already {_status_word(v.status)}, so only reception (HR) can change the entry now.",
            )
    if v.status in ("cancelled",):
        raise HTTPException(status_code=409, detail=f"{v.visit_no} is cancelled and cannot be edited. Pre-register the visitor again instead.")
    data = payload.model_dump(exclude_unset=True)
    if "host_user_id" in data:
        if data["host_user_id"] is None:
            raise HTTPException(status_code=400, detail="A visitor must have a host. Pick the employee they are visiting.")
        if not hr and data["host_user_id"] != v.host_user_id:
            raise HTTPException(status_code=403, detail="Only reception (HR) can change who hosts a visitor.")
        require_active_user(db, data["host_user_id"], "host")
    if "branch_id" in data:
        require_branch(db, data["branch_id"])
    if "id_proof_last4" in data:
        data["id_proof_last4"] = _last4(data["id_proof_last4"])
    if "visitor_name" in data and not (data["visitor_name"] or "").strip():
        raise HTTPException(status_code=400, detail="Visitor name cannot be blank. Enter the visitor's full name.")
    for k, val in data.items():
        setattr(v, k, val)
    db.commit()
    db.refresh(v)
    return _to_responses(db, [v])[0]


@router.post("/{visitor_id}/check-in", response_model=HrVisitorResponse)
async def check_in_visitor(
    visitor_id: int,
    payload: HrVisitorCheckInPayload,
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    v = _get_visitor(db, visitor_id)
    if v.status != "expected":
        raise HTTPException(
            status_code=409,
            detail=f"{v.visit_no} is already {_status_word(v.status)}, so it cannot be checked in. Only expected visitors can be checked in — register a new visit if they came back.",
        )
    v.status = "checked_in"
    v.check_in_at = payload.check_in_at or datetime.now(timezone.utc)
    if payload.badge_no is not None:
        v.badge_no = payload.badge_no or None
    if payload.id_proof_type is not None:
        v.id_proof_type = payload.id_proof_type or None
    if payload.id_proof_last4 is not None:
        v.id_proof_last4 = _last4(payload.id_proof_last4)
    if payload.vehicle_no is not None:
        v.vehicle_no = payload.vehicle_no or None
    if payload.items_carried is not None:
        v.items_carried = payload.items_carried or None
    notify_user(
        db, v.host_user_id, "Your visitor has arrived",
        f"{v.visitor_name}{f' ({v.visitor_company})' if v.visitor_company else ''} has checked in at reception"
        f"{f' with badge {v.badge_no}' if v.badge_no else ''}.",
        "hr_visitor_checked_in", entity_type="hr_visitor", entity_id=v.id,
    )
    db.commit()
    db.refresh(v)
    return _to_responses(db, [v])[0]


@router.post("/{visitor_id}/check-out", response_model=HrVisitorResponse)
async def check_out_visitor(
    visitor_id: int,
    payload: HrVisitorCheckOutPayload,
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    v = _get_visitor(db, visitor_id)
    if v.status != "checked_in":
        raise HTTPException(
            status_code=409,
            detail=f"{v.visit_no} is {_status_word(v.status)}, not inside the premises, so it cannot be checked out. Check the visitor in first.",
        )
    out_at = payload.check_out_at or datetime.now(timezone.utc)
    if v.check_in_at and out_at < v.check_in_at:
        raise HTTPException(
            status_code=400,
            detail=f"Check-out time is before the check-in time ({v.check_in_at.astimezone(IST):%d-%m-%Y %H:%M}). Enter a later time, or leave it blank to use now.",
        )
    v.status = "checked_out"
    v.check_out_at = out_at
    if payload.remarks:
        v.remarks = f"{v.remarks}\n{payload.remarks}" if v.remarks else payload.remarks
    db.commit()
    db.refresh(v)
    return _to_responses(db, [v])[0]


@router.post("/{visitor_id}/cancel", response_model=HrVisitorResponse)
async def cancel_visitor(
    visitor_id: int,
    payload: HrVisitorCancelPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    v = _get_visitor(db, visitor_id)
    if not (is_hr(user) or _is_own(user, v)):
        raise HTTPException(status_code=403, detail="You can only cancel visitors you host or registered. Ask reception (HR) to cancel this one.")
    if v.status != "expected":
        raise HTTPException(
            status_code=409,
            detail=f"{v.visit_no} is already {_status_word(v.status)}; only visits that have not started can be cancelled."
            + (" Check the visitor out instead." if v.status == "checked_in" else ""),
        )
    v.status = "cancelled"
    if payload.remarks:
        v.remarks = f"{v.remarks}\nCancelled: {payload.remarks}" if v.remarks else f"Cancelled: {payload.remarks}"
    if v.host_user_id != user.id:
        notify_user(
            db, v.host_user_id, "Visitor cancelled",
            f"The visit by {v.visitor_name} ({v.visit_no}) was cancelled" + (f": {payload.remarks}" if payload.remarks else "."),
            "hr_visitor_cancelled", entity_type="hr_visitor", entity_id=v.id,
        )
    db.commit()
    db.refresh(v)
    return _to_responses(db, [v])[0]

