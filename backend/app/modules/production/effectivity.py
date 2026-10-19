"""BOM validity and engineering-change effectivity (SAP CS02 validity +
change number, CC01/ECM effectivity).

One version per product is `active` at a time, as before. What this adds:

- valid_from / valid_to on a version. A version approved with a future
  valid_from becomes `scheduled`: the current active version stays in force
  until the day before, then (lazily, the next time anyone reads or plans
  against the product, and in the daily job) the scheduled one becomes
  active and the old one obsolete.
- Work order creation picks a version that is valid on the order's planned
  start date and refuses a superseded one, naming the right version.
- Serial effectivity: an ECN "from serial X" keeps the old version usable
  for machines numbered before X.
- Open work orders of a product hit by an implemented ECN are flagged, so
  Production reviews them (WIP disposition) and clears the flag.

Routes catch EffectivityError and return its message as a 409."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.work_order import ProductionWorkOrder
from app.utils.notifications import notify_user

OPEN_ORDER_STATUSES = ("draft", "released", "in_progress")


class EffectivityError(Exception):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def _fmt(d: date | None) -> str:
    return d.strftime("%d-%m-%Y") if d else "—"


def _chunks(value: str) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.findall(r"\d+|\D+", value or "") if t.strip()]


def serial_before(serial: str | None, effective_serial: str | None) -> bool:
    """Natural comparison: "RRV-9" is before "RRV-10"."""
    if not serial or not effective_serial:
        return False
    a, b = _chunks(serial), _chunks(effective_serial)
    try:
        return a < b
    except TypeError:  # number vs text at the same position — fall back to text
        return serial.lower() < effective_serial.lower()


def validate_window(valid_from: date | None, valid_to: date | None) -> None:
    if valid_from and valid_to and valid_to < valid_from:
        raise EffectivityError(f"'Valid to' ({_fmt(valid_to)}) is before 'Valid from' ({_fmt(valid_from)}). "
                               "Clear 'Valid to' or pick a later date.", 400)


def apply_due_effectivity(db: Session, product_item_id: int | None = None, today: date | None = None) -> int:
    """Scheduled versions whose valid_from has come take over from the active
    one. Flushes; the caller commits."""
    today = today or date.today()
    query = db.query(ProductionBom).filter(
        ProductionBom.is_deleted == False, ProductionBom.status == "scheduled",  # noqa: E712
        ProductionBom.valid_from != None, ProductionBom.valid_from <= today,  # noqa: E711
    )
    if product_item_id is not None:
        query = query.filter(ProductionBom.product_item_id == product_item_id)
    flipped = 0
    for bom in query.order_by(ProductionBom.valid_from).all():
        for old in db.query(ProductionBom).filter(
            ProductionBom.product_item_id == bom.product_item_id, ProductionBom.status == "active",
            ProductionBom.is_deleted == False, ProductionBom.id != bom.id,  # noqa: E712
        ).all():
            old.status = "obsolete"
            if old.valid_to is None or old.valid_to >= bom.valid_from:
                old.valid_to = bom.valid_from - timedelta(days=1)
        bom.status = "active"
        flipped += 1
    if flipped:
        db.flush()
    return flipped


def activate_version(db: Session, bom: ProductionBom, user_id: int | None) -> str:
    """Approved draft -> active (or scheduled when valid_from is in the
    future). Returns the new status. A valid_from in the past is moved to
    today: a version can't have been in force before it was approved."""
    today = date.today()
    if bom.valid_from is None or bom.valid_from < today:
        bom.valid_from = today
    validate_window(bom.valid_from, bom.valid_to)
    others = db.query(ProductionBom).filter(
        ProductionBom.product_item_id == bom.product_item_id, ProductionBom.is_deleted == False,  # noqa: E712
        ProductionBom.id != bom.id, ProductionBom.status.in_(("active", "scheduled")),
    ).all()
    bom.activated_by_id = user_id
    bom.activated_at = datetime.now(timezone.utc)
    if bom.valid_from > today:
        # The current version runs until the day before; an older scheduled
        # version that would start later than this one is replaced by it.
        for old in others:
            if old.status == "scheduled" and old.valid_from and old.valid_from >= bom.valid_from:
                old.status = "obsolete"
            elif old.valid_to is None or old.valid_to >= bom.valid_from:
                old.valid_to = bom.valid_from - timedelta(days=1)
        bom.status = "scheduled"
    else:
        for old in others:
            old.status = "obsolete"
            if old.valid_to is None or old.valid_to >= today:
                old.valid_to = max(today - timedelta(days=1), old.valid_from or date.min)
        bom.status = "active"
    return bom.status


def _project_serial(db: Session, project_id: int | None) -> str | None:
    if not project_id:
        return None
    from app.modules.erp.models.project import Project
    p = db.query(Project).filter(Project.id == project_id).first()
    return p.serial_number if p else None


def check_bom_for_order(db: Session, bom: ProductionBom, start: date | None, erp_project_id: int | None) -> None:
    """The version a new work order may use on its planned start date
    (today when blank)."""
    on = start or date.today()
    label = f"BOM {bom.bom_number} v{bom.version}"
    if bom.status == "obsolete":
        successor = db.query(ProductionBom).filter(
            ProductionBom.product_item_id == bom.product_item_id, ProductionBom.status == "active",
            ProductionBom.is_deleted == False, ProductionBom.effective_serial != None,  # noqa: E711,E712
        ).first()
        serial = _project_serial(db, erp_project_id)
        if successor and serial and serial_before(serial, successor.effective_serial) and (bom.valid_to is None or bom.version < successor.version):
            return  # serial effectivity: machines before the ECN serial keep the old structure
        raise EffectivityError(
            f"{label} is obsolete. Work orders can only be raised from an active BOM — activate it first"
            + (f", or use the current version (machines before serial {successor.effective_serial} may still use the old one)." if successor else "."),
        )
    if bom.status not in ("active", "scheduled"):
        raise EffectivityError(f"{label} is {bom.status}. Work orders can only be raised from an active BOM — activate it first.")
    if bom.valid_from and on < bom.valid_from:
        current = db.query(ProductionBom).filter(
            ProductionBom.product_item_id == bom.product_item_id, ProductionBom.status == "active",
            ProductionBom.is_deleted == False, ProductionBom.id != bom.id,  # noqa: E712
        ).first()
        alt = f" Use {current.bom_number} v{current.version} (valid until {_fmt(current.valid_to)}) for orders starting before then," if current else ""
        raise EffectivityError(
            f"{label} is valid from {_fmt(bom.valid_from)}{f' ({bom.change_number})' if bom.change_number else ''}, but this order is planned "
            f"to start {_fmt(on)}.{alt} or move the planned start date to {_fmt(bom.valid_from)} or later.")
    if bom.valid_to and on > bom.valid_to:
        successor = db.query(ProductionBom).filter(
            ProductionBom.product_item_id == bom.product_item_id, ProductionBom.status.in_(("active", "scheduled")),
            ProductionBom.is_deleted == False, ProductionBom.id != bom.id,  # noqa: E712
        ).order_by(ProductionBom.version.desc()).first()
        nxt = f" Use {successor.bom_number} v{successor.version}" + (f" ({successor.change_number})" if successor.change_number else "") + "." if successor else ""
        raise EffectivityError(
            f"{label} is only valid until {_fmt(bom.valid_to)}, but this order is planned to start {_fmt(on)} — "
            f"a later engineering change takes effect by then.{nxt}")
    if bom.effective_serial:
        serial = _project_serial(db, erp_project_id)
        if serial and serial_before(serial, bom.effective_serial):
            raise EffectivityError(
                f"{label} applies from machine serial {bom.effective_serial} ({bom.change_number or 'ECN'}), and {serial} is before it. "
                "Build this machine to the previous BOM version.")


def flag_open_orders(db: Session, product_item_id: int, message: str, ecn_id: int | None,
                     exclude_bom_id: int | None = None, actor_id: int | None = None) -> list[ProductionWorkOrder]:
    """Marks every open order of the product built to another BOM version
    and tells its supervisor / creator."""
    query = db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.product_item_id == product_item_id,
        ProductionWorkOrder.status.in_(OPEN_ORDER_STATUSES),
    )
    if exclude_bom_id:
        query = query.filter(ProductionWorkOrder.bom_id != exclude_bom_id)
    orders = query.all()
    now = datetime.now(timezone.utc)
    for wo in orders:
        wo.change_flag = message[:2000]
        wo.change_flag_ecn_id = ecn_id
        wo.change_flag_at = now
        wo.change_flag_cleared_at = wo.change_flag_cleared_by_id = wo.change_flag_resolution = None
        for uid in {wo.supervisor_id, wo.created_by_id} - {None, actor_id}:
            notify_user(
                db, user_id=uid, title="Engineering change on an open work order",
                message=f"{wo.wo_number}: {message}", notification_type="production_wo_change_flag",
                entity_type="production_work_order", entity_id=wo.id,
            )
    return orders
