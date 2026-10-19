"""AMC & warranty tracking (Phase 3) — read-only over the asset register.

Two kinds of cover per asset, both already captured on MaintenanceAsset:
- warranty: the OEM / supplier repairs defects free until `warranty_expiry`
  (vendor = `supplier_vendor_id`, the party we bought it from).
- amc: an Annual Maintenance Contract we pay a service vendor for, valid
  until `amc_expiry` (vendor = `amc_vendor_id`).

Every (asset, kind) pair falls in one bucket:
  expired  — expiry date is before today
  expiring — expires today or within `window_days` (default 60)
  active   — expires after the window
  none     — no expiry date captured (not covered / not recorded)

Shared by routes/contracts.py and tasks/maintenance_amc_reminders.py."""
from __future__ import annotations

from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.accounts.models.vendor import Vendor
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.organization.models.branch import Branch

CONTRACT_KINDS = ("warranty", "amc")
CONTRACT_STATUSES = ("expired", "expiring", "active", "none")
DEFAULT_WINDOW_DAYS = 60
KIND_LABELS = {"warranty": "Warranty", "amc": "AMC"}
STATUS_LABELS = {"expired": "Expired", "expiring": "Expiring", "active": "Active", "none": "Not covered"}
# Days before expiry (and 1 day after) on which the daily reminder fires —
# code defaults of Maintenance › Settings (contract_reminder_days_before/after).
REMINDER_DAYS_BEFORE = (30, 15, 7, 1)
REMINDER_DAYS_AFTER = 1

_FIELDS = {
    "warranty": ("warranty_expiry", "supplier_vendor_id"),
    "amc": ("amc_expiry", "amc_vendor_id"),
}


def contract_bucket(expiry: date | None, today: date, window_days: int = DEFAULT_WINDOW_DAYS) -> tuple[str, int | None]:
    """(status bucket, days_left). days_left is negative once expired."""
    if expiry is None:
        return "none", None
    days_left = (expiry - today).days
    if days_left < 0:
        return "expired", days_left
    if days_left <= window_days:
        return "expiring", days_left
    return "active", days_left


def _sort_key(row: dict):
    order = {"expired": 0, "expiring": 1, "active": 2, "none": 3}[row["status"]]
    d = row["days_left"]
    # Expired: most recently lapsed first; others: soonest first.
    secondary = (-d if row["status"] == "expired" else d) if d is not None else 0
    return (order, secondary, row["asset_code"], row["kind"])


def build_contract_rows(
    db: Session,
    today: date,
    branch_id: int | None = None,
    kind: str = "all",
    window_days: int = DEFAULT_WINDOW_DAYS,
    search: str | None = None,
) -> list[dict]:
    """One row per (asset, kind) for live (not deleted, not decommissioned)
    assets, before any status filter."""
    q = db.query(MaintenanceAsset).filter(
        MaintenanceAsset.is_deleted == False,  # noqa: E712
        MaintenanceAsset.status != "decommissioned",
    )
    if branch_id:
        q = q.filter(MaintenanceAsset.branch_id == branch_id)
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(MaintenanceAsset.asset_code.ilike(like), MaintenanceAsset.name.ilike(like)))
    assets = q.all()
    if not assets:
        return []

    kinds = CONTRACT_KINDS if kind == "all" else (kind,)
    vendor_ids = {getattr(a, _FIELDS[k][1]) for a in assets for k in kinds} - {None}
    vendors = dict(db.query(Vendor.id, Vendor.name).filter(Vendor.id.in_(vendor_ids)).all()) if vendor_ids else {}
    branches = dict(db.query(Branch.id, Branch.name).filter(Branch.id.in_({a.branch_id for a in assets})).all())

    rows: list[dict] = []
    for a in assets:
        for k in kinds:
            expiry_field, vendor_field = _FIELDS[k]
            expiry = getattr(a, expiry_field)
            vendor_id = getattr(a, vendor_field)
            status, days_left = contract_bucket(expiry, today, window_days)
            rows.append({
                "asset_id": a.id,
                "asset_code": a.asset_code,
                "asset_name": a.name,
                "branch_id": a.branch_id,
                "branch_name": branches.get(a.branch_id),
                "criticality": a.criticality,
                "asset_status": a.status,
                "kind": k,
                "vendor_id": vendor_id,
                "vendor_name": vendors.get(vendor_id) if vendor_id else None,
                "expiry_date": expiry,
                "days_left": days_left,
                "status": status,
            })
    rows.sort(key=_sort_key)
    return rows


def summarize(rows: list[dict]) -> dict:
    counts = {s: 0 for s in CONTRACT_STATUSES}
    for r in rows:
        counts[r["status"]] += 1
    counts["total"] = len(rows)
    return counts


# ---------------------------------------------------------------------------
# Reminder wording
# ---------------------------------------------------------------------------

def reminder_due(expiry: date | None, today: date, days_before=REMINDER_DAYS_BEFORE,
                 days_after: int = REMINDER_DAYS_AFTER) -> bool:
    """days_after = 0 means no after-expiry reminder."""
    if expiry is None:
        return False
    days_left = (expiry - today).days
    return days_left in days_before or (days_after > 0 and days_left == -days_after)


def reminder_sentence(kind: str, asset: MaintenanceAsset, vendor_name: str | None, expiry: date, today: date) -> str:
    days_left = (expiry - today).days
    what = f"{asset.asset_code} {asset.name}"
    when = f"{expiry:%d %b %Y}"
    if kind == "amc":
        who = f" with {vendor_name}" if vendor_name else ""
        if days_left < 0:
            ago = "yesterday" if days_left == -1 else f"{-days_left} days ago"
            return (f"AMC for {what}{who} expired {ago} ({when}). The machine is no longer covered — "
                    "renew the contract or record a new AMC vendor and expiry on the asset.")
        day_word = "day" if days_left == 1 else "days"
        return f"AMC for {what}{who} expires on {when} ({days_left} {day_word}). Renew or plan a replacement contract."
    who = f" from {vendor_name}" if vendor_name else ""
    if days_left < 0:
        ago = "yesterday" if days_left == -1 else f"{-days_left} days ago"
        return (f"Warranty for {what}{who} expired {ago} ({when}). Breakdowns are now chargeable — "
                "consider an AMC for this machine.")
    day_word = "day" if days_left == 1 else "days"
    return (f"Warranty for {what}{who} expires on {when} ({days_left} {day_word}). "
            "Raise any pending warranty claims before then and decide whether to take an AMC.")
