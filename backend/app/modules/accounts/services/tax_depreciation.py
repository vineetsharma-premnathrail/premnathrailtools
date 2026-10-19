"""Parallel tax depreciation (Income-tax Act 1961, Sec 32 + Rule 5) and the
deferred-tax difference (AS 22 / Ind AS 12). Report only — no GL posting;
the books keep Schedule II depreciation (services/assets.py).

Per block of assets, per financial year:
    opening WDV                   (stored once for the first year, then
                                   carried forward from the computed closing)
  + additions put to use >= 180 days in the year   -> full rate
  + additions put to use <  180 days in the year   -> half rate (2nd proviso
                                                      to Sec 32(1)(ii))
  - money receivable on assets of the block sold / scrapped in the year
    (reduced first from the full-rate base)
  = WDV for depreciation; depreciation = full base x rate + half base x rate / 2
  closing WDV = WDV - depreciation
If the sale money is more than the block's WDV, the excess is a short-term
capital gain (Sec 50) and the WDV is nil. If the block has no asset left at
year end but WDV remains, it is a short-term capital loss (Sec 50) and no
depreciation is allowed.

Additional depreciation (Sec 32(1)(iia)) is not computed — it is not
available to a company that opts for Sec 115BAA."""
from __future__ import annotations

from datetime import date, timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.accounts.models.asset_accounting import ITAssetBlock, ITBlockBalance, AssetRetirement
from app.modules.accounts.models.fixed_asset import FixedAsset, DepreciationRun, DepreciationRunLine
from app.modules.accounts.services import fiscal

HALF_RATE_DAYS = 180
# 22% (Sec 115BAA) + 10% surcharge + 4% cess.
DEFAULT_TAX_RATE_PCT = 25.168


def _r(x) -> float:
    return round(float(x or 0), 2)


def fy_bounds(db: Session, fy_code: str) -> fiscal.FiscalYear:
    code = (fy_code or "").strip()
    try:
        from app.modules.organization.models.company_financial_year import CompanyFinancialYear
        for fy in db.query(CompanyFinancialYear).all():
            if fiscal.fy_code(fy.start_date, fy.end_date) == code:
                return fiscal.FiscalYear(code, fy.start_date, fy.end_date, (fy.status or "open").lower(), fy.lock_date, fy.id)
    except Exception:  # noqa: BLE001 — organization module absent: fall back to April-March
        pass
    try:
        start_year = int(code[:4])
    except ValueError:
        raise ValueError(f"'{fy_code}' isn't a financial year — use the FY code, e.g. 2026-27.") from None
    return fiscal.derived_fiscal_year(date(start_year, 4, 1))


def _fy_for(db: Session, d: date) -> fiscal.FiscalYear:
    try:
        return fiscal.fiscal_year_for(db, d)
    except ValueError:
        return fiscal.derived_fiscal_year(d)


def _prev_fy(db: Session, fy: fiscal.FiscalYear) -> fiscal.FiscalYear:
    return _fy_for(db, fy.start_date - timedelta(days=1))


def original_cost(db: Session, a: FixedAsset) -> float:
    if a.original_cost is not None:
        return _r(a.original_cost)
    retired = db.query(func.coalesce(func.sum(AssetRetirement.retired_cost), 0)).filter(
        AssetRetirement.fixed_asset_id == a.id, AssetRetirement.status == "posted").scalar()
    return _r(float(a.cost) + float(retired or 0))


def _sales_in(db: Session, asset_ids: list[int], start: date, end: date) -> list[dict]:
    """Money receivable on assets of the block retired in the year: posted
    retirements, plus legacy full disposals made before retirements existed."""
    if not asset_ids:
        return []
    out = []
    rets = db.query(AssetRetirement).filter(AssetRetirement.fixed_asset_id.in_(asset_ids), AssetRetirement.status == "posted",
                                            AssetRetirement.retirement_date >= start, AssetRetirement.retirement_date <= end).all()
    with_rets = {r for (r,) in db.query(AssetRetirement.fixed_asset_id).filter(AssetRetirement.fixed_asset_id.in_(asset_ids)).distinct().all()}
    for r in rets:
        out.append({"fixed_asset_id": r.fixed_asset_id, "date": r.retirement_date, "amount": _r(r.sale_value),
                    "retirement_id": r.id, "percent": float(r.retire_percent)})
    for a in db.query(FixedAsset).filter(FixedAsset.id.in_(asset_ids), FixedAsset.status == "disposed",
                                         FixedAsset.disposal_date >= start, FixedAsset.disposal_date <= end).all():
        if a.id not in with_rets:
            out.append({"fixed_asset_id": a.id, "date": a.disposal_date, "amount": _r(a.disposal_proceeds), "retirement_id": None, "percent": 100.0})
    return out


def _block_year(db: Session, block: ITAssetBlock, fy: fiscal.FiscalYear, opening: float, assets: list[FixedAsset]) -> dict:
    rate = float(block.rate_pct)
    add_full, add_half, additions = 0.0, 0.0, []
    for a in assets:
        if fy.start_date <= a.put_to_use_date <= fy.end_date:
            cost = original_cost(db, a)
            days = (fy.end_date - a.put_to_use_date).days + 1
            half = days < HALF_RATE_DAYS
            if half:
                add_half += cost
            else:
                add_full += cost
            additions.append({"fixed_asset_id": a.id, "asset_code": a.asset_code, "name": a.name, "put_to_use_date": a.put_to_use_date,
                              "cost": cost, "days_used": days, "half_rate": half})
    sales = _sales_in(db, [a.id for a in assets], fy.start_date, fy.end_date)
    deductions = _r(sum(s["amount"] for s in sales))
    full_base = _r(opening + add_full - deductions)
    half_base = _r(add_half)
    if full_base < 0:
        half_base = _r(half_base + full_base)
        full_base = 0.0
    stcg = 0.0
    if half_base < 0:
        stcg = _r(-half_base)
        half_base = 0.0
    # Block ceases to exist: nothing left in it at year end.
    alive = [a for a in assets if a.put_to_use_date <= fy.end_date
             and not (a.status == "disposed" and a.disposal_date and a.disposal_date <= fy.end_date)]
    stcl = 0.0
    if not alive and (full_base + half_base) > 0 and (sales or opening):
        stcl = _r(full_base + half_base)
        full_base = half_base = 0.0
    dep_full = _r(full_base * rate / 100)
    dep_half = _r(half_base * rate / 200)
    closing = _r(full_base + half_base - dep_full - dep_half)
    return {
        "block_id": block.id, "block_code": block.code, "block_name": block.name, "rate_pct": rate,
        "opening_wdv": _r(opening), "additions_full_rate": _r(add_full), "additions_half_rate": _r(add_half),
        "deductions": deductions, "wdv_for_depreciation": _r(full_base + half_base),
        "depreciation_full_rate": dep_full, "depreciation_half_rate": dep_half, "depreciation": _r(dep_full + dep_half),
        "closing_wdv": closing, "short_term_capital_gain": stcg, "short_term_capital_loss": stcl,
        "additions": additions, "sales": sales,
    }


def _block_assets(db: Session, block_id: int) -> list[FixedAsset]:
    return db.query(FixedAsset).filter(FixedAsset.it_block_id == block_id).order_by(FixedAsset.put_to_use_date.asc()).all()


def block_schedule(db: Session, block: ITAssetBlock, fy: fiscal.FiscalYear) -> dict:
    """Walks forward from the earliest year the block has a stored opening
    or an asset, carrying each closing WDV into the next year's opening; a
    stored opening for a year always wins (it is the tax-audit figure)."""
    assets = _block_assets(db, block.id)
    stored = {b.fy_code: _r(b.opening_wdv) for b in db.query(ITBlockBalance).filter(ITBlockBalance.block_id == block.id).all()}
    starts = [_fy_for(db, assets[0].put_to_use_date)] if assets else []
    starts += [fy_bounds(db, c) for c in stored]
    starts = [y for y in starts if y.start_date <= fy.start_date]
    y = min(starts, key=lambda x: x.start_date) if starts else fy
    years = []
    while y.start_date <= fy.start_date and len(years) < 80:
        years.append(y)
        y = _fy_for(db, y.end_date + timedelta(days=1))
    opening = 0.0
    row = None
    for y in years:
        opening = stored.get(y.code, opening)
        row = _block_year(db, block, y, opening, assets)
        opening = row["closing_wdv"]
    row["fy_code"] = fy.code
    row["opening_entered"] = fy.code in stored
    return row


def it_depreciation_schedule(db: Session, *, fy_code: str) -> dict:
    fy = fy_bounds(db, fy_code)
    blocks = db.query(ITAssetBlock).order_by(ITAssetBlock.code.asc()).all()
    rows = [block_schedule(db, b, fy) for b in blocks]
    rows = [r for r in rows if any(r[k] for k in ("opening_wdv", "additions_full_rate", "additions_half_rate", "deductions", "closing_wdv"))
            or r["block_id"] in {b.id for b in blocks if b.is_active}]
    unmapped = db.query(FixedAsset).filter(FixedAsset.it_block_id.is_(None), FixedAsset.status == "active",
                                           FixedAsset.put_to_use_date <= fy.end_date).all()
    totals = {k: _r(sum(r[k] for r in rows)) for k in ("opening_wdv", "additions_full_rate", "additions_half_rate", "deductions",
                                                       "depreciation", "closing_wdv", "short_term_capital_gain", "short_term_capital_loss")}
    return {"fy_code": fy.code, "start_date": fy.start_date, "end_date": fy.end_date, "blocks": rows, "totals": totals,
            "unmapped_assets": [{"fixed_asset_id": a.id, "asset_code": a.asset_code, "name": a.name} for a in unmapped]}


def book_value_as_of(db: Session, a: FixedAsset, as_of: date) -> float:
    """Schedule II net book value of one asset on a date, from the posted
    depreciation runs and retirements (not today's register figure)."""
    if a.put_to_use_date > as_of and a.purchase_date > as_of:
        return 0.0
    if a.status == "disposed" and a.disposal_date and a.disposal_date <= as_of:
        return 0.0
    rets = db.query(AssetRetirement).filter(AssetRetirement.fixed_asset_id == a.id, AssetRetirement.status == "posted",
                                            AssetRetirement.retirement_date <= as_of).all()
    cost = original_cost(db, a) - sum(float(r.retired_cost) for r in rets)
    run_dep = (db.query(func.coalesce(func.sum(DepreciationRunLine.amount), 0))
               .join(DepreciationRun, DepreciationRunLine.depreciation_run_id == DepreciationRun.id)
               .filter(DepreciationRunLine.fixed_asset_id == a.id, DepreciationRun.status == "posted",
                       DepreciationRun.run_date <= as_of).scalar())
    acc = (float(a.opening_accumulated_depreciation or 0) + float(run_dep or 0)
           + sum(float(r.catch_up_depreciation) - float(r.retired_accumulated_depreciation) for r in rets))
    return _r(cost - acc)


def deferred_tax(db: Session, *, fy_code: str, tax_rate_pct: float | None = None) -> dict:
    """Timing difference per block at FY end: book WDV (Schedule II) minus
    tax WDV. Book > tax = deferred tax liability; book < tax = deferred tax
    asset (recognise only with reasonable certainty, AS 22 para 17)."""
    rate = float(tax_rate_pct if tax_rate_pct is not None else DEFAULT_TAX_RATE_PCT)
    if not 0 < rate < 100:
        raise ValueError("The tax rate must be between 0 and 100% (25.168% for a company under Sec 115BAA).")

    def _year(code: str) -> dict:
        sched = it_depreciation_schedule(db, fy_code=code)
        end = sched["end_date"]
        rows = []
        for b in sched["blocks"]:
            book = _r(sum(book_value_as_of(db, a, end) for a in _block_assets(db, b["block_id"])))
            diff = _r(book - b["closing_wdv"])
            rows.append({"block_id": b["block_id"], "block_code": b["block_code"], "block_name": b["block_name"],
                         "book_wdv": book, "tax_wdv": b["closing_wdv"], "difference": diff,
                         "deferred_tax": _r(diff * rate / 100), "nature": "DTL" if diff > 0 else ("DTA" if diff < 0 else "-")})
        unmapped_book = _r(sum(book_value_as_of(db, a, end) for a in db.query(FixedAsset).filter(FixedAsset.it_block_id.is_(None)).all()))
        return {"sched": sched, "rows": rows, "unmapped_book": unmapped_book,
                "net": _r(sum(r["deferred_tax"] for r in rows))}

    cur = _year(fy_code)
    prev_code = _prev_fy(db, fy_bounds(db, fy_code)).code
    prev = _year(prev_code)
    return {
        "fy_code": cur["sched"]["fy_code"], "as_of": cur["sched"]["end_date"], "tax_rate_pct": rate, "rows": cur["rows"],
        "total_book_wdv": _r(sum(r["book_wdv"] for r in cur["rows"])), "total_tax_wdv": _r(sum(r["tax_wdv"] for r in cur["rows"])),
        "total_difference": _r(sum(r["difference"] for r in cur["rows"])),
        "net_deferred_tax": cur["net"], "previous_fy_code": prev_code, "previous_net_deferred_tax": prev["net"],
        # P&L charge (+) / credit (-) for the year on the fixed-asset timing difference.
        "movement": _r(cur["net"] - prev["net"]),
        "unmapped_book_value": cur["unmapped_book"],
        "unmapped_assets": cur["sched"]["unmapped_assets"],
    }
