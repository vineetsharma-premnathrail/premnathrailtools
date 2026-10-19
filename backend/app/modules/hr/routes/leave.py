"""HR & Administration — leave types, balances and requests.

Owner: Agent C. HR-management endpoints use `Depends(require_hr)`;
self-service endpoints use `Depends(get_current_user)` (see
app/modules/hr/services/access.py). Business rules live in
app/modules/hr/services/leave.py."""
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.config import settings
from app.core.sequential_id import next_sequential_id
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.hr.models.leave import HrLeaveBalance, HrLeaveRequest, HrLeaveType, LEAVE_REQUEST_STATUSES
from app.modules.hr.schemas.leave import (
    HrLeaveBalanceAdjustPayload,
    HrLeaveBalanceAllotPayload,
    HrLeaveBalanceResponse,
    HrLeaveDayPortion,
    HrLeaveRequestDecisionPayload,
    HrLeaveRequestPreviewPayload,
    HrLeaveRequestPreviewResponse,
    HrLeaveRequestResponse,
    HrLeaveTypeCreate,
    HrLeaveTypeResponse,
    HrLeaveTypeUpdate,
)
from app.core.data_scope import apply_scope
from app.core.permissions import ensure_tab_action, require_feature_action
from app.modules.hr.services import approvals as hr_approvals
from app.modules.hr.services import role_events
from app.modules.hr.services.access import (
    can_decide, can_hr, ensure_can_decide, ensure_self_or_hr, is_hr_for, require_hr_tab, require_me_view,
)
from app.modules.hr.services.calendar import CalendarCache, today_ist
from app.modules.hr.services.leave import (
    ZERO,
    allot_year,
    apply_leave_to_attendance,
    evaluate_application,
    fmt_date,
    fmt_days,
    get_or_create_balance,
    leave_attendance_conflicts,
    remove_leave_attendance,
    working_portions,
)
from app.modules.hr.services.lookup import department_names, profiles_by_user, user_department_name, users_by_id
from app.utils.notifications import notify_user
from app.utils.sharepoint import download_file_content, upload_file_to_sharepoint

router = APIRouter(prefix="/hr/leave", tags=["HR"])

# HR-team gate for this file: hr app + Permission Matrix › HR › leave.
require_hr = require_hr_tab("leave")
require_hr_leave_edit = require_hr_tab("leave", "edit")
# Leave › Allot & adjust balances feature (core/features/hr.py)
require_balance_allot = require_feature_action("hr", "leave", "balance_admin", "create")
require_balance_adjust = require_feature_action("hr", "leave", "balance_admin", "edit")
# Leave types live on the Masters tab.
require_hr_masters_create = require_hr_tab("masters", "create")
require_hr_masters_edit = require_hr_tab("masters", "edit")
# Read-only per-employee data also shown on Employees › profile › Leave.
require_hr_leave_read = require_hr_tab(("leave", "employees"))
# Who may open any leave request's detail/attachment as HR.
LEAVE_VIEW_TABS = ("leave", "approvals", "employees")

NOTIFY_TYPE = "hr_leave"
ENTITY = "hr_leave_request"


# ─────────────────────────────── Leave types ───────────────────────────────
@router.get("/types", response_model=list[HrLeaveTypeResponse])
async def list_leave_types(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    # Shared lookup inside HR (My HR apply form, Leave, Masters): the hr app
    # (router-level require_hr_module) is enough to read active types.
    user: User = Depends(get_current_user),
):
    q = db.query(HrLeaveType)
    if not (include_inactive and is_hr_for(user, ("leave", "masters"))):
        q = q.filter(HrLeaveType.is_active.is_(True))
    return q.order_by(HrLeaveType.sort_order.asc(), HrLeaveType.name.asc()).all()


def _check_type_rules(lt: HrLeaveType) -> None:
    if lt.carry_forward and Decimal(lt.max_carry_forward or 0) <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"{lt.name} is set to carry forward but the carry-forward cap is 0. Enter the most days that may carry into next year, or turn carry forward off.",
        )
    if not lt.is_paid and Decimal(lt.annual_quota or 0) > 0:
        raise HTTPException(
            status_code=400,
            detail=f"{lt.name} is unpaid, so it has no balance to allot. Set the annual quota to 0 or mark it as paid.",
        )


@router.post("/types", response_model=HrLeaveTypeResponse)
async def create_leave_type(payload: HrLeaveTypeCreate, db: Session = Depends(get_db), _user: User = Depends(require_hr_masters_create)):
    if db.query(HrLeaveType).filter(HrLeaveType.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Leave type code '{payload.code}' is already used. Pick a different code.")
    lt = HrLeaveType(**payload.model_dump())
    _check_type_rules(lt)
    db.add(lt)
    db.commit()
    db.refresh(lt)
    return lt


@router.patch("/types/{type_id}", response_model=HrLeaveTypeResponse)
async def update_leave_type(type_id: int, payload: HrLeaveTypeUpdate, db: Session = Depends(get_db), _user: User = Depends(require_hr_masters_edit)):
    lt = db.get(HrLeaveType, type_id)
    if not lt:
        raise HTTPException(status_code=404, detail=f"Leave type #{type_id} doesn't exist. Refresh the page — it may have been removed.")
    data = payload.model_dump(exclude_unset=True)
    if "code" in data and data["code"] and data["code"] != lt.code:
        if db.query(HrLeaveType).filter(HrLeaveType.code == data["code"], HrLeaveType.id != lt.id).first():
            raise HTTPException(status_code=409, detail=f"Leave type code '{data['code']}' is already used. Pick a different code.")
    for k, v in data.items():
        if k in ("code", "name", "annual_quota", "is_paid", "carry_forward", "max_carry_forward", "allow_half_day", "is_active", "sort_order") and v is None:
            continue
        setattr(lt, k, v)
    _check_type_rules(lt)
    db.commit()
    db.refresh(lt)
    return lt


# ─────────────────────────────── Balances ───────────────────────────────
def _balance_responses(db: Session, rows: list[HrLeaveBalance]) -> list[HrLeaveBalanceResponse]:
    users = users_by_id(db, [r.user_id for r in rows])
    profiles = profiles_by_user(db, [r.user_id for r in rows])
    depts = department_names(db)
    types = {t.id: t for t in db.query(HrLeaveType).all()}
    pend: dict[tuple[int, int, int], Decimal] = {}
    if rows:
        years = {r.year for r in rows}
        for req in db.query(HrLeaveRequest).filter(
            HrLeaveRequest.status == "pending", HrLeaveRequest.user_id.in_({r.user_id for r in rows})
        ).all():
            if req.from_date.year in years:
                key = (req.user_id, req.leave_type_id, req.from_date.year)
                pend[key] = pend.get(key, ZERO) + Decimal(req.days)
    out = []
    for r in rows:
        u, p, t = users.get(r.user_id), profiles.get(r.user_id), types.get(r.leave_type_id)
        out.append(HrLeaveBalanceResponse(
            id=r.id, user_id=r.user_id, leave_type_id=r.leave_type_id, year=r.year,
            opening=r.opening, allotted=r.allotted, adjusted=r.adjusted, used=r.used, available=r.available,
            pending=pend.get((r.user_id, r.leave_type_id, r.year), ZERO), updated_at=r.updated_at,
            user_name=u.name if u else None, user_email=u.email if u else None,
            employee_code=p.employee_code if p else None, department_name=user_department_name(u, p, depts),
            leave_type_code=t.code if t else None, leave_type_name=t.name if t else None, is_paid=t.is_paid if t else None,
        ))
    return out


@router.get("/balances/me", response_model=list[HrLeaveBalanceResponse])
async def my_balances(
    year: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_me_view),
):
    year = year or today_ist().year
    rows = db.query(HrLeaveBalance).filter(HrLeaveBalance.user_id == user.id, HrLeaveBalance.year == year).all()
    return _balance_responses(db, rows)


@router.get("/balances", response_model=list[HrLeaveBalanceResponse])
async def list_balances(
    year: int | None = Query(None),
    user_id: int | None = Query(None),
    leave_type_id: int | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr_leave_read),
):
    year = year or today_ist().year
    q = db.query(HrLeaveBalance).filter(HrLeaveBalance.year == year)
    scope = hr_approvals.employee_scope_filter(db, _user)  # HR data access
    if scope is not None:
        q = q.filter(HrLeaveBalance.user_id.in_(db.query(User.id).filter(scope)))
    if user_id:
        q = q.filter(HrLeaveBalance.user_id == user_id)
    if leave_type_id:
        q = q.filter(HrLeaveBalance.leave_type_id == leave_type_id)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.join(User, User.id == HrLeaveBalance.user_id).filter(or_(User.name.ilike(term), User.email.ilike(term)))
    rows = q.all()
    res = _balance_responses(db, rows)
    res.sort(key=lambda r: ((r.user_name or "").lower(), r.leave_type_code or ""))
    return res


@router.post("/balances/allot")
async def allot_balances(payload: HrLeaveBalanceAllotPayload, db: Session = Depends(get_db), user: User = Depends(require_balance_allot)):
    summary = allot_year(db, payload.year, user, payload.leave_type_ids, payload.prorate_joiners)
    record_audit(
        db, entity_type="hr_leave_balance", entity_id=None, action="allotted", module_key="hr",
        summary=f"Allotted {payload.year} leave ({', '.join(summary['leave_types'])}): {summary['created']} created, {summary['updated']} updated",
        new_value=summary, user_id=user.id,
    )
    db.commit()
    return summary


@router.post("/balances/adjust", response_model=HrLeaveBalanceResponse)
async def adjust_balance(payload: HrLeaveBalanceAdjustPayload, db: Session = Depends(get_db), user: User = Depends(require_balance_adjust)):
    target = db.get(User, payload.user_id)
    if not target:
        raise HTTPException(status_code=404, detail=f"User #{payload.user_id} doesn't exist. Pick the employee again from the list.")
    if target.id == user.id:
        raise HTTPException(
            status_code=403,
            detail="You can't adjust your own leave balance. Ask another HR user to make the adjustment for you.",
        )
    hr_approvals.ensure_employee_in_scope(db, user, target)  # HR data access
    lt = db.get(HrLeaveType, payload.leave_type_id)
    if not lt:
        raise HTTPException(status_code=404, detail=f"Leave type #{payload.leave_type_id} doesn't exist. Pick a leave type from the list.")
    bal = get_or_create_balance(db, target.id, lt.id, payload.year, user.id, lock=True)
    before = {"adjusted": str(bal.adjusted), "available": str(bal.available)}
    new_adjusted = Decimal(bal.adjusted) + payload.delta
    new_available = Decimal(bal.opening) + Decimal(bal.allotted) + new_adjusted - Decimal(bal.used)
    if new_available < 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{target.name}'s {lt.name} balance for {payload.year} is {fmt_days(bal.available)}; deducting "
                f"{fmt_days(abs(payload.delta))} would make it negative. Deduct at most {fmt_days(bal.available)}."
            ),
        )
    bal.adjusted = new_adjusted
    bal.updated_by_id = user.id
    db.flush()
    record_audit(
        db, entity_type="hr_leave_balance", entity_id=bal.id, action="adjusted", module_key="hr",
        summary=f"{'+' if payload.delta > 0 else ''}{payload.delta} {lt.code} for {target.name} ({payload.year}): {payload.reason}",
        old_value=before, new_value={"adjusted": str(bal.adjusted), "available": str(bal.available), "delta": str(payload.delta), "reason": payload.reason},
        user_id=user.id,
    )
    notify_user(
        db, target.id, "Leave balance adjusted",
        f"HR {'added' if payload.delta > 0 else 'deducted'} {fmt_days(abs(payload.delta))} of {lt.name} for {payload.year}. Reason: {payload.reason}",
        NOTIFY_TYPE, "hr_leave_balance", bal.id,
    )
    db.commit()
    db.refresh(bal)
    return _balance_responses(db, [bal])[0]


# ─────────────────────────────── Requests ───────────────────────────────
def _may_cancel(user: User, req: HrLeaveRequest) -> bool:
    """Own request: withdrawing it is hr:me:edit (not a delete). Someone
    else's: HR with hr:leave:edit."""
    return can_hr(user, "me", "edit") if user.id == req.user_id else can_hr(user, "leave", "edit")


def _can_cancel(user: User, req: HrLeaveRequest) -> bool:
    if req.status == "pending":
        return _may_cancel(user, req)
    if req.status == "approved" and req.from_date > today_ist():
        return _may_cancel(user, req)
    return False


def _can_decide(db: Session, viewer: User, r: HrLeaveRequest, areqs: dict) -> bool:
    """Engine-routed requests: whoever the engine lets act now. Requests from
    before the cut-over (no engine request): the legacy access.can_decide."""
    if r.status != "pending":
        return False
    if r.id in areqs:
        return hr_approvals.can_decide_engine(db, viewer, areqs[r.id])
    return can_decide(viewer, r.approver_id, r.user_id, "approve", ("leave",))


def _request_responses(db: Session, rows: list[HrLeaveRequest], viewer: User) -> list[HrLeaveRequestResponse]:
    ids = [r.user_id for r in rows] + [r.approver_id for r in rows] + [r.decided_by_id for r in rows]
    areqs = hr_approvals.latest_by_entity(db, ENTITY, [r.id for r in rows])
    users = users_by_id(db, ids)
    profiles = profiles_by_user(db, [r.user_id for r in rows])
    depts = department_names(db)
    types = {t.id: t for t in db.query(HrLeaveType).all()}
    out = []
    for r in rows:
        u, p, t = users.get(r.user_id), profiles.get(r.user_id), types.get(r.leave_type_id)
        a, d = users.get(r.approver_id or 0), users.get(r.decided_by_id or 0)
        resp = HrLeaveRequestResponse.model_validate(r).model_copy(update={
            "user_name": u.name if u else None, "user_email": u.email if u else None,
            "employee_code": p.employee_code if p else None, "department_name": user_department_name(u, p, depts),
            "leave_type_code": t.code if t else None, "leave_type_name": t.name if t else None,
            "approver_name": a.name if a else None, "decided_by_name": d.name if d else None,
            "attachment_name": r.attachment_path.rsplit("/", 1)[-1] if r.attachment_path else None,
            "can_decide": _can_decide(db, viewer, r, areqs),
            "can_cancel": _can_cancel(viewer, r),
            "approval_request_id": areqs[r.id].id if r.id in areqs else None,
        })
        out.append(resp)
    return out


def _load_request(db: Session, request_id: int, lock: bool = False) -> HrLeaveRequest:
    """`lock=True` for approve/reject/cancel: SELECT ... FOR UPDATE so two
    people acting on the same request at once are serialised and the second
    sees the first one's status (no double balance deduction)."""
    if lock:
        req = db.query(HrLeaveRequest).filter(HrLeaveRequest.id == request_id).with_for_update().populate_existing().first()
    else:
        req = db.get(HrLeaveRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail=f"Leave request #{request_id} doesn't exist. Refresh the list — it may have been removed.")
    return req


def _ensure_can_view(db: Session, user: User, req: HrLeaveRequest) -> None:
    if user.id in (req.user_id, req.approver_id):
        return
    if is_hr_for(user, LEAVE_VIEW_TABS):
        hr_approvals.ensure_scope_unless_party(db, user, req, req.user_id, req.approver_id)
        return
    if hr_approvals.can_decide_engine(db, user, hr_approvals.open_request(db, ENTITY, req.id)):
        return  # an engine approver / delegate / escalation target of this request
    raise HTTPException(
        status_code=403,
        detail="You can only view your own leave requests or ones waiting for your approval. Ask HR if you need access to this one.",
    )


def _apply_filters(q, status, user_id, leave_type_id, date_from, date_to):
    if status:
        if status not in LEAVE_REQUEST_STATUSES:
            raise HTTPException(status_code=400, detail=f"Unknown status '{status}'. Use one of: {', '.join(LEAVE_REQUEST_STATUSES)}.")
        q = q.filter(HrLeaveRequest.status == status)
    if user_id:
        q = q.filter(HrLeaveRequest.user_id == user_id)
    if leave_type_id:
        q = q.filter(HrLeaveRequest.leave_type_id == leave_type_id)
    if date_from:
        q = q.filter(HrLeaveRequest.to_date >= date_from)
    if date_to:
        q = q.filter(HrLeaveRequest.from_date <= date_to)
    return q


@router.get("/requests/me", response_model=list[HrLeaveRequestResponse])
async def my_requests(
    status: str | None = Query(None),
    year: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_me_view),
):
    q = _apply_filters(db.query(HrLeaveRequest).filter(HrLeaveRequest.user_id == user.id), status, None, None, None, None)
    if year:
        q = q.filter(HrLeaveRequest.from_date >= date(year, 1, 1), HrLeaveRequest.from_date <= date(year, 12, 31))
    rows = q.order_by(HrLeaveRequest.from_date.desc(), HrLeaveRequest.id.desc()).limit(500).all()
    return _request_responses(db, rows, user)


@router.get("/requests/pending-for-me", response_model=list[HrLeaveRequestResponse])
async def pending_for_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Engine-routed requests: the engine's inbox (approver / delegate /
    # escalation target). Pre-engine requests: the captured approver, plus HR
    # for requests with no approver.
    if is_hr_for(user, "approvals"):
        legacy = or_(HrLeaveRequest.approver_id == user.id, HrLeaveRequest.approver_id.is_(None))
    else:
        legacy = HrLeaveRequest.approver_id == user.id
    legacy = and_(legacy, HrLeaveRequest.id.notin_(hr_approvals.engine_tracked_ids(ENTITY)))
    engine_ids = hr_approvals.inbox_ids(db, user, ENTITY)
    q = db.query(HrLeaveRequest).filter(HrLeaveRequest.status == "pending", HrLeaveRequest.user_id != user.id)
    q = q.filter(or_(legacy, HrLeaveRequest.id.in_(engine_ids)) if engine_ids else legacy)
    rows = q.order_by(HrLeaveRequest.from_date.asc()).all()
    return _request_responses(db, rows, user)


@router.get("/requests", response_model=list[HrLeaveRequestResponse])
async def list_requests(
    status: str | None = Query(None),
    user_id: int | None = Query(None),
    leave_type_id: int | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    user: User = Depends(require_hr_leave_read),
):
    q = _apply_filters(apply_scope(db.query(HrLeaveRequest), user, HrLeaveRequest), status, user_id, leave_type_id, date_from, date_to)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.join(User, User.id == HrLeaveRequest.user_id).filter(
            or_(User.name.ilike(term), User.email.ilike(term), HrLeaveRequest.request_no.ilike(term))
        )
    rows = q.order_by(HrLeaveRequest.from_date.desc(), HrLeaveRequest.id.desc()).limit(limit).all()
    return _request_responses(db, rows, user)


def _resolve_applicant(db: Session, user: User, user_id: int | None) -> User:
    """Applying for yourself is self-service (hr:me:create — NOT
    hr:leave:create); applying on someone else's behalf is HR work
    (hr:leave:create)."""
    if not user_id or user_id == user.id:
        ensure_tab_action(user, "hr", "me", "create")
        return user
    if not can_hr(user, "leave", "create"):
        raise HTTPException(status_code=403, detail="Only HR with 'Create' permission on HR & Administration › Leave can apply leave on behalf of another employee. Apply for yourself, or ask an admin to add that permission to one of your roles in Organization › Role & Permissions.")
    target = db.get(User, user_id)
    if not target or not target.is_active:
        raise HTTPException(status_code=404, detail=f"Employee #{user_id} doesn't exist or is inactive. Pick the employee again from the list.")
    hr_approvals.ensure_employee_in_scope(db, user, target)  # HR data access
    return target


@router.post("/requests/preview", response_model=HrLeaveRequestPreviewResponse)
async def preview_request(payload: HrLeaveRequestPreviewPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    applicant = _resolve_applicant(db, user, payload.user_id)
    cache = CalendarCache(db)
    ctx = cache.context(applicant)
    lt = db.get(HrLeaveType, payload.leave_type_id)
    ev = evaluate_application(
        db, cache, ctx, lt, payload.from_date, payload.to_date, payload.from_session, payload.to_session,
        has_attachment=payload.has_attachment,
    )
    approver = db.get(User, applicant.reporting_manager_id) if applicant.reporting_manager_id else None
    return HrLeaveRequestPreviewResponse(
        days=ev.days,
        breakdown=[HrLeaveDayPortion(date=p.date, kind=p.kind, portion=p.portion, holiday_name=p.holiday_name) for p in ev.breakdown],
        errors=ev.errors, warnings=ev.warnings, document_required=ev.document_required,
        balance_checked=ev.balance_checked, balance_available=ev.balance_available, balance_pending=ev.balance_pending,
        approver_id=approver.id if approver else None, approver_name=approver.name if approver else None,
    )


async def _store_attachment(req: HrLeaveRequest, file: UploadFile) -> None:
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(
            status_code=503,
            detail="Attachments can't be stored because SharePoint isn't configured on the server (SHAREPOINT_SITE_ID is empty). Ask IT to configure it, or submit without the attachment if it isn't mandatory.",
        )
    folder = f"{settings.SHAREPOINT_FOLDER}/hr/leave/{req.id}"
    try:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, file)
    except HTTPException:
        raise
    except Exception as exc:  # network / Graph errors
        raise HTTPException(
            status_code=502,
            detail=f"Uploading '{file.filename}' to SharePoint failed ({exc}). Nothing was saved — try again in a minute, or ask IT to check the SharePoint connection.",
        )
    req.attachment_path = result.get("path")
    req.attachment_url = result.get("webUrl")


@router.post("/requests", response_model=HrLeaveRequestResponse)
async def apply_leave(
    leave_type_id: int = Form(...),
    from_date: date = Form(...),
    to_date: date = Form(...),
    from_session: str = Form("full"),
    to_session: str = Form("full"),
    reason: str | None = Form(None),
    contact_during_leave: str | None = Form(None),
    user_id: int | None = Form(None),
    attachment: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    background_tasks: BackgroundTasks = None,
):
    applicant = _resolve_applicant(db, user, user_id)
    if attachment is not None and not attachment.filename:
        attachment = None
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason for the leave so your approver can decide. Add a short reason and submit again.")
    cache = CalendarCache(db)
    ctx = cache.context(applicant)
    lt = db.get(HrLeaveType, leave_type_id)
    ev = evaluate_application(db, cache, ctx, lt, from_date, to_date, from_session, to_session, has_attachment=attachment is not None)
    if ev.errors:
        raise HTTPException(status_code=400, detail=" ".join(ev.errors))

    req = HrLeaveRequest(
        request_no=next_sequential_id(db, prefix=f"LV-{today_ist().year}-", column=HrLeaveRequest.request_no),
        user_id=applicant.id, leave_type_id=lt.id, from_date=from_date, to_date=to_date,
        # Single day: store the one session count_leave_days used (from_session
        # unless it is 'full', then to_session) so approval recounts the same days.
        from_session=from_session if from_date != to_date or from_session != "full" else to_session,
        to_session=to_session if from_date != to_date else (from_session if from_session != "full" else to_session),
        days=ev.days, reason=reason.strip(), contact_during_leave=(contact_during_leave or "").strip() or None,
        status="pending", approver_id=applicant.reporting_manager_id,
    )
    db.add(req)
    db.flush()
    # Route through Organization › Approval Workflows (default: reporting
    # manager + HR approvers). The engine notifies the approvers, and refuses
    # with the exact reason when nobody can approve — before any upload.
    appr = hr_approvals.submit(
        db, hr_approvals.LEAVE_KEY, entity_id=req.id, requester=applicant,
        title=f"{lt.name} — {applicant.name}, {fmt_days(ev.days)} from {fmt_date(from_date)}", reference=req.request_no,
        context={"days": float(ev.days), "leave_type": lt.code, "is_paid": bool(lt.is_paid)},
    )
    if attachment is not None:
        try:
            await _store_attachment(req, attachment)
        except HTTPException:
            db.rollback()
            raise
    msg = f"{applicant.name} applied for {fmt_days(ev.days)} of {lt.name} ({fmt_date(from_date)} to {fmt_date(to_date)}), {req.request_no}."
    if applicant.id != user.id:
        notify_user(db, applicant.id, "Leave applied on your behalf", f"{user.name} applied {req.request_no} for you. {msg}", NOTIFY_TYPE, ENTITY, req.id)
    # Role event (core/events/hr.py) for HR approvers who opted in; the
    # engine already pinged the routed approvers.
    role_events.fire(
        db, background_tasks, "leave_submitted", title=f"Leave waiting for approval — {req.request_no}",
        message=f"{msg} Reason: {req.reason}. Approve or reject it under HR › Approvals.",
        entity_type=ENTITY, entity_id=req.id, actor=user, can_open=role_events.employee_opener(db, applicant),
        skip={applicant.id} | role_events.approver_ids(appr),
    )
    db.commit()
    db.refresh(req)
    return _request_responses(db, [req], user)[0]


@router.get("/requests/{request_id}", response_model=HrLeaveRequestResponse)
async def get_request(request_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = _load_request(db, request_id)
    _ensure_can_view(db, user, req)
    return _request_responses(db, [req], user)[0]


@router.post("/requests/{request_id}/attachment", response_model=HrLeaveRequestResponse)
async def upload_request_attachment(
    request_id: int,
    attachment: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    req = _load_request(db, request_id)
    if user.id != req.user_id and not is_hr_for(user, "leave"):
        raise HTTPException(status_code=403, detail="Only the employee who applied, or HR with access to HR & Administration › Leave, can attach documents to this leave request.")
    ensure_self_or_hr(user, req.user_id, "edit", "leave", "edit")
    hr_approvals.ensure_scope_unless_party(db, user, req, req.user_id)  # HR acting on someone else's: data access
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"{req.request_no} is already {req.status}, so its attachment can't be changed. Ask HR if a document must be added.")
    await _store_attachment(req, attachment)
    db.commit()
    db.refresh(req)
    return _request_responses(db, [req], user)[0]


@router.get("/requests/{request_id}/attachment")
async def download_request_attachment(request_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = _load_request(db, request_id)
    _ensure_can_view(db, user, req)
    if not req.attachment_path:
        raise HTTPException(status_code=404, detail=f"{req.request_no} has no attachment.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint isn't configured on the server (SHAREPOINT_SITE_ID is empty), so the attachment can't be fetched. Ask IT to configure it.")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, req.attachment_path)
    filename = req.attachment_path.rsplit("/", 1)[-1].replace('"', "")
    return Response(content=content, media_type=content_type, headers={"Content-Disposition": f'inline; filename="{filename}"'})


def _pending_or_400(req: HrLeaveRequest, verb: str) -> None:
    if req.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"{req.request_no} is already {req.status}, so it can't be {verb}. Refresh the page to see its latest status.",
        )


def _approve_pending(db: Session, req: HrLeaveRequest, user: User, remarks: str | None, notify: bool = True) -> None:
    """Approve a pending leave: recount, check the balance and attendance,
    deduct, mark the days on leave. Used by the engine's on_decided and by the
    legacy path for requests submitted before the engine cut-over."""
    _pending_or_400(req, "approved")
    lt = db.get(HrLeaveType, req.leave_type_id)
    applicant = db.get(User, req.user_id)
    cache = CalendarCache(db)
    ctx = cache.context(applicant)
    # Recount against today's calendar — HR may have added a holiday since.
    ev = evaluate_application(
        db, cache, ctx, lt, req.from_date, req.to_date, req.from_session, req.to_session,
        has_attachment=bool(req.attachment_path), exclude_request_id=req.id,
    )
    # Only balance problems block approval; other rules were checked at apply time.
    bal = get_or_create_balance(db, req.user_id, lt.id, req.from_date.year, user.id, lock=True)
    if lt.is_paid:
        if Decimal(bal.available) < ev.days:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{applicant.name}'s {lt.name} balance is now {fmt_days(bal.available)} but this leave needs "
                    f"{fmt_days(ev.days)}. Reject it and ask them to re-apply for fewer days (or as Leave Without Pay), "
                    "or ask HR to adjust the balance first."
                ),
            )
    if ev.days <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Every date in {req.request_no} is now a weekly off or holiday, so there is nothing to approve. Reject it with that reason.",
        )
    clashes = leave_attendance_conflicts(db, req, working_portions(ev.breakdown))
    if clashes:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{applicant.name}'s attendance already shows {', '.join(clashes)}, so approving {req.request_no} would "
                "overwrite days they were working. If those entries are wrong, ask HR to clear them in HR > Attendance and "
                "approve again; otherwise reject and ask them to re-apply without those dates."
            ),
        )
    req.days = ev.days
    bal.used = Decimal(bal.used) + ev.days
    bal.updated_by_id = user.id
    req.status = "approved"
    req.decided_by_id = user.id
    req.decided_at = datetime.now(timezone.utc)
    req.decision_remarks = (remarks or "").strip() or None
    apply_leave_to_attendance(db, req, lt, working_portions(ev.breakdown), user.id)
    record_audit(
        db, entity_type=ENTITY, entity_id=req.id, action="approved", module_key="hr",
        summary=f"Approved {req.request_no} ({fmt_days(req.days)} {lt.code}) for {applicant.name}" + (f": {req.decision_remarks}" if req.decision_remarks else ""),
        user_id=user.id,
    )
    if notify:
        notify_user(
            db, req.user_id, "Leave approved",
            f"{user.name} approved your {lt.name} {req.request_no} ({fmt_date(req.from_date)} to {fmt_date(req.to_date)}, {fmt_days(req.days)})."
            + (f" Remarks: {req.decision_remarks}" if req.decision_remarks else ""),
            NOTIFY_TYPE, ENTITY, req.id,
        )


def _reject_pending(db: Session, req: HrLeaveRequest, user: User, remarks: str, notify: bool = True, returned: bool = False) -> None:
    _pending_or_400(req, "rejected")
    req.status = "rejected"
    req.decided_by_id = user.id
    req.decided_at = datetime.now(timezone.utc)
    # Leave has no draft to edit: "returned for changes" ends it like a
    # rejection, and the employee applies again.
    req.decision_remarks = f"Returned for changes: {remarks}" if returned else remarks
    lt = db.get(HrLeaveType, req.leave_type_id)
    record_audit(
        db, entity_type=ENTITY, entity_id=req.id, action="rejected", module_key="hr",
        summary=f"{'Returned' if returned else 'Rejected'} {req.request_no}: {remarks}", user_id=user.id,
    )
    if notify:
        notify_user(
            db, req.user_id, "Leave rejected",
            f"{user.name} rejected your {lt.name if lt else 'leave'} {req.request_no}. Reason: {remarks}",
            NOTIFY_TYPE, ENTITY, req.id,
        )


def _on_leave_decided(db: Session, areq, outcome: str, actor: User) -> None:
    """Approval engine callback (hr.leave). The engine has already notified
    the employee, so no second notification here."""
    req = _load_request(db, areq.entity_id, lock=True)
    comment = hr_approvals.decision_comment(areq, actor)
    if outcome == "approved":
        _approve_pending(db, req, actor, comment, notify=False)
    elif outcome in ("rejected", "returned"):
        _reject_pending(db, req, actor, comment or "", notify=False, returned=outcome == "returned")
    elif outcome == "cancelled" and req.status == "pending":
        req.status = "cancelled"
        req.cancelled_at = datetime.now(timezone.utc)


hr_approvals.register_hr_type(
    hr_approvals.LEAVE_KEY, "leave", "Leave request", ENTITY, "/dashboard/hr/approvals", _on_leave_decided,
    description="Employee leave (HR › Leave). Approving deducts the balance and marks the days on leave.",
    context_fields={
        "days": {"label": "Days", "type": "number"},
        "leave_type": {"label": "Leave type code", "type": "text"},
        "is_paid": {"label": "Paid leave", "type": "bool"},
    },
)


@router.post("/requests/{request_id}/approve", response_model=HrLeaveRequestResponse)
async def approve_request(
    request_id: int,
    payload: HrLeaveRequestDecisionPayload | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    req = _load_request(db, request_id, lock=True)
    remarks = ((payload.remarks or "").strip() or None) if payload else None
    # Engine-routed: the engine decides who may act (manager, HR approvers,
    # delegates, escalation, admin stand-in) and calls _on_leave_decided.
    if not hr_approvals.decide(db, ENTITY, req.id, user, True, remarks, what="leave request", record_pending=req.status == "pending"):
        # Pre-engine request: routed approver passes on routing alone; anyone
        # else needs hr:approvals:approve or hr:leave:approve.
        ensure_can_decide(user, req.approver_id, req.user_id, "leave request", "approve", ("leave",))
        hr_approvals.ensure_scope_unless_party(db, user, req, req.user_id, req.approver_id)  # HR deciders: data access
        _approve_pending(db, req, user, remarks)
    db.commit()
    db.refresh(req)
    return _request_responses(db, [req], user)[0]


@router.post("/requests/{request_id}/reject", response_model=HrLeaveRequestResponse)
async def reject_request(
    request_id: int,
    payload: HrLeaveRequestDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    req = _load_request(db, request_id, lock=True)
    remarks = (payload.remarks or "").strip()
    if not remarks:
        raise HTTPException(status_code=400, detail="Give a reason for rejecting so the employee knows what to change. Add remarks and try again.")
    if not hr_approvals.decide(db, ENTITY, req.id, user, False, remarks, what="leave request", record_pending=req.status == "pending"):
        ensure_can_decide(user, req.approver_id, req.user_id, "leave request", "reject", ("leave",))
        hr_approvals.ensure_scope_unless_party(db, user, req, req.user_id, req.approver_id)  # HR deciders: data access
        _reject_pending(db, req, user, remarks)
    db.commit()
    db.refresh(req)
    return _request_responses(db, [req], user)[0]


@router.post("/requests/{request_id}/cancel", response_model=HrLeaveRequestResponse)
async def cancel_request(
    request_id: int,
    payload: HrLeaveRequestDecisionPayload | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    req = _load_request(db, request_id, lock=True)
    if user.id != req.user_id and not is_hr_for(user, "leave"):
        raise HTTPException(status_code=403, detail="Only the employee who applied, or HR with access to HR & Administration › Leave, can cancel this leave request. Ask HR or an admin to grant the Leave tab in Users › Permission Matrix.")
    # Withdrawing your own request = hr:me:edit (not delete); HR cancelling
    # someone else's = hr:leave:edit.
    ensure_self_or_hr(user, req.user_id, "edit", "leave", "edit")
    hr_approvals.ensure_scope_unless_party(db, user, req, req.user_id)
    if req.status in ("rejected", "cancelled"):
        raise HTTPException(status_code=400, detail=f"{req.request_no} is already {req.status}; there is nothing to cancel.")
    if req.status == "pending":
        # Close the live approval so it leaves every approver's inbox.
        hr_approvals.withdraw(db, ENTITY, req.id, user, (payload.remarks or "").strip() or None if payload else None)
    lt = db.get(HrLeaveType, req.leave_type_id)
    was_approved = req.status == "approved"
    if was_approved:
        if req.from_date <= today_ist():
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{req.request_no} started on {fmt_date(req.from_date)}, so it can no longer be cancelled here. "
                    "Ask HR to correct your attendance and adjust your leave balance."
                ),
            )
        bal = get_or_create_balance(db, req.user_id, req.leave_type_id, req.from_date.year, user.id, lock=True)
        bal.used = max(ZERO, Decimal(bal.used) - Decimal(req.days))
        bal.updated_by_id = user.id
        remove_leave_attendance(db, req)
    req.status = "cancelled"
    req.cancelled_at = datetime.now(timezone.utc)
    note = (payload.remarks or "").strip() if payload and payload.remarks else ""
    record_audit(
        db, entity_type=ENTITY, entity_id=req.id, action="cancelled", module_key="hr",
        summary=f"Cancelled {req.request_no}" + (" (balance restored)" if was_approved else "") + (f": {note}" if note else ""),
        user_id=user.id,
    )
    applicant = db.get(User, req.user_id)
    label = lt.name if lt else "leave"
    if user.id == req.user_id:
        target = req.decided_by_id if was_approved else req.approver_id
        if target and target != user.id:
            notify_user(db, target, "Leave cancelled", f"{applicant.name} cancelled {label} {req.request_no} ({fmt_date(req.from_date)} to {fmt_date(req.to_date)}).", NOTIFY_TYPE, ENTITY, req.id)
    else:
        notify_user(db, req.user_id, "Leave cancelled by HR", f"{user.name} cancelled your {label} {req.request_no}." + (f" Reason: {note}" if note else ""), NOTIFY_TYPE, ENTITY, req.id)
    db.commit()
    db.refresh(req)
    return _request_responses(db, [req], user)[0]
