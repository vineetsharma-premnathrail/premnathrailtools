"""HR & Administration — company assets and assignments.

Owner: Agent D. HR-management endpoints use `Depends(require_hr)`;
self-service endpoints use `Depends(get_current_user)` (see
app/modules/hr/services/access.py).

`HrAsset.current_holder_id` is the single source of truth for "who has this
asset right now" — the exit checklist reads it to find unreturned assets, so
every issue / return / lost transition here keeps it in step with the open
HrAssetAssignment row (the one with returned_on IS NULL)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Numeric, cast, func, or_, text
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.modules.hr.models.asset import (
    HrAsset, HrAssetAssignment, ASSET_CATEGORIES, ASSET_STATUSES, ASSET_CONDITIONS,
)
from app.modules.hr.schemas.asset import (
    HrAssetAssignmentResponse, HrAssetCreate, HrAssetUpdate, HrAssetIssuePayload,
    HrAssetReturnPayload, HrAssetStatusPayload, HrAssetResponse,
)
from app.modules.hr.services.access import require_hr
from app.modules.hr.services.admin_common import (
    users_by_id, branches_by_id, display_name, require_active_user, require_branch, require_choice,
)
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.branch import Branch
from app.utils.notifications import notify_user

router = APIRouter(prefix="/hr/assets", tags=["HR"])

CATEGORY_LABELS = {c: c.replace("_", " ").title() for c in ASSET_CATEGORIES}


# ── helpers ─────────────────────────────────────────────────────────────────

def _open_assignment(asset: HrAsset) -> HrAssetAssignment | None:
    return next((a for a in asset.assignments if a.returned_on is None), None)


def _assignment_responses(db: Session, rows: list[HrAssetAssignment], with_asset: bool = False) -> list[HrAssetAssignmentResponse]:
    users = users_by_id(db, [x for r in rows for x in (r.user_id, r.issued_by_id, r.received_by_id)])
    out = []
    for r in rows:
        resp = HrAssetAssignmentResponse.model_validate(r)
        u = users.get(r.user_id)
        resp.user_name = display_name(u)
        resp.user_email = u.email if u else None
        resp.issued_by_name = display_name(users.get(r.issued_by_id))
        resp.received_by_name = display_name(users.get(r.received_by_id))
        if with_asset and r.asset:
            resp.asset_code = r.asset.asset_code
            resp.asset_name = r.asset.name
            resp.asset_category = r.asset.category
            resp.asset_serial_number = r.asset.serial_number
            resp.asset_status = r.asset.status
        out.append(resp)
    return out


def _to_responses(db: Session, assets: list[HrAsset], with_history: bool = False) -> list[HrAssetResponse]:
    users = users_by_id(db, [x for a in assets for x in (a.current_holder_id, a.created_by_id)])
    branches = branches_by_id(db, [a.branch_id for a in assets])
    out = []
    for a in assets:
        resp = HrAssetResponse.model_validate(a)
        holder = users.get(a.current_holder_id)
        resp.current_holder_name = display_name(holder)
        resp.current_holder_email = holder.email if holder else None
        resp.created_by_name = display_name(users.get(a.created_by_id))
        b = branches.get(a.branch_id)
        resp.branch_name = b.name if b else None
        open_row = _open_assignment(a)
        if open_row:
            resp.issued_on = open_row.issued_on
            resp.expected_return_on = open_row.expected_return_on
        if with_history:
            resp.assignments = _assignment_responses(db, list(a.assignments))
        out.append(resp)
    return out


def _get_asset(db: Session, asset_id: int, lock: bool = False) -> HrAsset:
    """`lock=True` for issue/return/status changes (SELECT ... FOR UPDATE on
    the asset row) so two concurrent issues can't open two assignments."""
    q = (
        db.query(HrAsset).options(selectinload(HrAsset.assignments))
        .filter(HrAsset.id == asset_id, HrAsset.is_deleted == False)  # noqa: E712
    )
    if lock:
        q = q.with_for_update(of=HrAsset).populate_existing()
    asset = q.first()
    if not asset:
        raise HTTPException(
            status_code=404,
            detail=f"Asset #{asset_id} was not found. It may have been deleted — refresh the asset register.",
        )
    return asset


def _ensure_code_free(db: Session, code: str, exclude_id: int | None = None) -> None:
    q = db.query(HrAsset).filter(HrAsset.asset_code == code)
    if exclude_id:
        q = q.filter(HrAsset.id != exclude_id)
    clash = q.first()
    if clash:
        where = " (a deleted asset)" if clash.is_deleted else ""
        raise HTTPException(
            status_code=409,
            detail=(
                f"Asset code '{code}' is already used by '{clash.name}'{where}. "
                "Enter a different code, or leave it blank to auto-number."
            ),
        )


AUTO_CODE_PREFIX = "AST-"


def _next_asset_code(db: Session) -> str:
    """Next AST-NNNN. Codes are editable, so only codes that are exactly
    AST-<digits> count, compared numerically: a manual 'AST-DELL' or
    'AST-LAPTOP-01' (which broke the shared string-MAX helper with a 500) and
    'AST-9999' vs 'AST-10000' string ordering can't derail the series. Same
    advisory-lock key as app/core/sequential_id.py, so concurrent creates
    still serialise."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": AUTO_CODE_PREFIX})
    last = (
        db.query(func.max(cast(func.substring(HrAsset.asset_code, len(AUTO_CODE_PREFIX) + 1), Numeric)))
        .filter(HrAsset.asset_code.op("~")(f"^{AUTO_CODE_PREFIX}[0-9]+$"))
        .scalar()
    )
    return f"{AUTO_CODE_PREFIX}{int(last or 0) + 1:04d}"


def _validate_fields(db: Session, data: dict) -> None:
    require_choice(data.get("category"), ASSET_CATEGORIES, "asset category")
    require_choice(data.get("condition"), ASSET_CONDITIONS, "asset condition")
    if "branch_id" in data:
        require_branch(db, data["branch_id"])
    pd, wu = data.get("purchase_date"), data.get("warranty_until")
    if pd and wu and wu < pd:
        raise HTTPException(
            status_code=400,
            detail=f"Warranty end date ({wu:%d-%m-%Y}) is before the purchase date ({pd:%d-%m-%Y}). Correct one of the two dates.",
        )


# ── lookups & self-service ──────────────────────────────────────────────────

@router.get("/lookups/branches")
async def list_branch_lookup(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Plant list (id/code/name) for HR pickers — the organization branch
    list endpoint is admin-only, and HR/reception users are not admins."""
    rows = db.query(Branch).order_by(Branch.name.asc()).all()
    return [{"id": b.id, "code": getattr(b, "code", None), "name": b.name} for b in rows]


@router.get("/mine", response_model=list[HrAssetResponse])
async def list_my_assets(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Assets currently issued to the signed-in employee."""
    assets = (
        db.query(HrAsset).options(selectinload(HrAsset.assignments))
        .filter(HrAsset.current_holder_id == user.id, HrAsset.is_deleted == False)  # noqa: E712
        .order_by(HrAsset.asset_code.asc()).all()
    )
    return _to_responses(db, assets)


@router.get("/mine/history", response_model=list[HrAssetAssignmentResponse])
async def list_my_asset_history(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(HrAssetAssignment).options(selectinload(HrAssetAssignment.asset))
        .filter(HrAssetAssignment.user_id == user.id)
        .order_by(HrAssetAssignment.issued_on.desc(), HrAssetAssignment.id.desc()).all()
    )
    return _assignment_responses(db, rows, with_asset=True)


# ── HR management ───────────────────────────────────────────────────────────

@router.get("/meta")
async def asset_meta(_user: User = Depends(require_hr)):
    return {
        "categories": list(ASSET_CATEGORIES),
        "statuses": list(ASSET_STATUSES),
        "conditions": list(ASSET_CONDITIONS),
    }


@router.get("/by-user/{user_id}", response_model=list[HrAssetAssignmentResponse])
async def list_user_asset_history(
    user_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    """Every issue/return for one employee (open assignments first)."""
    rows = (
        db.query(HrAssetAssignment).options(selectinload(HrAssetAssignment.asset))
        .filter(HrAssetAssignment.user_id == user_id)
        .order_by(HrAssetAssignment.returned_on.isnot(None), HrAssetAssignment.issued_on.desc(), HrAssetAssignment.id.desc())
        .all()
    )
    return _assignment_responses(db, rows, with_asset=True)


@router.get("", response_model=list[HrAssetResponse])
async def list_assets(
    category: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    branch_id: int | None = None,
    holder_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    q = db.query(HrAsset).options(selectinload(HrAsset.assignments)).filter(HrAsset.is_deleted == False)  # noqa: E712
    if category:
        q = q.filter(HrAsset.category == category)
    if status_filter:
        q = q.filter(HrAsset.status == status_filter)
    if branch_id:
        q = q.filter(HrAsset.branch_id == branch_id)
    if holder_id:
        q = q.filter(HrAsset.current_holder_id == holder_id)
    if search and search.strip():
        term = f"%{search.strip()}%"
        holder_ids = [u.id for u in db.query(User.id).filter(or_(User.name.ilike(term), User.email.ilike(term))).all()]
        conds = [
            HrAsset.asset_code.ilike(term), HrAsset.name.ilike(term), HrAsset.serial_number.ilike(term),
            HrAsset.make.ilike(term), HrAsset.model.ilike(term), HrAsset.invoice_no.ilike(term),
        ]
        if holder_ids:
            conds.append(HrAsset.current_holder_id.in_(holder_ids))
        q = q.filter(or_(*conds))
    assets = q.order_by(HrAsset.asset_code.asc()).all()
    return _to_responses(db, assets)


@router.get("/{asset_id}", response_model=HrAssetResponse)
async def get_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    return _to_responses(db, [_get_asset(db, asset_id)], with_history=True)[0]


@router.post("", response_model=HrAssetResponse, status_code=201)
async def create_asset(
    payload: HrAssetCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    data = payload.model_dump()
    _validate_fields(db, data)
    code = (data.pop("asset_code") or "").strip()
    if code:
        _ensure_code_free(db, code)
    else:
        code = _next_asset_code(db)
    asset = HrAsset(asset_code=code, status="in_stock", created_by_id=user.id, **data)
    db.add(asset)
    db.commit()
    return _to_responses(db, [_get_asset(db, asset.id)], with_history=True)[0]


@router.patch("/{asset_id}", response_model=HrAssetResponse)
async def update_asset(
    asset_id: int,
    payload: HrAssetUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    asset = _get_asset(db, asset_id)
    data = payload.model_dump(exclude_unset=True)
    merged = {
        "purchase_date": data.get("purchase_date", asset.purchase_date),
        "warranty_until": data.get("warranty_until", asset.warranty_until),
        **{k: v for k, v in data.items() if k not in ("purchase_date", "warranty_until")},
    }
    _validate_fields(db, merged)
    if "asset_code" in data:
        code = (data["asset_code"] or "").strip()
        if not code:
            raise HTTPException(status_code=400, detail="Asset code cannot be blank on an existing asset. Enter a code, or leave the field unchanged.")
        if code != asset.asset_code:
            _ensure_code_free(db, code, exclude_id=asset.id)
        data["asset_code"] = code
    if "name" in data and not data["name"]:
        raise HTTPException(status_code=400, detail="Asset name cannot be blank. Enter a name such as 'Dell Latitude 5440'.")
    for k, v in data.items():
        setattr(asset, k, v)
    db.commit()
    return _to_responses(db, [_get_asset(db, asset.id)], with_history=True)[0]


@router.delete("/{asset_id}")
async def delete_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    asset = _get_asset(db, asset_id, lock=True)
    if asset.status == "issued" or asset.current_holder_id:
        holder = db.query(User).filter(User.id == asset.current_holder_id).first()
        raise HTTPException(
            status_code=409,
            detail=(
                f"{asset.asset_code} is currently issued to {display_name(holder) or 'an employee'}, so it cannot be deleted. "
                "Record the return first (or mark it lost), then delete it."
            ),
        )
    asset.is_deleted = True
    db.commit()
    return {"ok": True, "id": asset.id}


@router.post("/{asset_id}/issue", response_model=HrAssetResponse)
async def issue_asset(
    asset_id: int,
    payload: HrAssetIssuePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    asset = _get_asset(db, asset_id, lock=True)
    if asset.status != "in_stock":
        extra = ""
        if asset.status == "issued":
            holder = db.query(User).filter(User.id == asset.current_holder_id).first()
            extra = f" to {display_name(holder) or 'another employee'}"
        raise HTTPException(
            status_code=409,
            detail=(
                f"{asset.asset_code} is {asset.status.replace('_', ' ')}{extra}, and only in-stock assets can be issued. "
                + ("Record its return first, then issue it again." if asset.status == "issued"
                   else "Change its status back to In Stock first if it is usable.")
            ),
        )
    holder = require_active_user(db, payload.user_id, "employee to issue to")
    require_choice(payload.condition_on_issue, ASSET_CONDITIONS, "condition on issue")
    issued_on = payload.issued_on or date.today()
    if payload.expected_return_on and payload.expected_return_on < issued_on:
        raise HTTPException(
            status_code=400,
            detail=f"Expected return date ({payload.expected_return_on:%d-%m-%Y}) is before the issue date ({issued_on:%d-%m-%Y}). Pick a later return date or leave it blank.",
        )
    condition = payload.condition_on_issue or asset.condition
    db.add(HrAssetAssignment(
        asset_id=asset.id, user_id=holder.id, issued_on=issued_on, issued_by_id=user.id,
        expected_return_on=payload.expected_return_on, condition_on_issue=condition, remarks=payload.remarks,
    ))
    asset.status = "issued"
    asset.current_holder_id = holder.id
    if condition:
        asset.condition = condition
    notify_user(
        db, holder.id, "Asset issued to you",
        f"{asset.asset_code} — {asset.name} has been issued to you on {issued_on:%d-%m-%Y}. It will be listed under My HR → My Assets.",
        "hr_asset_issued", entity_type="hr_asset", entity_id=asset.id,
    )
    db.commit()
    db.expire_all()
    return _to_responses(db, [_get_asset(db, asset.id)], with_history=True)[0]


@router.post("/{asset_id}/return", response_model=HrAssetResponse)
async def return_asset(
    asset_id: int,
    payload: HrAssetReturnPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    asset = _get_asset(db, asset_id, lock=True)
    open_row = _open_assignment(asset)
    if asset.status != "issued" or not open_row:
        raise HTTPException(
            status_code=409,
            detail=f"{asset.asset_code} is {asset.status.replace('_', ' ')}, not issued to anyone, so there is nothing to return. Refresh the page to see its current status.",
        )
    require_choice(payload.condition_on_return, ASSET_CONDITIONS, "condition on return")
    if payload.next_status not in ("in_stock", "under_repair", "retired"):
        raise HTTPException(
            status_code=400,
            detail=f"After a return the asset can go to In Stock, Under Repair or Retired — '{payload.next_status}' is not one of those.",
        )
    returned_on = payload.returned_on or date.today()
    if returned_on < open_row.issued_on:
        raise HTTPException(
            status_code=400,
            detail=f"Return date ({returned_on:%d-%m-%Y}) is before the date it was issued ({open_row.issued_on:%d-%m-%Y}). Pick a date on or after the issue date.",
        )
    open_row.returned_on = returned_on
    open_row.received_by_id = user.id
    open_row.condition_on_return = payload.condition_on_return
    if payload.remarks:
        open_row.remarks = f"{open_row.remarks}\n{payload.remarks}" if open_row.remarks else payload.remarks
    previous_holder = asset.current_holder_id
    asset.status = payload.next_status
    asset.condition = payload.condition_on_return
    asset.current_holder_id = None
    if previous_holder:
        notify_user(
            db, previous_holder, "Asset return recorded",
            f"{asset.asset_code} — {asset.name} was received back from you on {returned_on:%d-%m-%Y}.",
            "hr_asset_returned", entity_type="hr_asset", entity_id=asset.id,
        )
    db.commit()
    db.expire_all()
    return _to_responses(db, [_get_asset(db, asset.id)], with_history=True)[0]


@router.post("/{asset_id}/status", response_model=HrAssetResponse)
async def change_asset_status(
    asset_id: int,
    payload: HrAssetStatusPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    """Move an asset to in_stock / under_repair / retired / lost. Issuing
    and returning have their own endpoints. Only `lost` is allowed while an
    asset is issued: it closes the open assignment and clears the holder."""
    asset = _get_asset(db, asset_id, lock=True)
    target = payload.status
    if target == "issued":
        raise HTTPException(status_code=400, detail="Use 'Issue' to hand an asset to an employee — it records who has it and from when.")
    require_choice(target, ASSET_STATUSES, "asset status")
    if target == asset.status:
        raise HTTPException(status_code=409, detail=f"{asset.asset_code} is already {target.replace('_', ' ')}. Refresh the page to see its current status.")
    open_row = _open_assignment(asset)
    if asset.status == "issued" and target != "lost":
        raise HTTPException(
            status_code=409,
            detail=(
                f"{asset.asset_code} is currently issued, so it cannot be moved to {target.replace('_', ' ')} directly. "
                "Record the return first — the return form lets you send it to Under Repair or Retired."
            ),
        )
    if target == "lost" and open_row:
        open_row.returned_on = date.today()
        open_row.received_by_id = user.id
        note = "Reported lost while issued." + (f" {payload.remarks}" if payload.remarks else "")
        open_row.remarks = f"{open_row.remarks}\n{note}" if open_row.remarks else note
        asset.current_holder_id = None
    asset.status = target
    if payload.remarks:
        stamp = f"[{date.today():%d-%m-%Y}] {target.replace('_', ' ').title()}: {payload.remarks}"
        asset.remarks = f"{asset.remarks}\n{stamp}" if asset.remarks else stamp
    db.commit()
    db.expire_all()
    return _to_responses(db, [_get_asset(db, asset.id)], with_history=True)[0]
