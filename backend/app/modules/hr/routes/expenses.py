"""HR & Administration — expense claims (EXP-YYYY-NNNN) with line items and
receipts.

Owner: Agent D. Flow: the employee builds a draft (lines + receipts, optional
link to one of their own approved trips) → submits → their reporting manager
(or HR, when there is no manager) approves or rejects → HR records payment.
A rejected claim can be edited and submitted again. Nobody decides their own
claim, and HR cannot record payment of their own claim."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.audit import record_audit
from app.core.config import settings
from app.core.sequential_id import next_sequential_id
from app.db.session import get_db
from app.modules.hr.models.expense import (
    HrExpenseClaim, HrExpenseClaimItem, EXPENSE_CLAIM_STATUSES, EXPENSE_CATEGORIES,
)
from app.modules.hr.models.travel import HrTravelRequest
from app.modules.hr.schemas.expense import (
    HrExpenseClaimItemPayload, HrExpenseClaimItemUpdate, HrExpenseClaimItemResponse,
    HrExpenseClaimCreate, HrExpenseClaimUpdate, HrExpenseClaimDecisionPayload,
    HrExpenseClaimMarkPaidPayload, HrExpenseClaimResponse,
)
from app.modules.hr.services.access import can_decide, ensure_can_decide, is_hr, require_hr
from app.modules.hr.services.admin_common import users_by_id, display_name, require_choice, require_sharepoint
from app.modules.hr.services.expenses import (
    RECEIPT_REQUIRED_ABOVE, EDITABLE_STATUSES, receipt_required, recompute_total, fmt_inr,
    ensure_owner_can_edit, validate_for_submit,
)
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.utils.notifications import notify_user
from app.utils.sharepoint import upload_file_to_sharepoint, delete_file_from_sharepoint, download_file_content

router = APIRouter(prefix="/hr/expenses", tags=["HR"])

MAX_RECEIPT_BYTES = 10 * 1024 * 1024


# ── helpers ─────────────────────────────────────────────────────────────────

def _item_response(item: HrExpenseClaimItem) -> HrExpenseClaimItemResponse:
    resp = HrExpenseClaimItemResponse.model_validate(item)
    resp.has_receipt = bool(item.receipt_path)
    resp.receipt_required = receipt_required(item)
    return resp


def _to_responses(db: Session, viewer: User, claims: list[HrExpenseClaim], with_items: bool = False) -> list[HrExpenseClaimResponse]:
    users = users_by_id(db, [x for c in claims for x in (c.user_id, c.approver_id, c.decided_by_id, c.paid_by_id)])
    trip_ids = {c.travel_request_id for c in claims if c.travel_request_id}
    trips = {t.id: t for t in db.query(HrTravelRequest).filter(HrTravelRequest.id.in_(trip_ids)).all()} if trip_ids else {}
    hr = is_hr(viewer)
    out = []
    for c in claims:
        resp = HrExpenseClaimResponse.model_validate(c)
        u = users.get(c.user_id)
        resp.user_name = display_name(u)
        resp.user_email = u.email if u else None
        resp.user_department = u.department if u else None
        resp.approver_name = display_name(users.get(c.approver_id))
        resp.decided_by_name = display_name(users.get(c.decided_by_id))
        resp.paid_by_name = display_name(users.get(c.paid_by_id))
        trip = trips.get(c.travel_request_id)
        if trip:
            resp.travel_request_no = trip.request_no
            resp.travel_route = f"{trip.from_city} → {trip.to_city}"
        resp.item_count = len(c.items)
        if with_items:
            resp.items = [_item_response(i) for i in c.items]
        resp.receipt_threshold = RECEIPT_REQUIRED_ABOVE
        resp.can_edit = c.user_id == viewer.id and c.status in EDITABLE_STATUSES
        resp.can_decide = c.status == "submitted" and can_decide(viewer, c.approver_id, c.user_id)
        resp.can_mark_paid = hr and c.status == "approved" and c.user_id != viewer.id
        resp.can_cancel = c.user_id == viewer.id and c.status in ("draft", "rejected", "submitted")
        out.append(resp)
    return out


def _one(db: Session, viewer: User, claim: HrExpenseClaim) -> HrExpenseClaimResponse:
    db.expire_all()
    fresh = _get(db, claim.id)
    return _to_responses(db, viewer, [fresh], with_items=True)[0]


def _get(db: Session, claim_id: int, lock: bool = False) -> HrExpenseClaim:
    """`lock=True` for state changes (SELECT ... FOR UPDATE on the claim row)
    so concurrent submit/decide/cancel/mark-paid calls are serialised."""
    q = db.query(HrExpenseClaim).options(selectinload(HrExpenseClaim.items)).filter(HrExpenseClaim.id == claim_id)
    if lock:
        q = q.with_for_update(of=HrExpenseClaim).populate_existing()
    claim = q.first()
    if not claim:
        raise HTTPException(status_code=404, detail=f"Expense claim #{claim_id} was not found. Refresh the list — it may have been removed.")
    return claim


def _ensure_can_view(user: User, claim: HrExpenseClaim) -> None:
    if user.id in (claim.user_id, claim.approver_id) or is_hr(user):
        return
    raise HTTPException(
        status_code=403,
        detail="You can only open your own expense claims or ones waiting for your approval. HR can see every claim.",
    )


def _get_item(claim: HrExpenseClaim, item_id: int) -> HrExpenseClaimItem:
    item = next((i for i in claim.items if i.id == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail=f"Line #{item_id} is not part of {claim.claim_no}. Refresh the claim to see its current lines.")
    return item


def _validate_trip(db: Session, user: User, travel_request_id: int | None) -> None:
    if travel_request_id is None:
        return
    trip = db.query(HrTravelRequest).filter(HrTravelRequest.id == travel_request_id).first()
    if not trip or trip.user_id != user.id:
        raise HTTPException(
            status_code=400,
            detail="The linked travel request must be one of your own. Pick a trip from your list, or leave it blank.",
        )
    if trip.status not in ("approved", "completed"):
        raise HTTPException(
            status_code=400,
            detail=f"{trip.request_no} is {trip.status}; only approved or completed trips can be linked to a claim. Leave the link blank or wait for approval.",
        )


def _validate_item(data: dict, claim: HrExpenseClaim) -> None:
    require_choice(data.get("category"), EXPENSE_CATEGORIES, "expense category")
    d = data.get("expense_date")
    if d and d > date.today():
        raise HTTPException(
            status_code=400,
            detail=f"Expense date {d:%d-%m-%Y} is in the future. Claims can only include expenses already incurred.",
        )


def _approver_for(user: User) -> int | None:
    mid = user.reporting_manager_id
    return mid if mid and mid != user.id else None


# ── self-service ────────────────────────────────────────────────────────────

@router.get("/meta")
async def expense_meta(_user: User = Depends(get_current_user)):
    return {
        "categories": list(EXPENSE_CATEGORIES),
        "statuses": list(EXPENSE_CLAIM_STATUSES),
        "receipt_required_above": RECEIPT_REQUIRED_ABOVE,
    }


@router.get("/mine", response_model=list[HrExpenseClaimResponse])
async def list_my_claims(
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(HrExpenseClaim).options(selectinload(HrExpenseClaim.items)).filter(HrExpenseClaim.user_id == user.id)
    if status_filter:
        require_choice(status_filter, EXPENSE_CLAIM_STATUSES, "claim status")
        q = q.filter(HrExpenseClaim.status == status_filter)
    rows = q.order_by(HrExpenseClaim.claim_date.desc(), HrExpenseClaim.id.desc()).all()
    return _to_responses(db, user, rows)


@router.get("/travel-options")
async def list_linkable_trips(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The signed-in employee's approved/completed trips a claim can link to."""
    rows = (
        db.query(HrTravelRequest)
        .filter(HrTravelRequest.user_id == user.id, HrTravelRequest.status.in_(("approved", "completed")))
        .order_by(HrTravelRequest.depart_date.desc()).limit(100).all()
    )
    return [
        {
            "id": t.id, "request_no": t.request_no, "from_city": t.from_city, "to_city": t.to_city,
            "depart_date": t.depart_date, "return_date": t.return_date, "status": t.status,
        }
        for t in rows
    ]


@router.get("/approvals", response_model=list[HrExpenseClaimResponse])
async def list_claim_approvals(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cond = HrExpenseClaim.approver_id == user.id
    if is_hr(user):
        cond = or_(cond, HrExpenseClaim.approver_id.is_(None))
    rows = (
        db.query(HrExpenseClaim).options(selectinload(HrExpenseClaim.items))
        .filter(HrExpenseClaim.status == "submitted", HrExpenseClaim.user_id != user.id, cond)
        .order_by(HrExpenseClaim.submitted_at.asc(), HrExpenseClaim.id.asc()).all()
    )
    return _to_responses(db, user, rows, with_items=True)


@router.post("", response_model=HrExpenseClaimResponse, status_code=201)
async def create_claim(
    payload: HrExpenseClaimCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _validate_trip(db, user, payload.travel_request_id)
    claim = HrExpenseClaim(
        claim_no=next_sequential_id(db, prefix=f"EXP-{date.today().year}-", column=HrExpenseClaim.claim_no),
        user_id=user.id, travel_request_id=payload.travel_request_id, title=payload.title.strip(),
        claim_date=payload.claim_date or date.today(), status="draft",
    )
    for it in payload.items:
        data = it.model_dump()
        _validate_item(data, claim)
        claim.items.append(HrExpenseClaimItem(**data))
    recompute_total(claim)
    db.add(claim)
    db.commit()
    return _one(db, user, claim)


# ── HR list ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[HrExpenseClaimResponse])
async def list_claims(
    status_filter: str | None = Query(None, alias="status"),
    user_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    q = db.query(HrExpenseClaim).options(selectinload(HrExpenseClaim.items))
    if status_filter:
        require_choice(status_filter, EXPENSE_CLAIM_STATUSES, "claim status")
        q = q.filter(HrExpenseClaim.status == status_filter)
    else:
        # Drafts are private until submitted.
        q = q.filter(HrExpenseClaim.status != "draft")
    if user_id:
        q = q.filter(HrExpenseClaim.user_id == user_id)
    if date_from:
        q = q.filter(HrExpenseClaim.claim_date >= date_from)
    if date_to:
        q = q.filter(HrExpenseClaim.claim_date <= date_to)
    if search and search.strip():
        term = f"%{search.strip()}%"
        uids = [u.id for u in db.query(User.id).filter(or_(User.name.ilike(term), User.email.ilike(term))).all()]
        conds = [HrExpenseClaim.claim_no.ilike(term), HrExpenseClaim.title.ilike(term), HrExpenseClaim.payment_reference.ilike(term)]
        if uids:
            conds.append(HrExpenseClaim.user_id.in_(uids))
        q = q.filter(or_(*conds))
    rows = q.order_by(HrExpenseClaim.claim_date.desc(), HrExpenseClaim.id.desc()).limit(500).all()
    return _to_responses(db, user, rows)


# ── single claim ────────────────────────────────────────────────────────────

@router.get("/{claim_id}", response_model=HrExpenseClaimResponse)
async def get_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id)
    _ensure_can_view(user, claim)
    if claim.status == "draft" and claim.user_id != user.id:
        raise HTTPException(status_code=403, detail=f"{claim.claim_no} is still a draft; only its owner can see it until it is submitted.")
    return _to_responses(db, user, [claim], with_items=True)[0]


@router.patch("/{claim_id}", response_model=HrExpenseClaimResponse)
async def update_claim(
    claim_id: int,
    payload: HrExpenseClaimUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id)
    ensure_owner_can_edit(claim, user.id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("clear_travel_request"):
        claim.travel_request_id = None
    elif "travel_request_id" in data:
        _validate_trip(db, user, data["travel_request_id"])
        claim.travel_request_id = data["travel_request_id"]
    if "title" in data:
        if not (data["title"] or "").strip():
            raise HTTPException(status_code=400, detail="Claim title cannot be blank. Describe the claim, e.g. 'Delhi site visit — Sept'.")
        claim.title = data["title"].strip()
    if data.get("claim_date"):
        claim.claim_date = data["claim_date"]
    db.commit()
    return _one(db, user, claim)


@router.post("/{claim_id}/items", response_model=HrExpenseClaimResponse, status_code=201)
async def add_claim_item(
    claim_id: int,
    payload: HrExpenseClaimItemPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id)
    ensure_owner_can_edit(claim, user.id)
    data = payload.model_dump()
    _validate_item(data, claim)
    claim.items.append(HrExpenseClaimItem(**data))
    recompute_total(claim)
    db.commit()
    return _one(db, user, claim)


@router.patch("/{claim_id}/items/{item_id}", response_model=HrExpenseClaimResponse)
async def update_claim_item(
    claim_id: int,
    item_id: int,
    payload: HrExpenseClaimItemUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id)
    ensure_owner_can_edit(claim, user.id)
    item = _get_item(claim, item_id)
    data = payload.model_dump(exclude_unset=True)
    for required in ("expense_date", "category", "amount"):
        if required in data and data[required] is None:
            raise HTTPException(status_code=400, detail=f"{required.replace('_', ' ').capitalize()} cannot be blank on an expense line.")
    _validate_item(data, claim)
    for k, v in data.items():
        setattr(item, k, v)
    recompute_total(claim)
    db.commit()
    return _one(db, user, claim)


@router.delete("/{claim_id}/items/{item_id}", response_model=HrExpenseClaimResponse)
async def delete_claim_item(
    claim_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id)
    ensure_owner_can_edit(claim, user.id)
    item = _get_item(claim, item_id)
    old_path = item.receipt_path
    claim.items.remove(item)
    recompute_total(claim)
    db.commit()
    if old_path and settings.SHAREPOINT_SITE_ID:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, old_path)
        except Exception:  # noqa: BLE001 — the line is gone; an orphaned file is harmless
            pass
    return _one(db, user, claim)


@router.post("/{claim_id}/items/{item_id}/receipt", response_model=HrExpenseClaimResponse)
async def upload_item_receipt(
    claim_id: int,
    item_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id)
    ensure_owner_can_edit(claim, user.id)
    item = _get_item(claim, item_id)
    site_id = require_sharepoint(settings.SHAREPOINT_SITE_ID)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"'{file.filename}' is empty. Choose the scanned receipt or photo again.")
    if len(content) > MAX_RECEIPT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"'{file.filename}' is {len(content) / 1024 / 1024:.1f} MB; receipts can be at most 10 MB. Compress the photo or scan it at a lower resolution.",
        )
    await file.seek(0)
    # One folder per line: two receipts both named "IMG_0001.jpg" on
    # different lines would otherwise overwrite each other in SharePoint.
    folder = f"{settings.SHAREPOINT_FOLDER}/hr/expenses/{claim.claim_no}/line-{item.id}"
    result = await upload_file_to_sharepoint(site_id, folder, file)
    old_path = item.receipt_path
    item.receipt_path = result["path"]
    item.receipt_url = result.get("webUrl")
    item.receipt_filename = result.get("name") or file.filename
    db.commit()
    if old_path and old_path != item.receipt_path:
        try:
            await delete_file_from_sharepoint(site_id, old_path)
        except Exception:  # noqa: BLE001 — replacing a receipt shouldn't fail on cleanup
            pass
    return _one(db, user, claim)


@router.delete("/{claim_id}/items/{item_id}/receipt", response_model=HrExpenseClaimResponse)
async def delete_item_receipt(
    claim_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id)
    ensure_owner_can_edit(claim, user.id)
    item = _get_item(claim, item_id)
    if not item.receipt_path:
        raise HTTPException(status_code=404, detail="This line has no receipt attached, so there is nothing to remove.")
    old_path = item.receipt_path
    item.receipt_path = item.receipt_url = item.receipt_filename = None
    db.commit()
    if settings.SHAREPOINT_SITE_ID:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, old_path)
        except Exception:  # noqa: BLE001
            pass
    return _one(db, user, claim)


@router.get("/{claim_id}/items/{item_id}/receipt")
async def get_item_receipt(
    claim_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Receipt bytes streamed through the backend (never the raw SharePoint
    link), so only the owner, the approver and HR can open it."""
    claim = _get(db, claim_id)
    _ensure_can_view(user, claim)
    item = _get_item(claim, item_id)
    if not item.receipt_path:
        raise HTTPException(status_code=404, detail="This line has no receipt attached. The employee needs to upload one.")
    site_id = require_sharepoint(settings.SHAREPOINT_SITE_ID)
    content, content_type = await download_file_content(site_id, item.receipt_path)
    filename = (item.receipt_filename or "receipt").replace('"', "")
    return Response(content=content, media_type=content_type, headers={"Content-Disposition": f'inline; filename="{filename}"'})


@router.post("/{claim_id}/submit", response_model=HrExpenseClaimResponse)
async def submit_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id, lock=True)
    ensure_owner_can_edit(claim, user.id)
    validate_for_submit(claim)
    resubmission = claim.status == "rejected"
    claim.status = "submitted"
    claim.submitted_at = datetime.now(timezone.utc)
    claim.approver_id = _approver_for(user)
    claim.decided_by_id = None
    claim.decided_at = None
    recompute_total(claim)
    if claim.approver_id:
        notify_user(
            db, claim.approver_id,
            "Expense claim resubmitted for your approval" if resubmission else "Expense claim awaiting your approval",
            f"{display_name(user)} submitted {claim.claim_no} '{claim.title}' for {fmt_inr(claim.total_amount)}. Open HR → Approvals to decide.",
            "hr_expense_submitted", entity_type="hr_expense_claim", entity_id=claim.id, teams=True,
        )
    db.commit()
    return _one(db, user, claim)


def _decide(db: Session, user: User, claim: HrExpenseClaim, approve: bool, remarks: str | None) -> None:
    ensure_can_decide(user, claim.approver_id, claim.user_id, "expense claim")
    if claim.status != "submitted":
        raise HTTPException(
            status_code=409,
            detail=f"{claim.claim_no} is {claim.status}, not waiting for a decision. Refresh the page to see its current state.",
        )
    if not approve and not (remarks or "").strip():
        raise HTTPException(status_code=400, detail="Enter a reason when rejecting a claim, so the employee knows what to correct before resubmitting.")
    verb = "approved" if approve else "rejected"
    claim.status = verb
    claim.decided_by_id = user.id
    claim.decided_at = datetime.now(timezone.utc)
    claim.decision_remarks = (remarks or "").strip() or None
    notify_user(
        db, claim.user_id, f"Expense claim {verb}",
        f"{display_name(user)} {verb} {claim.claim_no} ({fmt_inr(claim.total_amount)})"
        + (f": {claim.decision_remarks}" if claim.decision_remarks else ".")
        + (" Edit it under My HR → Expense Claims and submit again." if not approve else ""),
        f"hr_expense_{verb}", entity_type="hr_expense_claim", entity_id=claim.id,
    )
    record_audit(
        db, entity_type="hr_expense_claim", entity_id=claim.id, action=verb, module_key="hr",
        summary=f"Expense claim {claim.claim_no} {verb}" + (f": {claim.decision_remarks}" if claim.decision_remarks else ""),
        user_id=user.id,
    )


@router.post("/{claim_id}/approve", response_model=HrExpenseClaimResponse)
async def approve_claim(
    claim_id: int,
    payload: HrExpenseClaimDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id, lock=True)
    _decide(db, user, claim, True, payload.remarks)
    db.commit()
    return _one(db, user, claim)


@router.post("/{claim_id}/reject", response_model=HrExpenseClaimResponse)
async def reject_claim(
    claim_id: int,
    payload: HrExpenseClaimDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id, lock=True)
    _decide(db, user, claim, False, payload.remarks)
    db.commit()
    return _one(db, user, claim)


@router.post("/{claim_id}/cancel", response_model=HrExpenseClaimResponse)
async def cancel_claim(
    claim_id: int,
    payload: HrExpenseClaimDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = _get(db, claim_id, lock=True)
    if claim.user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the employee who created this claim can cancel it.")
    if claim.status not in ("draft", "rejected", "submitted"):
        raise HTTPException(
            status_code=409,
            detail=f"{claim.claim_no} is {claim.status}, so it can no longer be cancelled."
            + (" Ask HR if the payment should be reversed." if claim.status in ("approved", "paid") else ""),
        )
    was_submitted = claim.status == "submitted"
    claim.status = "cancelled"
    if payload.remarks:
        claim.decision_remarks = f"{claim.decision_remarks}\nCancelled: {payload.remarks}" if claim.decision_remarks else f"Cancelled: {payload.remarks}"
    if was_submitted and claim.approver_id:
        notify_user(
            db, claim.approver_id, "Expense claim withdrawn",
            f"{display_name(user)} withdrew {claim.claim_no} before it was decided.",
            "hr_expense_cancelled", entity_type="hr_expense_claim", entity_id=claim.id,
        )
    db.commit()
    return _one(db, user, claim)


@router.post("/{claim_id}/mark-paid", response_model=HrExpenseClaimResponse)
async def mark_claim_paid(
    claim_id: int,
    payload: HrExpenseClaimMarkPaidPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    claim = _get(db, claim_id, lock=True)
    if claim.user_id == user.id:
        raise HTTPException(status_code=403, detail="You cannot record payment of your own expense claim. Another HR user has to mark it paid.")
    if claim.status != "approved":
        raise HTTPException(
            status_code=409,
            detail=f"{claim.claim_no} is {claim.status}; only approved claims can be marked paid."
            + (" It has to be approved first." if claim.status == "submitted" else ""),
        )
    paid_on = payload.paid_on or date.today()
    if claim.submitted_at and paid_on < claim.submitted_at.date():
        raise HTTPException(
            status_code=400,
            detail=f"Payment date {paid_on:%d-%m-%Y} is before the claim was submitted ({claim.submitted_at:%d-%m-%Y}). Enter the actual payment date.",
        )
    claim.status = "paid"
    claim.paid_on = paid_on
    claim.payment_reference = payload.payment_reference.strip()
    claim.paid_by_id = user.id
    notify_user(
        db, claim.user_id, "Expense claim paid",
        f"{claim.claim_no} for {fmt_inr(claim.total_amount)} was paid on {paid_on:%d-%m-%Y} (ref {claim.payment_reference}).",
        "hr_expense_paid", entity_type="hr_expense_claim", entity_id=claim.id,
    )
    db.commit()
    return _one(db, user, claim)
