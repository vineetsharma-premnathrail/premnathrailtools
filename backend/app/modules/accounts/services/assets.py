"""Fixed-asset register, depreciation and disposal (Companies Act 2013, Sch. II).

Charge for a stretch of days (pro-rata by days, as Schedule II requires for
additions/disposals during the year):
    SLM: (cost - residual) / (useful life in years) x days / 365
    WDV: opening book value x rate% x days / 365
Never past cost - residual. A monthly run charges every active asset from the
day after its last charge to month end, so a missed month catches up.

Disposal: charge depreciation up to the disposal date, then
    Dr Accumulated Depreciation (all of it)   Dr proceeds ledger (sale value)
      Cr asset cost ledger (cost)             and the balance to Profit/Loss on Sale."""
from datetime import date, timedelta
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models.fixed_asset import FixedAsset, DepreciationRun, DepreciationRunLine, DEPRECIATION_METHODS
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.services import fiscal
from app.modules.accounts.services.ledgers import ledger_id_for


def _book_value(a: FixedAsset) -> float:
    return round(float(a.cost) - float(a.accumulated_depreciation or 0), 2)


def charge_for(a: FixedAsset, from_date: date, to_date: date) -> tuple[float, int]:
    """(amount, days) of depreciation for from_date..to_date inclusive."""
    start = max(from_date, a.put_to_use_date)
    if to_date < start:
        return 0.0, 0
    days = (to_date - start).days + 1
    depreciable_left = round(_book_value(a) - float(a.residual_value or 0), 2)
    if depreciable_left <= 0:
        return 0.0, days
    if a.depreciation_method == "slm":
        annual = (float(a.cost) - float(a.residual_value or 0)) / (a.useful_life_months / 12)
    else:
        annual = _book_value(a) * float(a.wdv_rate_pct) / 100
    return round(min(annual * days / 365, depreciable_left), 2), days


def validate_asset_fields(db: Session, data: dict) -> None:
    method = data.get("depreciation_method") or "slm"
    if method not in DEPRECIATION_METHODS:
        raise ValueError("Depreciation method must be 'slm' (straight line) or 'wdv' (written-down value).")
    if method == "slm" and not (data.get("useful_life_months") or 0) > 0:
        raise ValueError("Straight-line depreciation needs the useful life in months (Schedule II, e.g. plant & machinery 15 years = 180).")
    if method == "wdv" and not (0 < float(data.get("wdv_rate_pct") or 0) < 100):
        raise ValueError("WDV depreciation needs an annual rate between 0 and 100% (e.g. 18.1% for plant & machinery over 15 years at 5% residual).")
    cost = float(data.get("cost") or 0)
    if cost <= 0:
        raise ValueError("Asset cost must be greater than zero.")
    residual = float(data.get("residual_value") or 0)
    if residual < 0 or residual >= cost:
        raise ValueError("Residual value must be at least zero and less than cost (Schedule II caps it at 5% of cost unless justified).")
    if float(data.get("opening_accumulated_depreciation") or 0) > cost - residual:
        raise ValueError("Opening accumulated depreciation can't exceed cost minus residual value.")
    if data.get("put_to_use_date") and data.get("purchase_date") and data["put_to_use_date"] < data["purchase_date"]:
        raise ValueError("An asset can't be put to use before it was bought.")
    gl = db.query(GLAccount).filter(GLAccount.id == data.get("asset_gl_account_id")).first()
    if not gl or gl.account_type != "asset":
        raise ValueError("Pick the asset's cost ledger — a Fixed Assets ledger such as Plant & Machinery.")


def create_asset(db: Session, *, data: dict, created_by_id: int) -> FixedAsset:
    validate_asset_fields(db, data)
    if db.query(FixedAsset).filter(FixedAsset.asset_code == data["asset_code"]).first():
        raise ValueError(f"Asset code '{data['asset_code']}' already exists.")
    opening = round(float(data.get("opening_accumulated_depreciation") or 0), 2)
    asset = FixedAsset(**data, accumulated_depreciation=opening, created_by_id=created_by_id)
    if asset.original_cost is None:
        asset.original_cost = asset.cost
    db.add(asset)
    db.flush()
    return asset


def run_depreciation(db: Session, *, accounting_period: str, created_by_id: int) -> DepreciationRun:
    from app.modules.accounts.service import post_journal_entry

    start, end = fiscal.period_bounds(accounting_period)
    existing = db.query(DepreciationRun).filter(
        DepreciationRun.accounting_period == accounting_period, DepreciationRun.status == "posted",
    ).first()
    if existing:
        raise ValueError(f"Depreciation for {accounting_period} has already been run ({existing.total_amount:,.2f}). Reverse that run first to redo it.")
    later = db.query(DepreciationRun).filter(DepreciationRun.accounting_period > accounting_period, DepreciationRun.status == "posted").first()
    if later:
        raise ValueError(f"Depreciation for a later month ({later.accounting_period}) is already posted — runs must go in month order.")

    assets = db.query(FixedAsset).filter(FixedAsset.status == "active", FixedAsset.put_to_use_date <= end).all()
    default_exp, default_acc = ledger_id_for(db, "depreciation_expense"), ledger_id_for(db, "accumulated_depreciation")
    charges = []
    for a in assets:
        from_date = (a.depreciated_up_to + timedelta(days=1)) if a.depreciated_up_to else a.put_to_use_date
        if from_date > end:
            continue
        amount, days = charge_for(a, from_date, end)
        if amount > 0:
            charges.append((a, amount, days))
    if not charges:
        raise ValueError(f"No asset has depreciation due for {accounting_period} — every active asset is fully depreciated, not yet in use, or already charged.")

    run = DepreciationRun(accounting_period=accounting_period, run_date=end, created_by_id=created_by_id)
    db.add(run)
    try:
        db.flush()
    except IntegrityError:
        # uq_depreciation_run_one_posted_per_period: a simultaneous run won.
        raise ValueError(f"Depreciation for {accounting_period} was just run by someone else — reload the page; "
                         f"nothing was charged twice.") from None
    grouped: dict[tuple, float] = {}
    for a, amount, days in charges:
        db.add(DepreciationRunLine(depreciation_run_id=run.id, fixed_asset_id=a.id, amount=amount, days=days,
                                   book_value_before=_book_value(a), previous_depreciated_up_to=a.depreciated_up_to))
        key = (a.depreciation_expense_gl_account_id or default_exp, a.accumulated_depreciation_gl_account_id or default_acc, a.cost_center_id)
        grouped[key] = grouped.get(key, 0.0) + amount
        a.accumulated_depreciation = round(float(a.accumulated_depreciation) + amount, 2)
        a.depreciated_up_to = end
    lines = []
    for (exp, acc, cc), amount in grouped.items():
        lines.append({"gl_account_id": exp, "debit_amount": round(amount, 2), "cost_center_id": cc, "remarks": f"Depreciation {accounting_period}"})
        lines.append({"gl_account_id": acc, "credit_amount": round(amount, 2), "remarks": f"Depreciation {accounting_period}"})
    run.total_amount = round(sum(c[1] for c in charges), 2)
    entry = post_journal_entry(
        db, posting_date=end, lines=lines, posting_type="depreciation",
        description=f"Depreciation for {accounting_period} — {len(charges)} asset(s)",
        reference_document_type="depreciation_run", reference_document_id=run.id, created_by_id=created_by_id,
    )
    run.journal_entry_id = entry.id
    db.flush()
    return run


def reverse_depreciation_run(db: Session, *, run_id: int, reason: str, user_id: int) -> DepreciationRun:
    from app.modules.accounts.service import reverse_journal_entry, lock_row

    run = lock_row(db, DepreciationRun, run_id, selectinload(DepreciationRun.lines))
    if not run or run.status != "posted":
        raise ValueError("Only a posted depreciation run can be reversed.")
    later = db.query(DepreciationRun).filter(DepreciationRun.accounting_period > run.accounting_period, DepreciationRun.status == "posted").first()
    if later:
        raise ValueError(f"Reverse the later run for {later.accounting_period} first — runs are undone newest first.")
    for line in run.lines:
        a = db.query(FixedAsset).filter(FixedAsset.id == line.fixed_asset_id).first()
        if a.status == "disposed":
            raise ValueError(f"Asset '{a.asset_code}' has since been disposed — its depreciation can't be reversed.")
        from app.modules.accounts.models.asset_accounting import AssetRetirement
        if db.query(AssetRetirement.id).filter(AssetRetirement.fixed_asset_id == a.id, AssetRetirement.status == "posted").first():
            raise ValueError(f"Part of asset '{a.asset_code}' has since been retired — its earlier depreciation can't be reversed.")
        a.accumulated_depreciation = round(float(a.accumulated_depreciation) - float(line.amount), 2)
        a.depreciated_up_to = line.previous_depreciated_up_to
    reverse_journal_entry(db, journal_entry_id=run.journal_entry_id, reason=reason, reversed_by_id=user_id, reversal_date=run.run_date)
    run.status = "reversed"
    db.flush()
    return run


def dispose_asset(db: Session, *, asset_id: int, disposal_date: date, proceeds: float, proceeds_gl_account_id: int | None,
                  user_id: int) -> FixedAsset:
    from app.modules.accounts.service import post_journal_entry, lock_row

    a = lock_row(db, FixedAsset, asset_id)
    if not a:
        raise ValueError("Asset not found.")
    if a.status != "active":
        raise ValueError(f"Asset '{a.asset_code}' is already {a.status}.")
    if disposal_date < a.put_to_use_date:
        raise ValueError("Disposal can't be before the asset was put to use.")
    if a.depreciated_up_to and disposal_date <= a.depreciated_up_to:
        raise ValueError(f"Depreciation is already charged up to {a.depreciated_up_to:%d-%b-%Y} — dispose after that date, or reverse the later run.")
    proceeds = round(float(proceeds or 0), 2)
    if proceeds < 0:
        raise ValueError("Sale proceeds can't be negative.")
    if proceeds > 0 and not proceeds_gl_account_id:
        raise ValueError("Pick the ledger the sale money went to (the bank, or the buyer's ledger if not yet received).")
    if proceeds > 0:
        proceeds_gl = db.query(GLAccount).filter(GLAccount.id == proceeds_gl_account_id).first()
        if proceeds_gl is not None and proceeds_gl.is_control_account:
            raise ValueError(f"'{proceeds_gl.code} — {proceeds_gl.name}' is a party control ledger — a sale to a buyer goes "
                             f"through Retire / Sell (it raises the GST invoice to the customer). Use the bank ledger "
                             f"here only when the money is already in.")

    exp = a.depreciation_expense_gl_account_id or ledger_id_for(db, "depreciation_expense")
    acc = a.accumulated_depreciation_gl_account_id or ledger_id_for(db, "accumulated_depreciation")
    from_date = (a.depreciated_up_to + timedelta(days=1)) if a.depreciated_up_to else a.put_to_use_date
    catch_up, _ = charge_for(a, from_date, disposal_date)
    lines = []
    ref = f"Disposal of {a.asset_code} {a.name}"
    if catch_up > 0:
        lines += [{"gl_account_id": exp, "debit_amount": catch_up, "cost_center_id": a.cost_center_id, "remarks": f"Depreciation to disposal — {ref}"},
                  {"gl_account_id": acc, "credit_amount": catch_up, "remarks": f"Depreciation to disposal — {ref}"}]
    accumulated = round(float(a.accumulated_depreciation) + catch_up, 2)
    book_value = round(float(a.cost) - accumulated, 2)
    if accumulated > 0:
        lines.append({"gl_account_id": acc, "debit_amount": accumulated, "remarks": ref})
    if proceeds > 0:
        lines.append({"gl_account_id": proceeds_gl_account_id, "debit_amount": proceeds, "remarks": ref})
    lines.append({"gl_account_id": a.asset_gl_account_id, "credit_amount": float(a.cost), "remarks": ref})
    gain = round(proceeds - book_value, 2)
    if gain > 0:
        lines.append({"gl_account_id": ledger_id_for(db, "asset_disposal_gain"), "credit_amount": gain, "remarks": ref})
    elif gain < 0:
        lines.append({"gl_account_id": ledger_id_for(db, "asset_disposal_loss"), "debit_amount": -gain, "remarks": ref})

    entry = post_journal_entry(db, posting_date=disposal_date, lines=lines, posting_type="asset_disposal",
                               description=f"{ref} — proceeds {proceeds:,.2f}, book value {book_value:,.2f}",
                               reference_document_type="fixed_asset", reference_document_id=a.id, created_by_id=user_id)
    a.accumulated_depreciation = accumulated
    a.depreciated_up_to = disposal_date
    a.status = "disposed"
    a.disposal_date = disposal_date
    a.disposal_proceeds = proceeds
    a.disposal_journal_entry_id = entry.id
    db.flush()
    return a


def depreciation_preview(db: Session, *, accounting_period: str) -> list[dict]:
    _, end = fiscal.period_bounds(accounting_period)
    out = []
    for a in db.query(FixedAsset).filter(FixedAsset.status == "active", FixedAsset.put_to_use_date <= end).all():
        from_date = (a.depreciated_up_to + timedelta(days=1)) if a.depreciated_up_to else a.put_to_use_date
        amount, days = charge_for(a, from_date, end) if from_date <= end else (0.0, 0)
        out.append({"fixed_asset_id": a.id, "asset_code": a.asset_code, "name": a.name, "book_value": _book_value(a),
                    "from_date": from_date, "to_date": end, "days": days, "amount": amount})
    return out
