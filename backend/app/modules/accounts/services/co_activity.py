"""CO activity prices (SAP KP26) — maintenance and the rate lookup used by
production costing.

Lookup order for a workstation hour on a date:
  1. the workstation's own rate for the activity type, valid on the date;
  2. the rate of the workstation's cost centre for that type;
  3. the workstation's flat hourly_rate (what production used before CO
     rates existed), so nothing changes until Finance maintains a rate.
A time log with no activity type is a plain workstation hour: the machine
hour and labour hour rates together (each found as above; if neither has a
CO rate, the flat hourly_rate)."""
from __future__ import annotations

from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.accounts.models.co_activity import CO_ACTIVITY_TYPES, CoActivityRate
from app.modules.accounts.services import fiscal
from app.modules.organization.models.cost_center import CostCenter

COMBINED_TYPES = ("MCH", "LAB")


def _d(x: date | None) -> str:
    return x.strftime("%d-%b-%Y") if x else "open-ended"


def activity_type_options() -> list[dict]:
    return [{"value": k, "label": v[0], "unit": v[1]} for k, v in CO_ACTIVITY_TYPES.items()]


def _check_type(activity_type: str) -> str:
    code = (activity_type or "").strip().upper()
    if code not in CO_ACTIVITY_TYPES:
        allowed = ", ".join(f"{k} ({v[0]})" for k, v in CO_ACTIVITY_TYPES.items())
        raise ValueError(f"'{activity_type}' isn't an activity type — use one of {allowed}.")
    return code


def validate_rate(db: Session, data: dict, *, rate_id: int | None = None) -> dict:
    """Checks a rate before it is saved; returns the cleaned values."""
    from app.modules.production.models.workstation import ProductionWorkstation

    out = dict(data)
    out["activity_type"] = _check_type(out.get("activity_type"))
    ws_id, cc_id = out.get("workstation_id"), out.get("cost_center_id")
    if bool(ws_id) == bool(cc_id):
        raise ValueError("Pick either a workstation or a cost centre for the rate — exactly one of the two. "
                         "A workstation's own rate wins over its cost centre's.")
    if ws_id and not db.query(ProductionWorkstation.id).filter(ProductionWorkstation.id == ws_id).first():
        raise ValueError(f"Workstation #{ws_id} doesn't exist — pick it again from the list.")
    if cc_id and not db.query(CostCenter.id).filter(CostCenter.id == cc_id).first():
        raise ValueError(f"Cost centre #{cc_id} doesn't exist — pick it again from the list.")
    vf, vt = out.get("valid_from"), out.get("valid_to")
    if not vf:
        raise ValueError("Give the date the rate is valid from.")
    if vt and vt < vf:
        raise ValueError(f"'Valid to' ({_d(vt)}) is before 'valid from' ({_d(vf)}) — swap them.")
    fy = fiscal.fiscal_year_for(db, vf)
    if vt and vt > fy.end_date:
        raise ValueError(f"A rate belongs to one financial year: {fy.code} ends {_d(fy.end_date)}, but 'valid to' is "
                         f"{_d(vt)}. End it on {_d(fy.end_date)} and add next year's rate separately.")
    out["financial_year"] = fy.code
    for k in ("fixed_rate", "variable_rate"):
        v = float(out.get(k) or 0)
        if v < 0:
            raise ValueError("A rate can't be negative.")
        out[k] = round(v, 4)
    if out["fixed_rate"] + out["variable_rate"] <= 0:
        raise ValueError("Enter the fixed and/or variable part of the rate — the total must be more than zero.")

    q = db.query(CoActivityRate).filter(CoActivityRate.activity_type == out["activity_type"])
    q = q.filter(CoActivityRate.workstation_id == ws_id) if ws_id else q.filter(CoActivityRate.cost_center_id == cc_id)
    if rate_id:
        q = q.filter(CoActivityRate.id != rate_id)
    end = vt or date.max
    for other in q.all():
        o_end = other.valid_to or date.max
        if other.valid_from <= end and vf <= o_end:
            raise ValueError(
                f"This overlaps the existing {other.activity_type} rate valid {_d(other.valid_from)} to {_d(other.valid_to)} "
                f"(₹{other.rate:,.2f}/h). End that rate the day before {_d(vf)}, or change these dates.")
    return out


def _valid(q, on: date):
    return q.filter(CoActivityRate.valid_from <= on, or_(CoActivityRate.valid_to.is_(None), CoActivityRate.valid_to >= on))


def find_rate(db: Session, workstation, activity_type: str, on: date) -> CoActivityRate | None:
    """The CO rate for one activity type of a workstation, valid on `on`."""
    if workstation is None:
        return None
    base = _valid(db.query(CoActivityRate).filter(CoActivityRate.activity_type == activity_type), on)
    own = base.filter(CoActivityRate.workstation_id == workstation.id).first()
    if own:
        return own
    cc_id = getattr(workstation, "cost_center_id", None)
    return base.filter(CoActivityRate.cost_center_id == cc_id).first() if cc_id else None


def workstation_hour_rate(db: Session, workstation, on: date | None = None,
                          activity_type: str | None = None) -> tuple[float, str]:
    """(rate per hour, source) for booking or costing an hour on `workstation`.
    source: 'co_rate' when a CO activity price was used, else 'hourly_rate'."""
    if workstation is None:
        return 0.0, "none"
    on = on or date.today()
    flat = float(workstation.hourly_rate or 0.0)
    if activity_type:
        rate = find_rate(db, workstation, activity_type.upper(), on)
        return (rate.rate, "co_rate") if rate else (flat, "hourly_rate")
    rates = [r for r in (find_rate(db, workstation, t, on) for t in COMBINED_TYPES) if r]
    if not rates:
        return flat, "hourly_rate"
    return round(sum(r.rate for r in rates), 4), "co_rate"


def workstation_rate_map(db: Session, workstation_ids: set[int], on: date | None = None) -> dict[int, float]:
    """{workstation_id: plain-hour rate on `on`} — CO rates where maintained,
    else the flat hourly_rate."""
    from app.modules.production.models.workstation import ProductionWorkstation

    ids = {i for i in workstation_ids if i}
    if not ids:
        return {}
    return {w.id: workstation_hour_rate(db, w, on)[0]
            for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.id.in_(ids)).all()}


def rate_rows(db: Session, *, financial_year: str | None = None, workstation_id: int | None = None,
              cost_center_id: int | None = None) -> list[dict]:
    from app.modules.production.models.workstation import ProductionWorkstation

    q = db.query(CoActivityRate)
    if financial_year:
        q = q.filter(CoActivityRate.financial_year == financial_year)
    if workstation_id:
        q = q.filter(CoActivityRate.workstation_id == workstation_id)
    if cost_center_id:
        q = q.filter(CoActivityRate.cost_center_id == cost_center_id)
    rows = q.order_by(CoActivityRate.financial_year.desc(), CoActivityRate.activity_type, CoActivityRate.valid_from).all()
    ws = {w.id: w for w in db.query(ProductionWorkstation).filter(
        ProductionWorkstation.id.in_({r.workstation_id for r in rows if r.workstation_id})).all()} if rows else {}
    ccs = {c.id: c for c in db.query(CostCenter).filter(
        CostCenter.id.in_({r.cost_center_id for r in rows if r.cost_center_id})).all()} if rows else {}
    out = []
    for r in rows:
        w, c = ws.get(r.workstation_id), ccs.get(r.cost_center_id)
        out.append({
            "id": r.id, "activity_type": r.activity_type, "activity_label": CO_ACTIVITY_TYPES.get(r.activity_type, (r.activity_type,))[0],
            "workstation_id": r.workstation_id, "workstation_label": f"{w.code} — {w.name}" if w else None,
            "cost_center_id": r.cost_center_id, "cost_center_label": f"{c.code} — {c.name}" if c else None,
            "financial_year": r.financial_year, "valid_from": r.valid_from, "valid_to": r.valid_to,
            "fixed_rate": float(r.fixed_rate or 0), "variable_rate": float(r.variable_rate or 0), "rate": r.rate,
            "fixed_share_pct": round(float(r.fixed_rate or 0) / r.rate * 100, 1) if r.rate else 0.0,
            "notes": r.notes,
        })
    return out
