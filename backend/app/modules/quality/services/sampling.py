"""Sample size and accept/reject numbers for an inspection lot.

ISO 2859-1 / IS 2500 Part 1 single sampling, general inspection level II
by default, normal / tightened / reduced switching state per lot. Critical
characteristics are always inspected 100% with accept number 0. Plans can
instead ask for 100% ("full") or a fixed quantity."""
import math
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.modules.quality.models.sampling import QualitySampleSizeCode, QualityAqlPlan
from app.modules.quality.sampling_tables import build_aql_rows, build_code_letter_rows, AQL_VALUES


@dataclass
class SamplingResult:
    sample_size: int
    accept_number: int
    reject_number: int
    code_letter: str | None = None
    basis: str = ""


def ensure_sampling_tables(db: Session) -> None:
    """Seeds the AQL tables on a fresh database (the migration seeds
    production; tests use create_all and come through here)."""
    if db.query(QualitySampleSizeCode.id).first() is None:
        db.add_all([QualitySampleSizeCode(**r) for r in build_code_letter_rows()])
    if db.query(QualityAqlPlan.id).first() is None:
        db.add_all([QualityAqlPlan(**r) for r in build_aql_rows()])
    db.flush()


def nearest_aql(aql: float) -> float:
    """Snaps a typed AQL (e.g. 1) to the table's preferred value (1.0)."""
    for v in AQL_VALUES:
        if abs(v - aql) < 1e-9:
            return v
    raise ValueError(
        f"AQL {aql:g} isn't in the ISO 2859-1 preferred series — use one of "
        + ", ".join(f"{v:g}" for v in AQL_VALUES) + "."
    )


def code_letter_for(db: Session, lot_size: float, level: str = "II") -> str:
    ensure_sampling_tables(db)
    n = max(2, int(math.ceil(lot_size)))
    row = db.query(QualitySampleSizeCode).filter(
        QualitySampleSizeCode.inspection_level == level,
        QualitySampleSizeCode.lot_size_min <= n,
    ).order_by(QualitySampleSizeCode.lot_size_min.desc()).first()
    if not row:
        raise ValueError(f"No ISO 2859-1 code letter for lot size {lot_size:g} at inspection level {level}.")
    return row.code_letter


def aql_plan(db: Session, lot_size: float, aql: float, level: str = "II", severity: str = "normal") -> SamplingResult:
    letter = code_letter_for(db, lot_size, level)
    aql = nearest_aql(aql)
    row = db.query(QualityAqlPlan).filter(
        QualityAqlPlan.code_letter == letter, QualityAqlPlan.severity == severity,
        QualityAqlPlan.aql >= aql - 1e-9, QualityAqlPlan.aql <= aql + 1e-9,
    ).first()
    if not row:
        raise ValueError(f"No {severity} sampling plan for code letter {letter}, AQL {aql:g}.")
    lot_units = int(math.ceil(lot_size))
    n = row.sample_size
    basis = f"ISO 2859-1 level {level}, {severity}, code {letter}, AQL {aql:g}"
    if n >= lot_units:
        # Sample size reaches the lot size → inspect 100% (standard's note).
        n = lot_units
        basis += " — sample ≥ lot, 100% inspection"
    return SamplingResult(sample_size=n, accept_number=row.accept_number, reject_number=row.reject_number,
                          code_letter=letter, basis=basis)


def sampling_for_line(
    db: Session, *, lot_size: float, classification: str, sampling_type: str, aql: float | None,
    level: str, severity: str, fixed_sample_size: int | None,
) -> SamplingResult:
    lot_units = max(1, int(math.ceil(lot_size)))
    if classification == "critical":
        return SamplingResult(sample_size=lot_units, accept_number=0, reject_number=1, basis="Critical characteristic — 100%, accept 0")
    if sampling_type == "full":
        return SamplingResult(sample_size=lot_units, accept_number=0, reject_number=1, basis="100% inspection")
    if sampling_type == "fixed":
        n = min(lot_units, max(1, int(fixed_sample_size or 1)))
        return SamplingResult(sample_size=n, accept_number=0, reject_number=1, basis=f"Fixed sample of {n}, accept 0")
    if aql is None:
        raise ValueError("This plan uses AQL sampling but no AQL is set on the plan or the line — set one in the inspection plan.")
    return aql_plan(db, lot_size, aql, level, severity)
