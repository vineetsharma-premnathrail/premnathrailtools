from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_tab_access, require_tab_action, ensure_can_delete, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.fixed_asset import FixedAsset, DepreciationRun
from app.modules.accounts.schemas.fixed_asset import (
    FixedAssetCreate, FixedAssetUpdate, FixedAssetDisposePayload, FixedAssetResponse,
    DepreciationRunCreate, DepreciationRunReversePayload, DepreciationRunResponse, DepreciationRunLineResponse,
)
from app.modules.accounts.services import assets
from app.modules.accounts.routes._common import write_audit, who, service_errors, require_finance_manager, gl_labels
from app.modules.accounts import access

router = APIRouter(prefix="/accounts/fixed-assets", tags=["Accounts"])


def _to_response(a: FixedAsset, db: Session) -> FixedAssetResponse:
    gl = gl_labels(db, {a.asset_gl_account_id}).get(a.asset_gl_account_id)
    return FixedAssetResponse.model_validate(a).model_copy(update={
        "book_value": round(float(a.cost) - float(a.accumulated_depreciation or 0), 2),
        "asset_gl_account_name": f"{gl.code} — {gl.name}" if gl else None,
    })


def _run_response(run: DepreciationRun, db: Session) -> DepreciationRunResponse:
    ids = {l.fixed_asset_id for l in run.lines}
    by_id = {a.id: a for a in db.query(FixedAsset).filter(FixedAsset.id.in_(ids)).all()} if ids else {}
    lines = [DepreciationRunLineResponse.model_validate(l).model_copy(update={
        "asset_code": by_id[l.fixed_asset_id].asset_code if l.fixed_asset_id in by_id else None,
        "asset_name": by_id[l.fixed_asset_id].name if l.fixed_asset_id in by_id else None}) for l in run.lines]
    return DepreciationRunResponse.model_validate(run).model_copy(update={"lines": lines})


@router.get("", response_model=list[FixedAssetResponse])
async def list_assets(status: str | None = Query(None), db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "fixed_assets"))):
    q = db.query(FixedAsset)
    if status:
        q = q.filter(FixedAsset.status == status)
    return [_to_response(a, db) for a in q.order_by(FixedAsset.asset_code.asc()).all()]


@router.post("", response_model=FixedAssetResponse, status_code=201)
async def create_asset_route(payload: FixedAssetCreate, db: Session = Depends(get_db), user: User = Depends(require_tab_action("accounts", "fixed_assets", "create"))):
    with service_errors(db):
        a = assets.create_asset(db, data=payload.model_dump(), created_by_id=user.id)
    write_audit(db, "fixed_asset", a.id, "created", user, f"{who(user)} registered asset '{a.asset_code} — {a.name}' at {a.cost:,.2f}.")
    db.commit()
    db.refresh(a)
    return _to_response(a, db)


@router.patch("/{asset_id}", response_model=FixedAssetResponse)
async def update_asset_route(asset_id: int, payload: FixedAssetUpdate, db: Session = Depends(get_db), user: User = Depends(require_tab_action("accounts", "fixed_assets", "edit"))):
    a = db.query(FixedAsset).filter(FixedAsset.id == asset_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asset not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(a, k, v)
    write_audit(db, "fixed_asset", a.id, "updated", user, f"{who(user)} updated asset '{a.asset_code}'.")
    db.commit()
    db.refresh(a)
    return _to_response(a, db)


@router.delete("/{asset_id}")
async def delete_asset_route(asset_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("accounts", "fixed_assets"))):
    a = db.query(FixedAsset).filter(FixedAsset.id == asset_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asset not found")
    ensure_can_delete(user, a, "accounts", "fixed_assets", what="fixed asset")
    if a.depreciated_up_to or a.status != "active":
        raise HTTPException(status_code=409, detail=f"Asset '{a.asset_code}' has depreciation or a disposal posted — it stays in the register. Dispose of it instead.")
    db.delete(a)
    write_audit(db, "fixed_asset", asset_id, "deleted", user, f"{who(user)} deleted asset '{a.asset_code}' (no postings).")
    db.commit()
    return {"ok": True}


@router.post("/{asset_id}/dispose", response_model=FixedAssetResponse)
async def dispose_asset_route(asset_id: int, payload: FixedAssetDisposePayload, db: Session = Depends(get_db),
                              user: User = Depends(require_tab_action("accounts", "fixed_assets", "edit"))):
    require_finance_manager(user, "dispose of a fixed asset")
    with service_errors(db):
        a = assets.dispose_asset(db, asset_id=asset_id, disposal_date=payload.disposal_date, proceeds=payload.proceeds,
                                 proceeds_gl_account_id=payload.proceeds_gl_account_id, user_id=user.id)
    write_audit(db, "fixed_asset", a.id, "disposed", user, f"{who(user)} disposed of asset '{a.asset_code}' for {payload.proceeds:,.2f}.")
    db.commit()
    db.refresh(a)
    return _to_response(a, db)


@router.get("/depreciation/preview")
async def depreciation_preview_route(period: str = Query(...), db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "depreciation"))):
    with service_errors(db):
        return assets.depreciation_preview(db, accounting_period=period)


@router.get("/depreciation/runs", response_model=list[DepreciationRunResponse])
async def list_runs(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "depreciation"))):
    runs = db.query(DepreciationRun).options(selectinload(DepreciationRun.lines)).order_by(DepreciationRun.accounting_period.desc(), DepreciationRun.id.desc()).all()
    return [_run_response(r, db) for r in runs]


@router.post("/depreciation/runs", response_model=DepreciationRunResponse, status_code=201)
async def run_depreciation_route(payload: DepreciationRunCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                                 user: User = Depends(require_tab_action("accounts", "depreciation", "approve"))):
    """Running depreciation goes through the approval engine ('Depreciation
    run', default: a Finance Manager). A Finance Manager's click runs it at
    once, as before; anyone else's click waits for one (202)."""
    period = payload.accounting_period
    with service_errors(db):
        req = access.submit_process(db, access.KEY_DEPRECIATION, entity_id=access.period_entity_id(period), actor=user,
                                    title=f"Depreciation run for {period}", reference=period, context={"period": period})
    if req.status == "pending":
        from app.modules.accounts import role_events_b
        role_events_b.fire(
            db, "depreciation_requested", title=f"Depreciation run for {period} waiting for approval",
            message=(f"{user.name or user.email} requested the depreciation run for {period}. A Finance Manager approves it "
                     "from the Approval panel (Finance › Fixed Assets › Depreciation) — the journal posts on approval."),
            entity_type=req.entity_type, entity_id=req.entity_id, actor=user,
            skip={s.approver_id for s in (req.steps or []) if s.approver_id}, background_tasks=background_tasks)
    db.commit()
    if req.status != "approved":
        return JSONResponse(status_code=202, content=access.pending_response(req, f"Depreciation for {period}"))
    run = (db.query(DepreciationRun).options(selectinload(DepreciationRun.lines))
           .filter(DepreciationRun.accounting_period == period, DepreciationRun.status == "posted")
           .order_by(DepreciationRun.id.desc()).first())
    return _run_response(run, db)


@router.post("/depreciation/runs/{run_id}/reverse", response_model=DepreciationRunResponse)
async def reverse_run_route(run_id: int, payload: DepreciationRunReversePayload, db: Session = Depends(get_db),
                            user: User = Depends(require_feature_action("accounts", "depreciation", "reversal", "cancel"))):
    require_finance_manager(user, "reverse a depreciation run")
    with service_errors(db):
        run = assets.reverse_depreciation_run(db, run_id=run_id, reason=payload.reason, user_id=user.id)
    write_audit(db, "depreciation_run", run.id, "reversed", user, f"{who(user)} reversed depreciation for {run.accounting_period}: {payload.reason}")
    db.commit()
    run = db.query(DepreciationRun).options(selectinload(DepreciationRun.lines)).filter(DepreciationRun.id == run.id).first()
    return _run_response(run, db)
