"""Plain-function helpers for the Hydraulic & Pneumatic module — document
numbers, maintenance due dates, spare stock status and shared lookups.
Kept out of the routes so the dashboard and every router share one
definition of "due", "low stock" and "cost". Number generation mirrors
app/modules/production/service.py."""
from datetime import date, timedelta
from fastapi import HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.hydraulic.models.bom import HydBom
from app.modules.hydraulic.models.calculation import HydCalculation
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.component import HydComponent, HYD_COMPONENT_CATEGORIES
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord
from app.modules.hydraulic.models.spare_part import HydSparePart
from app.modules.hydraulic.models.system import HydSystem, HYD_SYSTEM_TYPES, HYD_MEDIA_TYPES
from app.modules.hydraulic.models.testing import HydTest
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.stock_balance import StoreStockBalance

DUE_SOON_DAYS = 7
# Running-hours plans count as "due soon" inside this fraction of the interval.
DUE_SOON_HOURS_FRACTION = 0.1


def _lock_number_series(db: Session, prefix: str) -> None:
    """Serializes concurrent number generation for a prefix with a
    transaction-scoped Postgres advisory lock (see quality/service.py).
    Skipped on other dialects — the SQLite test database has no advisory
    locks and no concurrent writers."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def _next_number(db: Session, column, prefix: str, width: int = 4) -> str:
    _lock_number_series(db, prefix)
    last = db.query(func.max(column)).filter(column.like(f"{prefix}%")).scalar()
    if last:
        return f"{prefix}{int(last.rsplit('-', 1)[-1]) + 1:0{width}d}"
    return f"{prefix}{1:0{width}d}"


def _year() -> int:
    return date.today().year


def generate_system_number(db: Session, system_type: str) -> str:
    """HYS-[YEAR]-[NUMBER] for hydraulic, PNS-[YEAR]-[NUMBER] for pneumatic."""
    return _next_number(db, HydSystem.system_number, f"{'PNS' if system_type == 'pneumatic' else 'HYS'}-{_year()}-")


def generate_component_code(db: Session, category: str) -> str:
    """[CATEGORY PREFIX]-[NUMBER], e.g. PMP-0001 — not year-scoped, it's a master."""
    return _next_number(db, HydComponent.code, f"{HYD_COMPONENT_CATEGORIES[category]}-")


def generate_circuit_number(db: Session) -> str:
    return _next_number(db, HydCircuit.circuit_number, f"CKT-{_year()}-")


def generate_bom_number(db: Session) -> str:
    return _next_number(db, HydBom.bom_number, f"HBOM-{_year()}-")


def generate_calc_number(db: Session) -> str:
    return _next_number(db, HydCalculation.calc_number, f"HCALC-{_year()}-")


def generate_test_number(db: Session) -> str:
    return _next_number(db, HydTest.test_number, f"HTST-{_year()}-")


def generate_plan_number(db: Session) -> str:
    return _next_number(db, HydMaintenancePlan.plan_number, f"HMP-{_year()}-")


def generate_service_number(db: Session) -> str:
    return _next_number(db, HydServiceRecord.record_number, f"HSR-{_year()}-")


def generate_spare_code(db: Session) -> str:
    return _next_number(db, HydSparePart.part_code, "HSP-", 5)


def next_revision(revision: str) -> str:
    """A → B → … → Z → AA → AB. Numeric revisions (1, 2…) just increment."""
    rev = (revision or "A").strip().upper()
    if rev.isdigit():
        return str(int(rev) + 1)
    chars = list(rev)
    i = len(chars) - 1
    while i >= 0:
        if chars[i] != "Z":
            chars[i] = chr(ord(chars[i]) + 1)
            return "".join(chars)
        chars[i] = "A"
        i -= 1
    return "A" + "".join(chars)


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def check_choice(value: str | None, choices, label: str) -> None:
    if value is not None and value not in choices:
        raise HTTPException(status_code=400, detail=f"Invalid {label} '{value}'. Use one of: {', '.join(choices)}.")


def check_system_type(value: str | None, allow_both: bool = False) -> None:
    check_choice(value, HYD_MEDIA_TYPES if allow_both else HYD_SYSTEM_TYPES, "system type")


def get_system_or_404(db: Session, system_id: int) -> HydSystem:
    system = db.query(HydSystem).filter(HydSystem.id == system_id, HydSystem.is_deleted == False).first()  # noqa: E712
    if not system:
        raise HTTPException(status_code=404, detail=f"Hydraulic/pneumatic system #{system_id} not found (it may have been deleted) — pick the system again.")
    return system


def get_component_or_404(db: Session, component_id: int) -> HydComponent:
    comp = db.query(HydComponent).filter(HydComponent.id == component_id, HydComponent.is_deleted == False).first()  # noqa: E712
    if not comp:
        raise HTTPException(status_code=404, detail=f"Component #{component_id} not found in the component master (it may have been deleted).")
    return comp


def check_store_item(db: Session, store_item_id: int | None) -> StoreItem | None:
    if not store_item_id:
        return None
    item = db.query(StoreItem).filter(StoreItem.id == store_item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Store item #{store_item_id} not found — pick the item again from the Store item list.")
    return item


def check_user(db: Session, user_id: int | None, label: str) -> None:
    if user_id and not db.query(User.id).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail=f"{label} (user #{user_id}) not found — pick the person again.")


def user_names(db: Session, ids: set) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(ids)).all()}


def systems_by_id(db: Session, ids: set) -> dict[int, HydSystem]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {s.id: s for s in db.query(HydSystem).filter(HydSystem.id.in_(ids)).all()}


def components_by_id(db: Session, ids: set) -> dict[int, HydComponent]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {c.id: c for c in db.query(HydComponent).filter(HydComponent.id.in_(ids)).all()}


# ---------------------------------------------------------------------------
# Maintenance due logic
# ---------------------------------------------------------------------------

def compute_next_due_date(plan: HydMaintenancePlan) -> date | None:
    """last done + frequency; if never done, the start date (or today) is
    the first due date. Hours-only plans have no calendar due date — they
    come due on running hours alone (see plan_due_state)."""
    if not plan.frequency_days:
        return None
    if plan.last_done_date:
        return plan.last_done_date + timedelta(days=plan.frequency_days)
    return plan.start_date or date.today()


def plan_due_state(plan: HydMaintenancePlan, system_hours: float | None, today: date | None = None) -> dict:
    """{'due_status', 'days_to_due', 'next_due_hours'} — the worse of the
    calendar and running-hours triggers wins."""
    today = today or date.today()
    if not plan.is_active:
        return {"due_status": "inactive", "days_to_due": None, "next_due_hours": None}
    rank = {"ok": 0, "due_soon": 1, "overdue": 2}
    status = "ok"
    days = None
    if plan.next_due_date:
        days = (plan.next_due_date - today).days
        status = "overdue" if days < 0 else "due_soon" if days <= DUE_SOON_DAYS else "ok"
    next_hours = None
    if plan.frequency_hours:
        next_hours = (plan.last_done_hours or 0.0) + plan.frequency_hours
        if system_hours is not None:
            remaining = next_hours - system_hours
            hours_status = "overdue" if remaining <= 0 else "due_soon" if remaining <= plan.frequency_hours * DUE_SOON_HOURS_FRACTION else "ok"
            if rank[hours_status] > rank[status]:
                status = hours_status
    return {"due_status": status, "days_to_due": days, "next_due_hours": next_hours}


def mark_plan_done(plan: HydMaintenancePlan, done_on: date, running_hours: float | None) -> None:
    plan.last_done_date = done_on
    if running_hours is not None:
        plan.last_done_hours = running_hours
    plan.next_due_date = compute_next_due_date(plan)


# ---------------------------------------------------------------------------
# Spares stock
# ---------------------------------------------------------------------------

def store_stock(db: Session, item_ids: set) -> dict[int, tuple[float, float]]:
    """store item id → (on_hand, available) summed over every location."""
    ids = {i for i in item_ids if i}
    if not ids:
        return {}
    rows = db.query(
        StoreStockBalance.item_id,
        func.coalesce(func.sum(StoreStockBalance.on_hand_qty), 0.0),
        func.coalesce(func.sum(StoreStockBalance.on_hand_qty - StoreStockBalance.reserved_qty), 0.0),
    ).filter(StoreStockBalance.item_id.in_(ids)).group_by(StoreStockBalance.item_id).all()
    out = {i: (0.0, 0.0) for i in ids}
    for item_id, on_hand, available in rows:
        out[item_id] = (float(on_hand or 0.0), float(available or 0.0))
    return out


def stock_status(spare: HydSparePart, available: float | None) -> str:
    if available is None:
        return "not_linked"
    if available <= 1e-9:
        return "out"
    if available < (spare.min_stock_qty or 0.0):
        return "low"
    return "ok"


def spare_unit_cost(spare: HydSparePart, item: StoreItem | None) -> float:
    """The spare's own unit cost, falling back to the Store item's standard
    then moving-average cost."""
    if spare.unit_cost:
        return float(spare.unit_cost)
    if item:
        return float(item.standard_cost or item.moving_average_cost or 0.0)
    return 0.0
