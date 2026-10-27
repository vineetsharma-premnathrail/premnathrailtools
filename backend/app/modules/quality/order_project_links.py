"""Quality's column on the project Units 360 (Project Management › All Projects › Units).

Registered at startup (imported from quality/routes/__init__.py):

    department provider 'quality' — per element, from its Sales Order's
    inspection requirement + the inspection calls / final inspection lots
    linked to the element:
        Not required (neutral) · <Agency> required — not called (warning) ·
        Called <date> (info) · Accepted (success) · Rejected (danger)
    with the internal final inspection lot result in the detail line (or as
    the cell itself when no third-party inspection is due).

No project hook: nothing is created when a vehicle element appears — the
inspection call is raised when the vehicle is ready; until then the cell shows
"<Agency> required — not called". No element status hook either: 'ready'
stays Production's word (the dispatch block, rule 8, is what holds a vehicle
back until the agency clears it).
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.modules.quality.models.inspection_call import QualityInspectionCall
from app.modules.quality.models.inspection_lot import QualityInspectionLot, QUALITY_LOT_DECISION_LABELS
from app.modules.projects import so_projects as op_core
from app.modules.sales.models.order import SalesOrder

_ACCEPTING = ("accept", "accept_with_deviation", "partial")


def _d(d: date | None) -> str:
    return d.strftime("%d-%b-%Y") if d else ""


def _cell(status: str, label: str, tone: str, detail: str | None = None, on: date | None = None) -> dict:
    return {"status": status, "label": label, "tone": tone, "detail": detail or None, "date": on.isoformat() if on else None}


def _lot_text(lot: QualityInspectionLot | None) -> tuple[str | None, str | None]:
    """(text, tone) of the latest final inspection lot of the element."""
    if lot is None:
        return None, None
    if lot.status == "cancelled":
        return None, None
    if lot.decision:
        label = QUALITY_LOT_DECISION_LABELS.get(lot.decision, lot.decision)
        tone = "success" if lot.decision in ("accept", "accept_with_deviation") else (
            "warning" if lot.decision == "partial" else "danger")
        return f"Final inspection {lot.lot_number}: {label}", tone
    return f"Final inspection {lot.lot_number} in progress", "info"


def quality_cells(db: Session, project, elements) -> dict[int, dict | None]:
    from app.modules.quality.services.dispatch import _agency_label
    so = db.get(SalesOrder, project.sales_order_id) if project.sales_order_id else None
    if so is None:
        return {}
    live = [el for el in elements if el.status != "cancelled"]
    ids = [el.id for el in live]
    if not ids:
        return {}
    calls: dict[int, list[QualityInspectionCall]] = {}
    for c in (db.query(QualityInspectionCall)
              .filter(QualityInspectionCall.order_project_element_id.in_(ids), QualityInspectionCall.status != "cancelled")
              .order_by(QualityInspectionCall.id).all()):
        calls.setdefault(c.order_project_element_id, []).append(c)
    final_lots: dict[int, QualityInspectionLot] = {}
    for lot in (db.query(QualityInspectionLot)
                .filter(QualityInspectionLot.order_project_element_id.in_(ids),
                        QualityInspectionLot.inspection_type.in_(("final", "first_article")),
                        QualityInspectionLot.status != "cancelled")
                .order_by(QualityInspectionLot.id).all()):
        final_lots[lot.order_project_element_id] = lot  # latest wins

    required = bool(so.third_party_inspection_required)
    agency = _agency_label(db, so.inspection_agency) if so.inspection_agency else None
    out: dict[int, dict | None] = {}
    for el in live:
        lot_txt, lot_tone = _lot_text(final_lots.get(el.id))
        mine = calls.get(el.id, [])
        need = float(el.quantity or 1)
        cleared = sum(c.accepted_qty or 0.0 for c in mine
                      if c.status in ("accepted", "partially_accepted") and c.certificate_number)
        latest = mine[-1] if mine else None
        if not required and not mine:
            if lot_txt:
                out[el.id] = _cell("final_inspection", ("Final: " + lot_txt.split(": ")[-1]) if ": " in lot_txt else "Final in progress",
                                   lot_tone, f"{lot_txt} · no third-party inspection on Sales Order {so.display_number}")
            else:
                out[el.id] = _cell("not_required", "Not required", "neutral",
                                   f"Sales Order {so.display_number} has no third-party inspection")
            continue
        who = agency or (latest.agency.upper() if latest else "Third-party")
        extra = [lot_txt] if lot_txt else []
        if latest is None:
            out[el.id] = _cell("not_called", f"{who} required — not called", "warning",
                               " · ".join([f"From Sales Order {so.display_number}"] + extra))
        elif cleared >= need - 1e-6:
            certs = ", ".join(sorted({c.certificate_number for c in mine if c.certificate_number}))
            last_ok = max((c for c in mine if c.status in ("accepted", "partially_accepted")),
                          key=lambda c: (c.result_date or date.min, c.id))
            out[el.id] = _cell("accepted", "Accepted", "success",
                               " · ".join([f"{who} {certs}".strip(), _d(last_ok.result_date)] + extra), last_ok.result_date)
        elif latest.status in ("requested", "scheduled"):
            when = latest.call_date or latest.requested_date
            label = f"Called {_d(when)}" if when else "Called"
            out[el.id] = _cell("called", label, "info",
                               " · ".join([f"{latest.call_number} ({who})",
                                           "inspection date fixed" if latest.call_date else "awaiting the agency's date"] + extra),
                               when)
        elif latest.status == "rejected":
            out[el.id] = _cell("rejected", "Rejected", "danger",
                               " · ".join([f"{latest.call_number} rejected by {who} on {_d(latest.result_date)}"] + extra),
                               latest.result_date)
        else:  # partially accepted, not enough cleared yet
            out[el.id] = _cell("partial", f"{cleared:g} of {need:g} accepted", "warning",
                               " · ".join([f"{latest.call_number} ({who}) — offer the rest"] + extra), latest.result_date)
    return out


op_core.register_department_provider("quality", quality_cells)
