"""Asset accounting: capitalisation from purchase invoices and capital
orders (ABZON / AIBU), register-to-ledger reconciliation, retirement
(ABAVN / ABAON), and the parallel Income-tax depreciation + deferred tax."""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.asset_accounting import AssetRetirement, ITAssetBlock, ITBlockBalance
from app.modules.accounts.models.fixed_asset import FixedAsset
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.schemas.asset_accounting import (
    AssetFromInvoiceLineCreate, AssetFromOrderCreate, AssetRetirementCreate, AssetTaxBlockPayload,
    ITAssetBlockCreate, ITAssetBlockUpdate, ITBlockOpeningPayload, AssetRetirementResponse, ITAssetBlockResponse,
)
from app.modules.accounts.schemas.fixed_asset import FixedAssetResponse
from app.modules.accounts.services import asset_accounting, tax_depreciation
from app.modules.accounts.routes._common import write_audit, who, service_errors, require_finance_manager
from app.modules.accounts.routes.fixed_assets import _to_response as _asset_response

router = APIRouter(prefix="/accounts/asset-accounting", tags=["Accounts"])


def _retirement_response(r: AssetRetirement, db: Session) -> AssetRetirementResponse:
    a = db.query(FixedAsset).filter(FixedAsset.id == r.fixed_asset_id).first()
    inv = db.query(ARTransaction).filter(ARTransaction.id == r.ar_transaction_id).first() if r.ar_transaction_id else None
    je = db.query(JournalEntry).filter(JournalEntry.id == r.journal_entry_id).first() if r.journal_entry_id else None
    cust = None
    if r.customer_id:
        from app.modules.crm.models.organization import Organization
        cust = db.query(Organization).filter(Organization.id == r.customer_id).first()
    return AssetRetirementResponse.model_validate(r).model_copy(update={
        "asset_code": a.asset_code if a else None, "asset_name": a.name if a else None,
        "customer_name": cust.name if cust else None, "ar_invoice_number": inv.invoice_number if inv else None,
        "ar_status": inv.status if inv else None, "journal_entry_number": je.entry_number if je else None,
    })


# ── capitalisation (ABZON / F-90, AIBU) ─────────────────────────────────

@router.get("/capitalisation-queue")
async def capitalisation_queue_route(db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "fixed_assets", "capitalisation", "view"))):
    return asset_accounting.capitalisation_queue(db)


def _master(payload) -> dict:
    return payload.model_dump(exclude={"vendor_invoice_line_id", "internal_order_id", "settlement_date", "amount"})


@router.post("/capitalise/invoice-line", response_model=FixedAssetResponse, status_code=201)
async def capitalise_invoice_line_route(payload: AssetFromInvoiceLineCreate, db: Session = Depends(get_db),
                                        user: User = Depends(require_feature_action("accounts", "fixed_assets", "capitalisation", "create"))):
    with service_errors(db):
        a = asset_accounting.create_asset_from_invoice_line(db, vendor_invoice_line_id=payload.vendor_invoice_line_id,
                                                            data=_master(payload), user_id=user.id)
    write_audit(db, "fixed_asset", a.id, "created", user,
                f"{who(user)} capitalised asset '{a.asset_code} — {a.name}' at {a.cost:,.2f} from a purchase-invoice line.")
    db.commit()
    db.refresh(a)
    return _asset_response(a, db)


@router.post("/capitalise/internal-order", response_model=FixedAssetResponse, status_code=201)
async def capitalise_order_route(payload: AssetFromOrderCreate, db: Session = Depends(get_db),
                                 user: User = Depends(require_feature_action("accounts", "fixed_assets", "capitalisation", "create"))):
    require_finance_manager(user, "settle a capital order into a fixed asset")
    with service_errors(db):
        a = asset_accounting.settle_internal_order(db, internal_order_id=payload.internal_order_id, settlement_date=payload.settlement_date,
                                                   data=_master(payload), amount=payload.amount, user_id=user.id)
    write_audit(db, "fixed_asset", a.id, "created", user,
                f"{who(user)} settled capital order #{payload.internal_order_id} into asset '{a.asset_code}' at {a.cost:,.2f}.")
    db.commit()
    db.refresh(a)
    return _asset_response(a, db)


@router.get("/reconciliation")
async def reconciliation_route(as_of: date | None = Query(None), db: Session = Depends(get_db),
                               _user: User = Depends(require_feature_action("accounts", "fixed_assets", "asset_reconciliation", "view"))):
    return asset_accounting.reconciliation(db, as_of=as_of)


# ── retirement (ABAVN / ABAON) ──────────────────────────────────────────

@router.get("/retirements", response_model=list[AssetRetirementResponse])
async def list_retirements(fixed_asset_id: int | None = Query(None), db: Session = Depends(get_db),
                           _user: User = Depends(require_feature_action("accounts", "fixed_assets", "retirements", "view"))):
    q = db.query(AssetRetirement)
    if fixed_asset_id:
        q = q.filter(AssetRetirement.fixed_asset_id == fixed_asset_id)
    return [_retirement_response(r, db) for r in q.order_by(AssetRetirement.retirement_date.desc(), AssetRetirement.id.desc()).all()]


@router.post("/assets/{asset_id}/retire", response_model=AssetRetirementResponse, status_code=201)
async def retire_route(asset_id: int, payload: AssetRetirementCreate, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("accounts", "fixed_assets", "retirements", "create"))):
    require_finance_manager(user, "retire or sell a fixed asset")
    with service_errors(db):
        r = asset_accounting.retire_asset(db, asset_id=asset_id, user_id=user.id, **payload.model_dump())
    write_audit(db, "fixed_asset", asset_id, "retired", user,
                f"{who(user)} {'sold' if r.retirement_type == 'sale' else 'scrapped'} {float(r.retire_percent):g}% of the asset "
                f"(cost {r.retired_cost:,.2f}, {'gain' if r.gain_loss >= 0 else 'loss'} {abs(r.gain_loss):,.2f}).")
    db.commit()
    db.refresh(r)
    return _retirement_response(r, db)


@router.patch("/assets/{asset_id}/tax-block", response_model=FixedAssetResponse)
async def set_tax_block_route(asset_id: int, payload: AssetTaxBlockPayload, db: Session = Depends(get_db),
                              user: User = Depends(require_tab_action("accounts", "tax_depreciation", "edit"))):
    a = db.query(FixedAsset).filter(FixedAsset.id == asset_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asset not found — reload the register.")
    if payload.it_block_id and not db.query(ITAssetBlock).filter(ITAssetBlock.id == payload.it_block_id).first():
        raise HTTPException(status_code=400, detail="That Income-tax block doesn't exist — pick it again from the list.")
    a.it_block_id = payload.it_block_id
    write_audit(db, "fixed_asset", a.id, "updated", user, f"{who(user)} set the Income-tax block of '{a.asset_code}'.")
    db.commit()
    db.refresh(a)
    return _asset_response(a, db)


# ── Income-tax blocks, tax depreciation, deferred tax ───────────────────

def _block_response(b: ITAssetBlock, db: Session) -> ITAssetBlockResponse:
    n = db.query(func.count(FixedAsset.id)).filter(FixedAsset.it_block_id == b.id).scalar() or 0
    return ITAssetBlockResponse.model_validate(b).model_copy(update={"asset_count": n})


@router.get("/it-blocks", response_model=list[ITAssetBlockResponse])
async def list_blocks(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "tax_depreciation"))):
    return [_block_response(b, db) for b in db.query(ITAssetBlock).order_by(ITAssetBlock.code.asc()).all()]


def _check_rate(rate: float) -> None:
    if not 0 < float(rate) <= 100:
        raise HTTPException(status_code=400, detail="The block rate must be between 0 and 100% (e.g. 15 for plant & machinery).")


@router.post("/it-blocks", response_model=ITAssetBlockResponse, status_code=201)
async def create_block(payload: ITAssetBlockCreate, db: Session = Depends(get_db),
                       user: User = Depends(require_tab_action("accounts", "tax_depreciation", "edit"))):
    _check_rate(payload.rate_pct)
    code = payload.code.strip().upper()
    if not code or db.query(ITAssetBlock).filter(ITAssetBlock.code == code).first():
        raise HTTPException(status_code=400, detail=f"Block code '{code}' is blank or already used — pick another code.")
    b = ITAssetBlock(code=code, name=payload.name.strip(), rate_pct=payload.rate_pct, is_active=payload.is_active)
    db.add(b)
    db.flush()
    write_audit(db, "it_asset_block", b.id, "created", user, f"{who(user)} added Income-tax block {code} @ {payload.rate_pct:g}%.")
    db.commit()
    return _block_response(b, db)


@router.patch("/it-blocks/{block_id}", response_model=ITAssetBlockResponse)
async def update_block(block_id: int, payload: ITAssetBlockUpdate, db: Session = Depends(get_db),
                       user: User = Depends(require_tab_action("accounts", "tax_depreciation", "edit"))):
    b = db.query(ITAssetBlock).filter(ITAssetBlock.id == block_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Income-tax block not found — reload the page.")
    data = payload.model_dump(exclude_unset=True)
    if "rate_pct" in data:
        _check_rate(data["rate_pct"])
    for k, v in data.items():
        setattr(b, k, v)
    write_audit(db, "it_asset_block", b.id, "updated", user, f"{who(user)} updated Income-tax block {b.code}.")
    db.commit()
    return _block_response(b, db)


@router.put("/it-blocks/{block_id}/opening")
async def set_block_opening(block_id: int, payload: ITBlockOpeningPayload, db: Session = Depends(get_db),
                            user: User = Depends(require_tab_action("accounts", "tax_depreciation", "edit"))):
    b = db.query(ITAssetBlock).filter(ITAssetBlock.id == block_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Income-tax block not found — reload the page.")
    if payload.opening_wdv < 0:
        raise HTTPException(status_code=400, detail="Opening WDV can't be negative — enter the block's WDV from the last tax audit report.")
    with service_errors(db):
        fy = tax_depreciation.fy_bounds(db, payload.fy_code)
    row = db.query(ITBlockBalance).filter(ITBlockBalance.block_id == b.id, ITBlockBalance.fy_code == fy.code).first()
    if row:
        row.opening_wdv = round(payload.opening_wdv, 2)
    else:
        db.add(ITBlockBalance(block_id=b.id, fy_code=fy.code, opening_wdv=round(payload.opening_wdv, 2), created_by_id=user.id))
    write_audit(db, "it_asset_block", b.id, "updated", user, f"{who(user)} set the {fy.code} opening WDV of block {b.code} to {payload.opening_wdv:,.2f}.")
    db.commit()
    return {"ok": True, "fy_code": fy.code}


@router.get("/it-schedule")
async def it_schedule_route(fy: str = Query(...), db: Session = Depends(get_db),
                            _user: User = Depends(require_tab_access("accounts", "tax_depreciation"))):
    with service_errors(db):
        return tax_depreciation.it_depreciation_schedule(db, fy_code=fy)


@router.get("/deferred-tax")
async def deferred_tax_route(fy: str = Query(...), tax_rate_pct: float | None = Query(None), db: Session = Depends(get_db),
                             _user: User = Depends(require_tab_access("accounts", "tax_depreciation"))):
    with service_errors(db):
        return tax_depreciation.deferred_tax(db, fy_code=fy, tax_rate_pct=tax_rate_pct)
