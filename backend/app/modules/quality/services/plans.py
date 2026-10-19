"""Inspection plan lifecycle: draft → approved → obsolete, one approved
(current) plan per item + inspection type, revisions by copy."""
from datetime import datetime, timezone

from sqlalchemy.orm import Session, selectinload

from app.modules.quality.models.characteristic import QualityCharacteristic
from app.modules.quality.models.inspection_plan import QualityInspectionPlan, QualityInspectionPlanLine
from app.modules.quality.services.sampling import nearest_aql


class PlanError(ValueError):
    """User-facing rule violation (route maps it to 409/422)."""


def current_plan(db: Session, item_id: int, inspection_type: str) -> QualityInspectionPlan | None:
    return db.query(QualityInspectionPlan).options(selectinload(QualityInspectionPlan.lines)).filter(
        QualityInspectionPlan.item_id == item_id,
        QualityInspectionPlan.inspection_type == inspection_type,
        QualityInspectionPlan.status == "approved",
        QualityInspectionPlan.is_deleted == False,  # noqa: E712
    ).first()


def validate_for_approval(db: Session, plan: QualityInspectionPlan) -> None:
    label = f"Plan {plan.plan_number}"
    if not plan.item_id:
        raise PlanError(f"{label} has no Item Master item — legacy plans must be re-created against an item before approval.")
    if not plan.lines:
        raise PlanError(f"{label} has no characteristics — add at least one line before approving.")
    if plan.sampling_type == "aql":
        if plan.aql is None and any(l.aql is None for l in plan.lines):
            raise PlanError(f"{label} uses AQL sampling but has no plan AQL — set the AQL (or one on every line).")
        for v in [plan.aql] + [l.aql for l in plan.lines]:
            if v is not None:
                try:
                    nearest_aql(v)
                except ValueError as e:
                    raise PlanError(str(e))
    if plan.sampling_type == "fixed" and not (plan.fixed_sample_size and plan.fixed_sample_size > 0):
        raise PlanError(f"{label} uses a fixed sample — enter the fixed sample size.")
    chars = {c.id: c for c in db.query(QualityCharacteristic).filter(
        QualityCharacteristic.id.in_([l.characteristic_id for l in plan.lines])).all()}
    for line in plan.lines:
        ch = chars.get(line.characteristic_id)
        if not ch:
            raise PlanError(f"{label}: characteristic #{line.characteristic_id} no longer exists.")
        if not ch.is_active:
            raise PlanError(f"{label}: characteristic '{ch.code}' is retired — replace it before approving.")
        if ch.char_type == "variable":
            if line.min_value is None and line.max_value is None:
                raise PlanError(f"{label}: '{ch.name}' is a measured characteristic — enter a min and/or max limit.")
            if line.min_value is not None and line.max_value is not None and line.min_value > line.max_value:
                raise PlanError(f"{label}: '{ch.name}' min ({line.min_value:g}) is above max ({line.max_value:g}).")


def approve_plan(db: Session, plan: QualityInspectionPlan, user_id: int) -> QualityInspectionPlan:
    if plan.status != "draft":
        raise PlanError(f"Plan {plan.plan_number} is {plan.status} — only a draft can be approved.")
    validate_for_approval(db, plan)
    now = datetime.now(timezone.utc)
    previous = current_plan(db, plan.item_id, plan.inspection_type)
    if previous and previous.id != plan.id:
        previous.status = "obsolete"
        previous.obsoleted_at = now
        db.flush()
    plan.status = "approved"
    plan.approved_by_id = user_id
    plan.approved_at = now
    db.flush()
    return plan


def new_revision(db: Session, plan: QualityInspectionPlan, plan_number: str, user_id: int) -> QualityInspectionPlan:
    if plan.status != "approved":
        raise PlanError(f"A new revision is made from the approved plan — {plan.plan_number} is {plan.status}.")
    existing_draft = db.query(QualityInspectionPlan).filter(
        QualityInspectionPlan.supersedes_id == plan.id, QualityInspectionPlan.status.in_(("draft", "pending_approval")),
        QualityInspectionPlan.is_deleted == False,  # noqa: E712
    ).first()
    if existing_draft:
        raise PlanError(f"Draft revision {existing_draft.plan_number} (rev {existing_draft.revision}) already exists — edit that one.")
    copy = QualityInspectionPlan(
        plan_number=plan_number, item_id=plan.item_id, item_name=plan.item_name, item_code=plan.item_code,
        inspection_type=plan.inspection_type, revision=plan.revision + 1, supersedes_id=plan.id, title=plan.title,
        sampling_type=plan.sampling_type, aql=plan.aql, inspection_level=plan.inspection_level,
        fixed_sample_size=plan.fixed_sample_size, status="draft", remarks=plan.remarks, created_by_id=user_id,
    )
    for l in plan.lines:
        copy.lines.append(QualityInspectionPlanLine(
            characteristic_id=l.characteristic_id, sequence=l.sequence, nominal=l.nominal, min_value=l.min_value,
            max_value=l.max_value, classification=l.classification, method=l.method, aql=l.aql, remarks=l.remarks,
        ))
    db.add(copy)
    db.flush()
    return copy


def obsolete_plan(db: Session, plan: QualityInspectionPlan) -> QualityInspectionPlan:
    if plan.status == "obsolete":
        raise PlanError(f"Plan {plan.plan_number} is already obsolete.")
    if plan.status == "pending_approval":
        raise PlanError(f"Plan {plan.plan_number} is waiting for approval — withdraw the approval request (Approval panel) "
                        "or have it rejected first.")
    plan.status = "obsolete"
    plan.obsoleted_at = datetime.now(timezone.utc)
    db.flush()
    return plan
