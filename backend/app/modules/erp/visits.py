"""Service confirmations (SAP IW41 for customer service): visit log rules
and the SR roll-up.

Once an SR has visits, the visits are the source of its execution and cost
figures — they are no longer typed on the SR:
  transport_cost       = Σ visit travel_cost
  accommodation_cost   = Σ visit stay_cost
  miscellaneous_cost   = Σ visit misc_cost
  service_cost         = Σ work_hours × labour rate + Σ travel_hours × travel
                         rate (Service › Settings) — only when a rate is set;
                         with both rates 0 the labour charge stays typed
  actual_service_duration_hours = Σ work_hours
  actual_date_attended = earliest visit date
  SLA first response   = earliest engineer arrival (erp/sla.py)"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.erp.models.service_visit import ServiceVisit

# SR statuses in which visits can be logged / changed.
VISIT_OPEN_STATUSES = ("assigned", "scheduled", "in_progress", "pending_parts", "on_hold", "work_completed")
ROLLED_UP_FIELDS = {
    "transport_cost": "Transport cost", "accommodation_cost": "Accommodation / stay cost",
    "miscellaneous_cost": "Miscellaneous cost",
}
VISIT_REPORT_ENTITY = "erp_service_visit_report"


def visits_for(db: Session, sr_id: int) -> list[ServiceVisit]:
    return db.query(ServiceVisit).filter(ServiceVisit.service_request_id == sr_id).order_by(
        ServiceVisit.visit_date, ServiceVisit.id).all()


def rates(db: Session) -> tuple[float, float]:
    from app.modules.erp.settings import get_setting
    def _f(key):
        try:
            return float(get_setting(db, key) or 0)
        except Exception:  # noqa: BLE001 — setting missing on an old install
            return 0.0
    return _f("service_labour_rate_per_hour"), _f("service_travel_rate_per_hour")


def labour_from_visits(db: Session) -> bool:
    labour, travel = rates(db)
    return labour > 0 or travel > 0


def apply_visit_rollup(db: Session, sr) -> bool:
    """Roll the visits into the SR. Returns False (SR untouched) when it has
    no visits. Called from service_requests._recompute_billing."""
    visits = visits_for(db, sr.id)
    if not visits:
        return False
    sr.transport_cost = round(sum(v.travel_cost or 0 for v in visits), 2)
    sr.accommodation_cost = round(sum(v.stay_cost or 0 for v in visits), 2)
    sr.miscellaneous_cost = round(sum(v.misc_cost or 0 for v in visits), 2)
    work = round(sum(v.work_hours or 0 for v in visits), 2)
    travel = round(sum(v.travel_hours or 0 for v in visits), 2)
    labour_rate, travel_rate = rates(db)
    if labour_rate > 0 or travel_rate > 0:
        sr.service_cost = round(work * labour_rate + travel * travel_rate, 2)
    sr.actual_service_duration_hours = work
    sr.actual_date_attended = min(v.visit_date for v in visits)
    arrivals = [v.arrive_at for v in visits if v.arrive_at]
    if arrivals:
        from app.modules.erp import sla
        sla.record_response(sr, min(sla._aware(a) for a in arrivals))
    return True


def hours_summary(db: Session, sr_id: int) -> dict:
    visits = visits_for(db, sr_id)
    return {
        "visit_count": len(visits),
        "engineer_count": len({v.engineer_id for v in visits}),
        "work_hours": round(sum(v.work_hours or 0 for v in visits), 2),
        "travel_hours": round(sum(v.travel_hours or 0 for v in visits), 2),
        "km": round(sum(v.km or 0 for v in visits), 1),
        "travel_cost": round(sum(v.travel_cost or 0 for v in visits), 2),
        "stay_cost": round(sum(v.stay_cost or 0 for v in visits), 2),
        "misc_cost": round(sum(v.misc_cost or 0 for v in visits), 2),
        "signed_off": sum(1 for v in visits if v.customer_signed_at),
    }
