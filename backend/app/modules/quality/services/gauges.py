"""Gauge / test-equipment calibration control (QM-IM, ISO 9001 7.1.5).

- `usable_problem` is the rule results recording calls: an instrument is
  usable only while `active` and not past its next calibration due date.
- `record_calibration` posts a calibration: pass / adjusted re-dates the
  gauge (next due = calibrated on + interval, or the date given), fail puts
  it out of calibration so it is blocked until a passing calibration.
- `due_soon` feeds the daily reminder."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.modules.quality.models.gauge import QUALITY_CALIBRATION_RESULTS, QualityGauge, QualityGaugeCalibration


class GaugeError(Exception):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def calibration_state(g: QualityGauge, today: date | None = None) -> str:
    """ok / due_soon (within 15 days) / overdue / never_calibrated / blocked."""
    today = today or date.today()
    if g.status != "active":
        return "blocked"
    if g.next_due_on is None:
        return "never_calibrated"
    if g.next_due_on < today:
        return "overdue"
    if g.next_due_on <= today + timedelta(days=15):
        return "due_soon"
    return "ok"


def usable_problem(g: QualityGauge | None, gauge_id: int | None = None, today: date | None = None) -> str | None:
    today = today or date.today()
    if g is None or g.is_deleted:
        return f"Gauge #{gauge_id} is not in the gauge register (Quality › Gauges). Pick a registered instrument."
    label = f"Gauge {g.code} ({g.name})"
    if g.status == "scrapped":
        return f"{label} is scrapped and can't be used for inspection. Pick another instrument."
    if g.status == "out_of_calibration":
        return f"{label} is out of calibration (last calibration failed or it was found damaged). Use another instrument until it passes a calibration."
    if g.next_due_on is None:
        return f"{label} has never been calibrated. Record its calibration in Quality › Gauges before using it to record results."
    if g.next_due_on < today:
        return (f"{label} was due for calibration on {g.next_due_on:%d-%m-%Y} ({(today - g.next_due_on).days} day(s) overdue). "
                "Results can't be recorded with an overdue instrument — calibrate it or use another one.")
    return None


def check_usable(db: Session, gauge_id: int) -> QualityGauge:
    g = db.query(QualityGauge).filter(QualityGauge.id == gauge_id).first()
    problem = usable_problem(g, gauge_id)
    if problem:
        raise GaugeError(problem, 422)
    return g


def record_calibration(db: Session, g: QualityGauge, *, calibrated_on: date, result: str, user_id: int | None,
                       next_due_on: date | None = None, agency: str | None = None, certificate_ref: str | None = None,
                       error_found: float | None = None, remarks: str | None = None) -> QualityGaugeCalibration:
    if result not in QUALITY_CALIBRATION_RESULTS:
        raise GaugeError(f"Calibration result must be one of: {', '.join(QUALITY_CALIBRATION_RESULTS)}.", 400)
    if g.status == "scrapped":
        raise GaugeError(f"Gauge {g.code} is scrapped — a scrapped instrument isn't calibrated. Register a new one instead.")
    if calibrated_on > date.today():
        raise GaugeError("The calibration date can't be in the future.", 400)
    if result != "fail":
        due = next_due_on or (calibrated_on + timedelta(days=g.calibration_interval_days or 365))
        if due <= calibrated_on:
            raise GaugeError("The next due date must be after the calibration date.", 400)
    else:
        due = None
    cal = QualityGaugeCalibration(
        gauge_id=g.id, calibrated_on=calibrated_on, result=result, next_due_on=due, agency=(agency or "").strip() or None,
        certificate_ref=(certificate_ref or "").strip() or None, error_found=error_found,
        remarks=(remarks or "").strip() or None, recorded_by_id=user_id,
    )
    db.add(cal)
    if result == "fail":
        g.status = "out_of_calibration"
    else:
        # Only the latest calibration moves the gauge's dates.
        if g.last_calibrated_on is None or calibrated_on >= g.last_calibrated_on:
            g.last_calibrated_on, g.next_due_on = calibrated_on, due
            g.certificate_ref = cal.certificate_ref or g.certificate_ref
            g.calibration_agency = cal.agency or g.calibration_agency
        g.status = "active"
    db.flush()
    return cal


def due_soon(db: Session, within_days: int, today: date | None = None) -> list[QualityGauge]:
    today = today or date.today()
    return db.query(QualityGauge).filter(
        QualityGauge.is_deleted == False, QualityGauge.status == "active",  # noqa: E712
        QualityGauge.next_due_on != None, QualityGauge.next_due_on <= today + timedelta(days=within_days),  # noqa: E711
    ).order_by(QualityGauge.next_due_on).all()
