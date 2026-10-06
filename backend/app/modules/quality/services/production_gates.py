"""In-process inspection — Production routing operations marked
"inspection required" are quality gates.

One mechanism (Phase 2): a gate request creates an in-process inspection
LOT (no stock behind it — the parts are still on the shop floor). The gate
is passed once the lot has a usage decision that accepts something
(accept / accept with deviation / partial); a full reject fails it (NCR
raised by the lot decision — rule 5) and the gate can be requested again
after rework. While a gate is undecided, the operation can't be completed
and the next operation can't be started (held).

Legacy: steps gated before Phase 2 point at a free-text QualityInspection
(quality_inspection_id). They stay readable and are still honoured
(passed / conditionally_passed = passed) until re-requested.

Hooks (flush, never commit):
  gate_state(db, op) -> GateState
  request_gate_lot(db, wo, op, user) -> lot
  on_gate_lot_decided(db, lot, ncrs, user)  (called by lots.decide)
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.store.models.item import StoreItem
from app.utils.notifications import notify_user

GATE_SOURCE = "work_order_operation"
_LEGACY_PASSED = ("passed", "conditionally_passed")
_ACCEPTING = ("accept", "accept_with_deviation", "partial")


class GateError(ValueError):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


@dataclass
class GateState:
    passed: bool
    number: str | None       # lot / legacy inspection number
    status: str              # pending | in_progress | passed | conditionally_passed | failed | none
    lot_id: int | None = None
    legacy_id: int | None = None

    @property
    def requested(self) -> bool:
        return self.status != "none"


def _lot_status(lot: QualityInspectionLot) -> str:
    """Lot → the gate status words Production already shows."""
    if lot.status == "created":
        return "pending"
    if lot.status in ("in_inspection", "results_recorded"):
        return "in_progress"
    if lot.status == "cancelled":
        return "failed"
    if lot.decision == "accept":
        return "passed"
    if lot.decision in ("accept_with_deviation", "partial"):
        return "conditionally_passed"
    return "failed"


def gate_state(db: Session, op, lots: dict | None = None, legacy: dict | None = None) -> GateState:
    """lots / legacy: optional prefetched {id: row} maps (list views)."""
    if op.quality_lot_id:
        lot = (lots or {}).get(op.quality_lot_id) or db.query(QualityInspectionLot).filter(
            QualityInspectionLot.id == op.quality_lot_id).first()
        if lot:
            st = _lot_status(lot)
            return GateState(passed=st in _LEGACY_PASSED, number=lot.lot_number, status=st, lot_id=lot.id)
    if op.quality_inspection_id:
        from app.modules.quality.models.inspection import QualityInspection
        insp = (legacy or {}).get(op.quality_inspection_id) or db.query(QualityInspection).filter(
            QualityInspection.id == op.quality_inspection_id).first()
        if insp and not insp.is_deleted:
            return GateState(passed=insp.status in _LEGACY_PASSED, number=insp.inspection_number, status=insp.status,
                             legacy_id=insp.id)
    return GateState(passed=False, number=None, status="none")


def completion_problem(db: Session, op) -> str | None:
    """Why this gated operation can't be completed yet (None = it can)."""
    if not op.requires_inspection:
        return None
    g = gate_state(db, op)
    step = f"operation {op.sequence} {op.operation_name}"
    if not g.requested:
        return (f"Operation {op.sequence} {op.operation_name} is a quality gate. Click 'Request Inspection' and have Quality "
                "decide the in-process inspection lot before completing this step.")
    if g.passed:
        return None
    if g.status == "failed":
        return (f"In-process inspection {g.number} for {step} was rejected. Rework the parts (see its NCR), then request "
                "a fresh inspection.")
    return f"In-process inspection {g.number} for {step} is {g.status.replace('_', ' ')}. Wait for Quality's usage decision."


def start_problem(db: Session, wo, op) -> str | None:
    """The next operation is held while an earlier quality gate is undecided
    or failed."""
    for prev in sorted(wo.operations, key=lambda o: o.sequence):
        if prev.sequence >= op.sequence or not prev.requires_inspection or prev.status == "completed":
            continue
        g = gate_state(db, prev)
        if g.requested and not g.passed:
            what = "was rejected — rework and re-inspect it" if g.status == "failed" else "has no usage decision yet"
            return (f"Operation {op.sequence} {op.operation_name} is on hold: the quality gate at operation {prev.sequence} "
                    f"{prev.operation_name} ({g.number}) {what}. The next operation starts once Quality accepts it.")
    return None


def request_gate_lot(db: Session, wo, op, user: User) -> QualityInspectionLot:
    from app.modules.quality.services.lots import create_lot
    g = gate_state(db, op)
    if g.requested and g.status != "failed":
        raise GateError(f"Inspection {g.number} is already {g.status.replace('_', ' ')} for this operation.")
    product = db.query(StoreItem).filter(StoreItem.id == wo.product_item_id).first()
    if not product:
        raise GateError(f"Work order {wo.wo_number}'s product item no longer exists in the Item Master.", 422)
    qty = op.qty_good or wo.quantity_planned
    lot = create_lot(
        db, inspection_type="in_process", source_type=GATE_SOURCE, item=product, quantity=qty, location_id=None,
        user_id=user.id, source_id=op.id, source_reference=f"{wo.wo_number} · Op {op.sequence} {op.operation_name}",
        batch_number=wo.wo_number,
        remarks=f"In-process gate requested from Production by {user.name or user.email} for work order {wo.wo_number}, "
                f"operation {op.sequence} {op.operation_name}.",
    )
    op.quality_lot_id = lot.id
    db.flush()
    return lot


def on_gate_lot_decided(db: Session, lot: QualityInspectionLot, ncrs: list, user: User) -> None:
    """Tells the work order's supervisor / creator the gate result, and for
    a work order that belongs to an RRV build raises a rework order on a
    rejection (Production's existing rework flow), linked to the NCR."""
    from app.modules.production.models.work_order import ProductionWorkOrder, ProductionWorkOrderOperation
    op = db.query(ProductionWorkOrderOperation).filter(ProductionWorkOrderOperation.quality_lot_id == lot.id).first()
    if not op:
        return
    wo = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == op.work_order_id).first()
    if not wo:
        return
    passed = lot.decision in _ACCEPTING
    title = "Quality Gate Passed" if passed else "Quality Gate Failed — Rework Needed"
    outcome = ("accepted. The step can now be completed and the next operation started." if passed
               else "rejected. Rework the parts (see the NCR), then request a fresh inspection.")
    if lot.decision == "partial":
        outcome = (f"partly accepted ({lot.accepted_qty:g} accepted, {lot.rejected_qty:g} rejected under NCR). "
                   "The step can now be completed.")
    message = f"In-process inspection {lot.lot_number} for {wo.wo_number} · operation {op.sequence} {op.operation_name} {outcome}"
    for user_id in {wo.supervisor_id, wo.created_by_id} - {None, user.id}:
        if db.query(User).filter(User.id == user_id, User.is_active == True).first():  # noqa: E712
            notify_user(db, user_id=user_id, title=title, message=message,
                        notification_type="production_inspection_result", entity_type="production_work_order", entity_id=wo.id)
    if not passed and wo.rrv_build_id:
        from app.modules.production.models.rrv_build import ProductionRrvBuild
        from app.modules.production.service import raise_rework
        build = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == wo.rrv_build_id).first()
        if build:
            ncr = ncrs[0] if ncrs else None
            raise_rework(
                db, build, source="operation_inspection", title=f"Failed in-process inspection {lot.lot_number} on {wo.wo_number}",
                defect=lot.decision_remarks or (ncr.description if ncr else None), actor_id=user.id,
                work_order_id=wo.id, ncr_id=ncr.id if ncr else None,
            )
