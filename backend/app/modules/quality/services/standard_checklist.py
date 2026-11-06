"""The default incoming inspection checklist = the ISO format F/STR/01
"Incoming Inspection Standard" (owner, 2026-11-06).

Six parameters checked on every incoming lot: Grade (as per MTC), Qty, Weight,
Shape, Dimension, Appearance. Sample of 5 pcs recorded per lot, zero defect
accepted; when the lot's sampling state is "tightened" (abnormal result / customer
complaint) the sample is doubled (services/sampling.py).

It is stored with the ordinary tables — six characteristics and ONE plan that
belongs to no item (item_id empty, status approved) — and is created in code the
first time a lot needs it (`ensure_standard_incoming_plan`), so a fresh database
needs no migration and no manual set-up. `plans.current_plan` looks plans up by
item, so this plan is never picked while the item has its own approved incoming
plan: item-specific plans stay possible and win."""
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.modules.quality.models.characteristic import QualityCharacteristic
from app.modules.quality.models.inspection_plan import QualityInspectionPlan, QualityInspectionPlanLine

STANDARD_PLAN_NUMBER = "F-STR-01"
STANDARD_CODE_PREFIX = "F-STR-01-"
STANDARD_FORMAT_NO = "F/STR/01"
STANDARD_TITLE = "Incoming Inspection Standard (F/STR/01)"
STANDARD_SAMPLE_SIZE = 5
STANDARD_OPERATION_NAME = "INCOMING INSPECTION"

# (code, parameter name, specification, measuring method, unit, classification)
# Every parameter is a pass/fail check on the sample (the inspector enters the defective
# count and writes what was observed in the remarks), so they are all "attribute".
STANDARD_PARAMETERS: tuple[tuple[str, str, str, str, str | None, str], ...] = (
    ("F-STR-01-GRADE", "Grade", "As per MTC", "Supplier MTC / Third Party Verification", None, "major"),
    ("F-STR-01-QTY", "Qty", "PCS", "Visual", "PCS", "minor"),
    ("F-STR-01-WEIGHT", "Weight", "KG", "Weight M/c", "KG", "minor"),
    ("F-STR-01-SHAPE", "Shape", "Metal Sheet/Child Parts", "Visual", None, "minor"),
    ("F-STR-01-DIMENSION", "Dimension", "As per Drawing", "Measuring Instrument", None, "major"),
    ("F-STR-01-APPEARANCE", "Appearance", "Part should be free from dent, scratch marks, bend, burrs, etc.", "Visual", None, "minor"),
)


def _find_plan(db: Session) -> QualityInspectionPlan | None:
    return db.query(QualityInspectionPlan).options(selectinload(QualityInspectionPlan.lines)).filter(
        QualityInspectionPlan.plan_number == STANDARD_PLAN_NUMBER).first()


def _ensure_characteristics(db: Session) -> dict[str, QualityCharacteristic]:
    have = {c.code: c for c in db.query(QualityCharacteristic).filter(
        QualityCharacteristic.code.in_([p[0] for p in STANDARD_PARAMETERS])).all()}
    for code, name, spec, method, unit, classification in STANDARD_PARAMETERS:
        if code not in have:
            ch = QualityCharacteristic(code=code, name=name, char_type="attribute", unit=unit, method=method,
                                       classification=classification, description=spec, is_active=True)
            db.add(ch)
            have[code] = ch
    db.flush()
    return have


def ensure_standard_incoming_plan(db: Session) -> QualityInspectionPlan:
    """Creates the F/STR/01 characteristics and plan when missing; returns the plan.
    Safe to call any number of times and on a fresh database. Flushes, never
    commits (the caller's transaction owns it). A second request that races us
    to create the same rows loses to the unique code / plan number and simply
    re-reads what the winner wrote."""
    plan = _find_plan(db)
    if plan is not None and (plan.is_deleted or plan.status != "approved"):
        # Deleted / retired by hand in the database: bring it back (the plan number is unique, so a second copy can't be made).
        plan.is_deleted, plan.deleted_at, plan.status, plan.obsoleted_at = False, None, "approved", None
        db.flush()
    if plan is not None and len(plan.lines) >= len(STANDARD_PARAMETERS):
        return plan
    try:
        with db.begin_nested():
            chars = _ensure_characteristics(db)
            if plan is None:
                plan = QualityInspectionPlan(
                    plan_number=STANDARD_PLAN_NUMBER, item_id=None, item_name="All items flagged for incoming inspection",
                    item_code=None, inspection_type="incoming", revision=1, title=STANDARD_TITLE, sampling_type="fixed",
                    aql=None, inspection_level="II", fixed_sample_size=STANDARD_SAMPLE_SIZE, status="approved",
                    remarks="Standard checklist (ISO format F/STR/01). Used for every incoming lot that has no item-specific approved plan.",
                )
                db.add(plan)
                db.flush()
            have_chars = {l.characteristic_id for l in plan.lines}
            for seq, (code, *_rest) in enumerate(STANDARD_PARAMETERS, start=1):
                ch = chars[code]
                if ch.id not in have_chars:
                    plan.lines.append(QualityInspectionPlanLine(characteristic_id=ch.id, sequence=seq * 10))
            db.flush()
    except IntegrityError:
        # Another request created it between our read and write — use theirs.
        plan = _find_plan(db)
        if plan is None:
            raise
    return plan


def is_standard_plan(plan: QualityInspectionPlan | None) -> bool:
    return plan is not None and plan.plan_number == STANDARD_PLAN_NUMBER
