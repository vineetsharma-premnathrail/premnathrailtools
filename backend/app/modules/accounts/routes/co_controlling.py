"""Finance › Controlling — KP06 cost-centre planning + plan vs actual,
KL01/KP26 activity types and rates, KSU5/KSV5 assessment & distribution
cycles, KGI2/KGI4 costing sheet and overhead runs. Logic in
services/co_planning.py, co_activity.py, co_allocation.py, co_overhead.py.

Permission Matrix tabs (Finance & Accounting › Controlling): co_planning,
activity_rates, allocations, overhead. `approve` = lock/unlock a plan and
post or reverse a run; a test run needs only view."""
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.accounts.models.co_activity import CoActivityRate
from app.modules.accounts.models.co_allocation import CO_ALLOCATION_BASES, CO_ALLOCATION_METHODS, CoAllocationCycle
from app.modules.accounts.models.co_overhead import CoCostingSheetRate
from app.modules.accounts.routes._common import service_errors, write_audit
from app.modules.accounts.schemas.co import (
    CoActivityRatePayload, CoAllocationCyclePayload, CoCostingSheetRatePayload, CoPlanGridPayload,
    CoPlanVersionCreate, CoPlanVersionUpdate, CoReasonPayload, CoRunPayload,
)
from app.modules.accounts.services import co_activity, co_allocation, co_overhead, co_planning
from app.modules.main.models.user import User

router = APIRouter(prefix="/accounts/co", tags=["Accounts — Controlling"])

_MAX_UPLOAD = 5 * 1024 * 1024
_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# ── KP06 planning ────────────────────────────────────────────────────────

@router.get("/plan-versions")
async def list_plan_versions(financial_year: str | None = Query(None), db: Session = Depends(get_db),
                             _user: User = Depends(require_tab_access("accounts", "co_planning"))):
    return co_planning.list_versions(db, financial_year)


@router.post("/plan-versions", status_code=201)
async def create_plan_version(payload: CoPlanVersionCreate, db: Session = Depends(get_db),
                              user: User = Depends(require_tab_action("accounts", "co_planning", "create"))):
    with service_errors(db):
        v = co_planning.create_version(db, **payload.model_dump(), created_by_id=user.id)
        write_audit(db, "co_plan_version", v.id, "create", user, f"Plan version {v.code} ({v.financial_year}) created")
        db.commit()
        return co_planning.version_row(db, v)


@router.patch("/plan-versions/{version_id}")
async def update_plan_version(version_id: int, payload: CoPlanVersionUpdate, db: Session = Depends(get_db),
                              user: User = Depends(require_tab_action("accounts", "co_planning", "edit"))):
    with service_errors(db):
        v = co_planning.update_version(db, version_id, **payload.model_dump(exclude_unset=True))
        write_audit(db, "co_plan_version", v.id, "update", user, f"Plan version {v.code} updated")
        db.commit()
        return co_planning.version_row(db, v)


@router.delete("/plan-versions/{version_id}")
async def delete_plan_version(version_id: int, db: Session = Depends(get_db),
                              user: User = Depends(require_tab_action("accounts", "co_planning", "delete"))):
    with service_errors(db):
        co_planning.delete_version(db, version_id)
        write_audit(db, "co_plan_version", version_id, "delete", user, "Plan version deleted")
        db.commit()
        return {"ok": True}


@router.post("/plan-versions/{version_id}/lock")
async def lock_plan_version(version_id: int, db: Session = Depends(get_db),
                            user: User = Depends(require_tab_action("accounts", "co_planning", "approve"))):
    with service_errors(db):
        v = co_planning.set_locked(db, version_id, locked=True, user_id=user.id)
        write_audit(db, "co_plan_version", v.id, "lock", user, f"Plan version {v.code} ({v.financial_year}) locked")
        db.commit()
        return co_planning.version_row(db, v)


@router.post("/plan-versions/{version_id}/unlock")
async def unlock_plan_version(version_id: int, payload: CoReasonPayload, db: Session = Depends(get_db),
                              user: User = Depends(require_tab_action("accounts", "co_planning", "approve"))):
    with service_errors(db):
        v = co_planning.set_locked(db, version_id, locked=False, user_id=user.id)
        write_audit(db, "co_plan_version", v.id, "unlock", user, f"Plan version {v.code} unlocked: {payload.reason.strip()}")
        db.commit()
        return co_planning.version_row(db, v)


@router.get("/plan-versions/{version_id}/grid")
async def get_plan_grid(version_id: int, db: Session = Depends(get_db),
                        _user: User = Depends(require_tab_access("accounts", "co_planning"))):
    with service_errors(db):
        return co_planning.grid(db, version_id)


@router.put("/plan-versions/{version_id}/grid")
async def save_plan_grid(version_id: int, payload: CoPlanGridPayload, db: Session = Depends(get_db),
                         user: User = Depends(require_tab_action("accounts", "co_planning", "edit"))):
    with service_errors(db):
        out = co_planning.save_grid(db, version_id, [r.model_dump() for r in payload.rows])
        write_audit(db, "co_plan_version", version_id, "update", user, f"Plan saved: {len(payload.rows)} rows, total {out['grand_total']:,.2f}")
        db.commit()
        return out


@router.get("/plan-versions/{version_id}/export")
async def export_plan(version_id: int, db: Session = Depends(get_db),
                      _user: User = Depends(require_tab_action("accounts", "co_planning", "export"))):
    with service_errors(db):
        content, filename = co_planning.export_xlsx(db, version_id)
    return Response(content=content, media_type=_XLSX, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/plan-versions/{version_id}/import")
async def import_plan(version_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                      user: User = Depends(require_tab_action("accounts", "co_planning", "import"))):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Upload an .xlsx file — download this version's template, fill it in and upload it back.")
    content = await file.read()
    if len(content) > _MAX_UPLOAD:
        raise HTTPException(status_code=400, detail="The file is larger than 5 MB — a plan sheet is far smaller; check you picked the right file.")
    with service_errors(db):
        out = co_planning.import_xlsx(db, version_id, content)
        write_audit(db, "co_plan_version", version_id, "import", user, f"Plan imported from {file.filename}: {len(out['rows'])} rows")
        db.commit()
        return out


@router.get("/plan-vs-actual")
async def plan_vs_actual(version_id: int | None = Query(None), financial_year: str | None = Query(None),
                         from_period: str | None = Query(None), to_period: str | None = Query(None),
                         cost_center_id: int | None = Query(None), include_children: bool = Query(True),
                         db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "co_planning", "plan_vs_actual", "view"))):
    with service_errors(db):
        return co_planning.plan_vs_actual(db, version_id=version_id, financial_year=financial_year, from_period=from_period,
                                          to_period=to_period, cost_center_id=cost_center_id, include_children=include_children)


# ── KL01 / KP26 activity types and rates ─────────────────────────────────

@router.get("/activity-types")
async def activity_types(_user: User = Depends(require_tab_access("accounts", "activity_rates"))):
    return co_activity.activity_type_options()


@router.get("/activity-rates")
async def list_activity_rates(financial_year: str | None = Query(None), workstation_id: int | None = Query(None),
                              cost_center_id: int | None = Query(None), db: Session = Depends(get_db),
                              _user: User = Depends(require_tab_access("accounts", "activity_rates"))):
    return co_activity.rate_rows(db, financial_year=financial_year, workstation_id=workstation_id, cost_center_id=cost_center_id)


@router.post("/activity-rates", status_code=201)
async def create_activity_rate(payload: CoActivityRatePayload, db: Session = Depends(get_db),
                               user: User = Depends(require_tab_action("accounts", "activity_rates", "create"))):
    with service_errors(db):
        data = co_activity.validate_rate(db, payload.model_dump())
        rate = CoActivityRate(**data, created_by_id=user.id)
        db.add(rate)
        db.flush()
        write_audit(db, "co_activity_rate", rate.id, "create", user, f"{rate.activity_type} rate {rate.rate:,.2f}/h from {rate.valid_from}")
        db.commit()
        return next(r for r in co_activity.rate_rows(db) if r["id"] == rate.id)


@router.put("/activity-rates/{rate_id}")
async def update_activity_rate(rate_id: int, payload: CoActivityRatePayload, db: Session = Depends(get_db),
                               user: User = Depends(require_tab_action("accounts", "activity_rates", "edit"))):
    rate = db.query(CoActivityRate).filter(CoActivityRate.id == rate_id).first()
    if not rate:
        raise HTTPException(status_code=404, detail="Activity rate not found — reload the list.")
    with service_errors(db):
        data = co_activity.validate_rate(db, payload.model_dump(), rate_id=rate_id)
        before = rate.rate
        for k, v in data.items():
            setattr(rate, k, v)
        write_audit(db, "co_activity_rate", rate.id, "update", user, f"{rate.activity_type} rate {before:,.2f} -> {rate.rate:,.2f}/h")
        db.commit()
        return next(r for r in co_activity.rate_rows(db) if r["id"] == rate.id)


@router.delete("/activity-rates/{rate_id}")
async def delete_activity_rate(rate_id: int, db: Session = Depends(get_db),
                               user: User = Depends(require_tab_action("accounts", "activity_rates", "delete"))):
    rate = db.query(CoActivityRate).filter(CoActivityRate.id == rate_id).first()
    if not rate:
        raise HTTPException(status_code=404, detail="Activity rate not found — reload the list.")
    write_audit(db, "co_activity_rate", rate.id, "delete", user, f"{rate.activity_type} rate {rate.rate:,.2f}/h deleted")
    db.delete(rate)
    db.commit()
    return {"ok": True}


# ── KSU5 / KSV5 cycles ───────────────────────────────────────────────────

@router.get("/allocation-meta")
async def allocation_meta(_user: User = Depends(require_tab_access("accounts", "allocations"))):
    return {"methods": [{"value": k, "label": v} for k, v in CO_ALLOCATION_METHODS.items()],
            "bases": [{"value": k, "label": v} for k, v in CO_ALLOCATION_BASES.items()],
            "activity_types": co_activity.activity_type_options()}


@router.get("/allocation-cycles")
async def list_cycles(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "allocations"))):
    return [co_allocation.cycle_row(db, c) for c in db.query(CoAllocationCycle).order_by(CoAllocationCycle.code).all()]


@router.post("/allocation-cycles", status_code=201)
async def create_cycle(payload: CoAllocationCyclePayload, db: Session = Depends(get_db),
                       user: User = Depends(require_tab_action("accounts", "allocations", "create"))):
    with service_errors(db):
        c = co_allocation.save_cycle(db, payload.model_dump(), user_id=user.id)
        write_audit(db, "co_allocation_cycle", c.id, "create", user, f"Cycle {c.code} created")
        db.commit()
        return co_allocation.cycle_row(db, c)


@router.put("/allocation-cycles/{cycle_id}")
async def update_cycle(cycle_id: int, payload: CoAllocationCyclePayload, db: Session = Depends(get_db),
                       user: User = Depends(require_tab_action("accounts", "allocations", "edit"))):
    with service_errors(db):
        c = co_allocation.save_cycle(db, payload.model_dump(), cycle_id=cycle_id, user_id=user.id)
        write_audit(db, "co_allocation_cycle", c.id, "update", user, f"Cycle {c.code} updated")
        db.commit()
        return co_allocation.cycle_row(db, c)


@router.delete("/allocation-cycles/{cycle_id}")
async def delete_cycle(cycle_id: int, db: Session = Depends(get_db),
                       user: User = Depends(require_tab_action("accounts", "allocations", "delete"))):
    with service_errors(db):
        co_allocation.delete_cycle(db, cycle_id)
        write_audit(db, "co_allocation_cycle", cycle_id, "delete", user, "Cycle deleted")
        db.commit()
        return {"ok": True}


@router.post("/allocation-cycles/{cycle_id}/run")
async def run_cycle(cycle_id: int, payload: CoRunPayload, db: Session = Depends(get_db),
                    user: User = Depends(require_tab_access("accounts", "allocations"))):
    if not payload.test_run:
        from app.core.permissions import ensure_tab_action
        ensure_tab_action(user, "accounts", "allocations", "approve")
    with service_errors(db):
        out = co_allocation.run_cycle(db, cycle_id, payload.period, test_run=payload.test_run, user_id=user.id)
        if payload.test_run:
            db.rollback()
        else:
            write_audit(db, "co_allocation_run", out["run_id"], "post", user,
                        f"Cycle {out['cycle_code']} {payload.period} posted {out['entry_number']} ({out['total_amount']:,.2f})")
            db.commit()
        out.pop("lines", None)
        return out


@router.get("/allocation-runs")
async def list_runs(cycle_id: int | None = Query(None), period: str | None = Query(None), db: Session = Depends(get_db),
                    _user: User = Depends(require_tab_access("accounts", "allocations"))):
    return co_allocation.run_rows(db, cycle_id=cycle_id, period=period)


@router.post("/allocation-runs/{run_id}/reverse")
async def reverse_run(run_id: int, payload: CoReasonPayload, db: Session = Depends(get_db),
                      user: User = Depends(require_feature_action("accounts", "allocations", "reversal", "cancel"))):
    with service_errors(db):
        run = co_allocation.reverse_run(db, run_id, reason=payload.reason, user_id=user.id)
        write_audit(db, "co_allocation_run", run.id, "reverse", user, f"Allocation run reversed: {payload.reason.strip()}")
        db.commit()
        return next(r for r in co_allocation.run_rows(db) if r["id"] == run.id)


# ── KGI2 / KGI4 costing sheet and overhead runs ──────────────────────────

@router.get("/costing-sheet")
async def list_costing_sheet(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "overhead"))):
    return co_overhead.sheet_rows(db)


@router.post("/costing-sheet", status_code=201)
async def create_costing_sheet_rate(payload: CoCostingSheetRatePayload, db: Session = Depends(get_db),
                                    user: User = Depends(require_tab_action("accounts", "overhead", "create"))):
    with service_errors(db):
        row = CoCostingSheetRate(**co_overhead.validate_sheet_rate(db, payload.model_dump()), created_by_id=user.id)
        db.add(row)
        db.flush()
        write_audit(db, "co_costing_sheet_rate", row.id, "create", user,
                    f"Overhead {row.material_overhead_pct}% material / {row.labour_overhead_pct}% labour from {row.valid_from}")
        db.commit()
        return next(r for r in co_overhead.sheet_rows(db) if r["id"] == row.id)


@router.put("/costing-sheet/{rate_id}")
async def update_costing_sheet_rate(rate_id: int, payload: CoCostingSheetRatePayload, db: Session = Depends(get_db),
                                    user: User = Depends(require_tab_action("accounts", "overhead", "edit"))):
    row = db.query(CoCostingSheetRate).filter(CoCostingSheetRate.id == rate_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Costing-sheet row not found — reload the list.")
    with service_errors(db):
        for k, v in co_overhead.validate_sheet_rate(db, payload.model_dump(), rate_id=rate_id).items():
            setattr(row, k, v)
        write_audit(db, "co_costing_sheet_rate", row.id, "update", user,
                    f"Overhead now {row.material_overhead_pct}% material / {row.labour_overhead_pct}% labour")
        db.commit()
        return next(r for r in co_overhead.sheet_rows(db) if r["id"] == row.id)


@router.delete("/costing-sheet/{rate_id}")
async def delete_costing_sheet_rate(rate_id: int, db: Session = Depends(get_db),
                                    user: User = Depends(require_tab_action("accounts", "overhead", "delete"))):
    from app.modules.accounts.models.co_overhead import CoOverheadRunLine

    row = db.query(CoCostingSheetRate).filter(CoCostingSheetRate.id == rate_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Costing-sheet row not found — reload the list.")
    if db.query(CoOverheadRunLine.id).filter(CoOverheadRunLine.costing_sheet_rate_id == row.id).first():
        raise HTTPException(status_code=409, detail="Overhead runs have used this row, so it stays for the audit trail — "
                                                    "end it with a 'valid to' date and add a new row instead.")
    write_audit(db, "co_costing_sheet_rate", row.id, "delete", user, "Costing-sheet row deleted")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/overhead-runs")
async def run_overhead(payload: CoRunPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_tab_access("accounts", "overhead"))):
    if not payload.test_run:
        from app.core.permissions import ensure_tab_action
        ensure_tab_action(user, "accounts", "overhead", "approve")
    with service_errors(db):
        out = co_overhead.run_overhead(db, payload.period, test_run=payload.test_run, user_id=user.id)
        if payload.test_run:
            db.rollback()
        else:
            write_audit(db, "co_overhead_run", out["run_id"], "post", user,
                        f"Overhead {payload.period} applied to {len(out['rows'])} work orders ({out['total_overhead']:,.2f})")
            db.commit()
        return out


@router.get("/overhead-runs")
async def list_overhead_runs(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "overhead"))):
    return co_overhead.overhead_runs(db)


@router.get("/overhead-runs/{run_id}")
async def get_overhead_run(run_id: int, db: Session = Depends(get_db),
                           _user: User = Depends(require_tab_access("accounts", "overhead"))):
    with service_errors(db):
        return co_overhead.overhead_run_detail(db, run_id)


@router.post("/overhead-runs/{run_id}/reverse")
async def reverse_overhead_run(run_id: int, payload: CoReasonPayload, db: Session = Depends(get_db),
                               user: User = Depends(require_feature_action("accounts", "overhead", "reversal", "cancel"))):
    with service_errors(db):
        run = co_overhead.reverse_overhead_run(db, run_id, reason=payload.reason, user_id=user.id)
        write_audit(db, "co_overhead_run", run.id, "reverse", user, f"Overhead run {run.accounting_period} reversed: {payload.reason.strip()}")
        db.commit()
        return co_overhead.overhead_run_detail(db, run.id)
