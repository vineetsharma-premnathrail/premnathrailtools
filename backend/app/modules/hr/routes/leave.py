"""HR & Administration — leave types, balances and requests.

Owner: Agent C. HR-management endpoints use `Depends(require_hr)`;
self-service endpoints use `Depends(get_current_user)` (see
app/modules/hr/services/access.py). Business rules live in
app/modules/hr/services/leave.py."""
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy import or_
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
from app.modules.hr.services.access import can_decide, ensure_can_decide, is_hr, require_hr
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

NOTIFY_TYPE = "hr_leave"
ENTITY = "hr_leave_request"


# ─────────────────────────────── Leave types ───────────────────────────────
@router.get("/types", response_model=list[HrLeaveTypeResponse])
async def list_leave_types(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(HrLeaveType)
    if not (include_inactive and is_hr(user)):
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
async def create_leave_type(payload: HrLeaveTypeCreate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    if db.query(HrLeaveType).filter(HrLeaveType.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Leave type code '{payload.code}' is already used. Pick a different code.")
    lt = HrLeaveType(**payload.model_dump())
    _check_type_rules(lt)
    db.add(lt)
    db.commit()
    db.refresh(lt)
    return lt


@router.patch("/types/{type_id}", response_model=HrLeaveTypeResponse)
async def update_leave_type(type_id: int, payload: HrLeaveTypeUpdate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
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
    user: User = Depends(get_current_user),
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
    _user: User = Depends(require_hr),
):
    year = year or today_ist().year
    q = db.query(HrLeaveBalance).filter(HrLeaveBalance.year == year)
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
async def allot_balances(payload: HrLeaveBalanceAllotPayload, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    summary = allot_year(db, payload.year, user, payload.leave_type_ids, payload.prorate_joiners)
    record_audit(
        db, entity_type="hr_leave_balance", entity_id=None, action="allotted", module_key="hr",
        summary=f"Allotted {payload.year} leave ({', '.join(summary['leave_types'])}): {summary['created']} created, {summary['updated']} updated",
        new_value=summary, user_id=user.id,
    )
    db.commit()
    return summary


@router.post("/balances/adjust", response_model=HrLeaveBalanceResponse)
async def adjust_balance(payload: HrLeaveBalanceAdjustPayload, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    target = db.get(User, payload.user_id)
    if not target:
        raise HTTPException(status_code=404, detail=f"User #{payload.user_id} doesn't exist. Pick the employee again from the list.")
    if target.id == user.id:
        raise HTTPException(
            status_code=403,
            detail="You can't adjust your own leave balance. Ask another HR user to make the adjustment for you.",
        )
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
def _can_cancel(user: User, req: HrLeaveRequest) -> bool:
    if req.status == "pending":
        return user.id == req.user_id or is_hr(user)
    if req.status == "approved" and req.from_date > today_ist():
        return user.id == req.user_id or is_hr(user)
    return False


def _request_responses(db: Session, rows: list[HrLeaveRequest], viewer: User) -> list[HrLeaveRequestResponse]:
    ids = [r.user_id for r in rows] + [r.approver_id for r in rows] + [r.decided_by_id for r in rows]
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
            "can_decide": r.status == "pending" and can_decide(viewer, r.approver_id, r.user_id),
            "can_cancel": _can_cancel(viewer, r),
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


def _ensure_can_view(user: User, req: HrLeaveRequest) -> None:
    if user.id in (req.user_id, req.approver_id) or is_hr(user):
        return
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
    user: User = Depends(get_current_user),
):
    q = _apply_filters(db.query(HrLeaveRequest).filter(HrLeaveRequest.user_id == user.id), status, None, None, None, None)
    if year:
        q = q.filter(HrLeaveRequest.from_date >= date(year, 1, 1), HrLeaveRequest.from_date <= date(year, 12, 31))
    rows = q.order_by(HrLeaveRequest.from_date.desc(), HrLeaveRequest.id.desc()).limit(500).all()
    return _request_responses(db, rows, user)


@router.get("/requests/pending-for-me", response_model=list[HrLeaveRequestResponse])
async def pending_for_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(HrLeaveRequest).filter(HrLeaveRequest.status == "pending", HrLeaveRequest.user_id != user.id)
    if is_hr(user):
        q = q.filter(or_(HrLeaveRequest.approver_id == user.id, HrLeaveRequest.approver_id.is_(None)))
    else:
        q = q.filter(HrLeaveRequest.approver_id == user.id)
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
    user: User = Depends(require_hr),
):
    q = _apply_filters(db.query(HrLeaveRequest), status, user_id, leave_type_id, date_from, date_to)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.join(User, User.id == HrLeaveRequest.user_id).filter(
            or_(User.name.ilike(term), User.email.ilike(term), HrLeaveRequest.request_no.ilike(term))
        )
    rows = q.order_by(HrLeaveRequest.from_date.desc(), HrLeaveRequest.id.desc()).limit(limit).all()
    return _request_responses(db, rows, user)


def _resolve_applicant(db: Session, user: User, user_id: int | None) -> User:
    if not user_id or user_id == user.id:
        return user
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="Only HR can apply leave on behalf of another employee. Apply for yourself, or ask HR.")
    target = db.get(User, user_id)
    if not target or not target.is_active:
        raise HTTPException(status_code=404, detail=f"Employee #{user_id} doesn't exist or is inactive. Pick the employee again from the list.")
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
        from_session=from_session, to_session=to_session if from_date != to_date else from_session,
        days=ev.days, reason=reason.strip(), contact_during_leave=(contact_during_leave or "").strip() or None,
        status="pending", approver_id=applicant.reporting_manager_id,
    )
    db.add(req)
    db.flush()
    if attachment is not None:
        try:
            await _store_attachment(req, attachment)
        except HTTPException:
            db.rollback()
            raise
    msg = f"{applicant.name} applied for {fmt_days(ev.days)} of {lt.name} ({fmt_date(from_date)} to {fmt_date(to_date)}), {req.request_no}."
    if req.approver_id:
        notify_user(db, req.approver_id, "Leave request waiting for you", msg, NOTIFY_TYPE, ENTITY, req.id)
    if applicant.id != user.id:
        notify_user(db, applicant.id, "Leave applied on your behalf", f"{user.name} applied {req.request_no} for you. {msg}", NOTIFY_TYPE, ENTITY, req.id)
    db.commit()
    db.refresh(req)
    return _request_responses(db, [req], user)[0]


@router.get("/requests/{request_id}", response_model=HrLeaveRequestResponse)
async def get_request(request_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = _load_request(db, request_id)
    _ensure_can_view(user, req)
    return _request_responses(db, [req], user)[0]


@router.post("/requests/{request_id}/attachment", response_model=HrLeaveRequestResponse)
async def upload_request_attachment(
    request_id: int,
    attachment: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    req = _load_request(db, request_id)
    if user.id != req.user_id and not is_hr(user):
        raise HTTPException(status_code=403, detail="Only the employee who applied (or HR) can attach documents to this leave request.")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"{req.request_no} is already {req.status}, so its attachment can't be changed. Ask HR if a document must be added.")
    await _store_attachment(req, attachment)
    db.commit()
    db.refresh(req)
    return _request_responses(db, [req], user)[0]


@router.get("/requests/{request_id}/attachment")
async def download_request_attachment(request_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = _load_request(db, request_id)
    _ensure_can_view(user, req)
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


@router.post("/requests/{request_id}/approve", response_model=HrLeaveRequestResponse)
async def approve_request(
    request_id: int,
    payload: HrLeaveRequestDecisionPayload | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    req = _load_request(db, request_id, lock=True)
    ensure_can_decide(user, req.approver_id, req.user_id, "leave request")
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
    req.decision_remarks = ((payload.remarks or "").strip() or None) if payload else None
    apply_leave_to_attendance(db, req, lt, working_portions(ev.breakdown), user.id)
    record_audit(
        db, entity_type=ENTITY, entity_id=req.id, action="approved", module_key="hr",
        summary=f"Approved {req.request_no} ({fmt_days(req.days)} {lt.code}) for {applicant.name}" + (f": {req.decision_remarks}" if req.decision_remarks else ""),
        user_id=user.id,
    )
    notify_user(
        db, req.user_id, "Leave approved",
        f"{user.name} approved your {lt.name} {req.request_no} ({fmt_date(req.from_date)} to {fmt_date(req.to_date)}, {fmt_days(req.days)})."
        + (f" Remarks: {req.decision_remarks}" if req.decision_remarks else ""),
        NOTIFY_TYPE, ENTITY, req.id,
    )
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
    ensure_can_decide(user, req.approver_id, req.user_id, "leave request")
    _pending_or_400(req, "rejected")
    remarks = (payload.remarks or "").strip()
    if not remarks:
        raise HTTPException(status_code=400, detail="Give a reason for rejecting so the employee knows what to change. Add remarks and try again.")
    req.status = "rejected"
    req.decided_by_id = user.id
    req.decided_at = datetime.now(timezone.utc)
    req.decision_remarks = remarks
    lt = db.get(HrLeaveType, req.leave_type_id)
    record_audit(
        db, entity_type=ENTITY, entity_id=req.id, action="rejected", module_key="hr",
        summary=f"Rejected {req.request_no}: {remarks}", user_id=user.id,
    )
    notify_user(
        db, req.user_id, "Leave rejected",
        f"{user.name} rejected your {lt.name if lt else 'leave'} {req.request_no}. Reason: {remarks}",
        NOTIFY_TYPE, ENTITY, req.id,
    )
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
    if user.id != req.user_id and not is_hr(user):
        raise HTTPException(status_code=403, detail="Only the employee who applied (or HR) can cancel this leave request.")
    if req.status in ("rejected", "cancelled"):
        raise HTTPException(status_code=400, detail=f"{req.request_no} is already {req.status}; there is nothing to cancel.")
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
