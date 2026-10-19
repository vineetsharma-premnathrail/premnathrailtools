"""Defect Pareto: defect codes ranked by occurrences with cumulative %.

basis = "ncr"         — one occurrence per NCR (quantity = NCR quantity,
                        cost = cost of non-quality); source filter = NCR source.
basis = "lot_results" — one occurrence per failed characteristic on an
                        inspection lot (quantity = defective units found);
                        source filter = inspection type.
"""
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.quality.models.inspection_lot import QualityInspectionLot, QualityLotResult
from app.modules.quality.models.masters import QualityDefectCode
from app.modules.quality.models.ncr import QualityNcr

PARETO_BASES = ("ncr", "lot_results")


def defect_pareto(db: Session, *, basis: str = "ncr", date_from: date | None = None, date_to: date | None = None,
                  item_id: int | None = None, vendor_name: str | None = None, source: str | None = None,
                  user=None) -> dict:
    """`user` limits the NCRs / lots to that user's data scope."""
    from app.core.data_scope import apply_scope
    if basis not in PARETO_BASES:
        raise ValueError("Basis must be 'ncr' (NCRs) or 'lot_results' (failed characteristics on inspection lots).")
    if date_from and date_to and date_from > date_to:
        raise ValueError("'From' date is after the 'to' date.")
    v = (vendor_name or "").strip().lower() or None
    rows: dict = {}
    if basis == "ncr":
        q = db.query(QualityNcr).filter(QualityNcr.is_deleted == False, QualityNcr.status != "cancelled")  # noqa: E712
        if user is not None:
            q = apply_scope(q, user, QualityNcr)
        if date_from:
            q = q.filter(QualityNcr.ncr_date >= date_from)
        if date_to:
            q = q.filter(QualityNcr.ncr_date <= date_to)
        if item_id:
            q = q.filter(QualityNcr.item_id == item_id)
        if v:
            q = q.filter(func.lower(QualityNcr.vendor_name) == v)
        if source:
            q = q.filter(QualityNcr.source == source)
        for n in q.all():
            r = rows.setdefault(n.defect_code_id, {"count": 0, "quantity": 0.0, "cost": 0.0})
            r["count"] += 1
            r["quantity"] += n.quantity or 0
            r["cost"] += (n.material_cost or 0) + (n.rework_cost or 0) + (n.other_cost or 0)
    else:
        q = db.query(QualityLotResult, QualityInspectionLot).join(
            QualityInspectionLot, QualityInspectionLot.id == QualityLotResult.lot_id).filter(QualityLotResult.result == "fail")
        if user is not None:
            q = apply_scope(q, user, QualityInspectionLot)
        if date_from:
            q = q.filter(QualityInspectionLot.lot_date >= date_from)
        if date_to:
            q = q.filter(QualityInspectionLot.lot_date <= date_to)
        if item_id:
            q = q.filter(QualityInspectionLot.item_id == item_id)
        if v:
            q = q.filter(func.lower(QualityInspectionLot.vendor_name) == v)
        if source:
            q = q.filter(QualityInspectionLot.inspection_type == source)
        for res, _lot in q.all():
            r = rows.setdefault(res.defect_code_id, {"count": 0, "quantity": 0.0, "cost": 0.0})
            r["count"] += 1
            bad = (res.defects_found or 0) + sum(
                1 for x in (res.measured_values or [])
                if (res.min_value is not None and float(x) < res.min_value) or (res.max_value is not None and float(x) > res.max_value))
            r["quantity"] += bad
    codes = {c.id: c for c in db.query(QualityDefectCode).filter(QualityDefectCode.id.in_([k for k in rows if k])).all()} if rows else {}
    total = sum(r["count"] for r in rows.values())
    ordered = sorted(rows.items(), key=lambda kv: (-kv[1]["count"], -kv[1]["quantity"]))
    out, cum = [], 0
    for cid, r in ordered:
        c = codes.get(cid)
        cum += r["count"]
        out.append({
            "defect_code_id": cid, "code": c.code if c else "—", "name": c.name if c else "No defect code",
            "category": c.category if c else None, "count": r["count"], "quantity": round(r["quantity"], 4),
            "cost": round(r["cost"], 2), "percent": round(r["count"] * 100 / total, 1) if total else 0,
            "cumulative_percent": round(cum * 100 / total, 1) if total else 0,
            # The "vital few": codes up to and including the one that crosses 80%.
            "vital_few": (cum - r["count"]) * 100 / total < 80 if total else False,
        })
    return {"basis": basis, "total": total, "rows": out}
