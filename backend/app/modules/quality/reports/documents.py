"""Quality documents of record, generated from the lot / NCR data and
rendered by reports/render.py:

  quality_inspection_report   — any decided lot: results per characteristic
  quality_test_certificate    — a decided lot with accepted quantity
                                (certifies the accepted qty to the customer)
  quality_deviation_approval  — an NCR whose use-as-is / repair disposition
                                is approved (concession record with sign-offs)

They are managed Word documents (main/services/managed_documents): the
system builds the .docx on the letterhead, people edit it in Word Online,
the latest version is the document of record and its PDF is rendered from
it. The reportlab PDF here is only the fallback before a Word draft exists.
Lots and NCR decisions are immutable, so each document has one revision (0).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.quality.models.inspection_lot import QualityInspectionLot, QUALITY_LOT_DECISION_LABELS
from app.modules.quality.models.inspection_plan import QUALITY_INSPECTION_TYPE_LABELS, QualityInspectionPlan
from app.modules.quality.models.masters import QualityDefectCode, QualityDispositionCode
from app.modules.quality.models.ncr import QualityNcr, QUALITY_NCR_APPROVAL_ROLE_LABELS
from app.modules.store.models.location import StoreLocation

REPORT = "quality_inspection_report"
CERTIFICATE = "quality_test_certificate"
DEVIATION = "quality_deviation_approval"
DECIDED = ("decision_made", "closed")


class DocumentNotReady(ValueError):
    status = 409


def _name(db: Session, uid: int | None) -> str | None:
    if not uid:
        return None
    u = db.query(User).filter(User.id == uid).first()
    return (u.name or u.email) if u else None


def _d(dt) -> str | None:
    return dt.strftime("%d-%m-%Y") if dt else None


def _q(v, uom=None) -> str:
    return "—" if v is None else f"{v:g}{(' ' + uom) if uom else ''}"


def _limits(r) -> str:
    if r.char_type != "variable":
        return "Pass / fail"
    lo = "–" if r.min_value is None else f"{r.min_value:g}"
    hi = "–" if r.max_value is None else f"{r.max_value:g}"
    nom = "" if r.nominal is None else f"{r.nominal:g} "
    return f"{nom}({lo} … {hi}){(' ' + r.unit) if r.unit else ''}"


def _observed(r) -> str:
    if r.char_type == "variable":
        vals = r.measured_values or []
        if not vals:
            return "—"
        shown = ", ".join(f"{float(v):g}" for v in vals[:8]) + (" …" if len(vals) > 8 else "")
        return f"{shown} (min {min(vals):g}, max {max(vals):g})"
    return f"{r.defects_found or 0} defective"


def _lot_facts(db: Session, lot: QualityInspectionLot) -> list[tuple[str, str | None]]:
    plan = db.query(QualityInspectionPlan).filter(QualityInspectionPlan.id == lot.plan_id).first() if lot.plan_id else None
    loc = db.query(StoreLocation).filter(StoreLocation.id == lot.location_id).first() if lot.location_id else None
    return [
        ("Item", f"{lot.item_code or ''} {lot.item_name}".strip()), ("Inspection", QUALITY_INSPECTION_TYPE_LABELS.get(lot.inspection_type, lot.inspection_type)),
        ("Lot quantity", _q(lot.quantity, lot.uom)), ("Source document", lot.source_reference or lot.source_type),
        ("Batch / serial", lot.batch_number), ("Vendor", lot.vendor_name),
        ("Inspection plan", f"{plan.plan_number} rev {lot.plan_revision}" if plan else None), ("Sampling", lot.sampling_severity.title()),
        ("Store", loc.name if loc else None), ("Lot date", _d(lot.lot_date)),
        ("Test certificate / MTC", lot.test_certificate_reference if lot.test_certificate_received else ("Required — not received" if lot.test_certificate_required else "Not required")),
        ("Results recorded", f"{_name(db, lot.results_recorded_by_id) or '—'}, {_d(lot.results_recorded_at) or '—'}"),
    ]


def _require_decided(lot: QualityInspectionLot, what: str) -> None:
    if lot.status not in DECIDED:
        raise DocumentNotReady(f"Lot {lot.lot_number} has no usage decision yet — the {what} is generated from the decided "
                               "results (lots are never changed after the decision).")


def inspection_report_spec(db: Session, lot: QualityInspectionLot) -> dict:
    _require_decided(lot, "inspection report")
    codes = {c.id: f"{c.code} {c.name}" for c in db.query(QualityDefectCode).all()}
    rows = [[str(i + 1), r.characteristic_name, r.classification.title(), _limits(r), f"{r.sample_size} (Ac {r.accept_number})",
             _observed(r), (r.result or "—").upper(), codes.get(r.defect_code_id, "") if r.result == "fail" else (r.gauge_reference or "")]
            for i, r in enumerate(lot.results)]
    from app.modules.quality.models.ncr import QualityNcr as N
    ncrs = db.query(N).filter(N.lot_id == lot.id, N.is_deleted == False).all()  # noqa: E712
    decision = QUALITY_LOT_DECISION_LABELS.get(lot.decision or "", lot.decision or "—")
    return {
        "title": "INSPECTION REPORT", "number": lot.lot_number,
        "intro": f"{QUALITY_INSPECTION_TYPE_LABELS.get(lot.inspection_type, lot.inspection_type)} inspection of "
                 f"{_q(lot.quantity, lot.uom)} {lot.item_name} against the approved inspection plan.",
        "facts": _lot_facts(db, lot),
        "sections": [
            {"heading": "Results", "columns": ["#", "Characteristic", "Class", "Specification", "Sample", "Observed", "Result", "Defect / gauge"],
             "rows": rows, "widths": [0.3, 1.5, 0.65, 1.2, 0.75, 1.6, 0.55, 1.0]},
            {"heading": "Usage decision", "columns": ["Decision", "Accepted", "Rejected", "Deviation ref.", "Decided by", "Date"],
             "rows": [[decision, _q(lot.accepted_qty, lot.uom), _q(lot.rejected_qty, lot.uom), lot.deviation_reference or "—",
                       _name(db, lot.decided_by_id) or "—", _d(lot.decided_at) or "—"]],
             "widths": [1.4, 0.9, 0.9, 1.3, 1.5, 0.9]},
            {"heading": "Non-conformance reports", "columns": ["NCR", "Severity", "Quantity", "Status"],
             "rows": [[n.ncr_number, n.severity.title(), _q(n.quantity, n.uom), n.status.replace("_", " ")] for n in ncrs],
             "widths": [1.8, 1.2, 1.4, 2.0], "empty": "No NCR — nothing rejected."},
        ],
        "remarks": lot.decision_remarks,
        "signatures": [("Inspected by", _name(db, lot.results_recorded_by_id)), ("Decision by", _name(db, lot.decided_by_id))],
    }


def test_certificate_spec(db: Session, lot: QualityInspectionLot) -> dict:
    _require_decided(lot, "test certificate")
    if not lot.accepted_qty:
        raise DocumentNotReady(f"Lot {lot.lot_number} was fully rejected — there is no accepted quantity to certify.")
    rows = [[r.characteristic_name, _limits(r), _observed(r), (r.result or "—").upper()] for r in lot.results]
    deviation = f" Accepted under deviation / concession {lot.deviation_reference}." if lot.decision == "accept_with_deviation" else ""
    return {
        "title": "TEST CERTIFICATE", "number": f"TC-{lot.lot_number}",
        "intro": None,
        "facts": [
            ("Item", f"{lot.item_code or ''} {lot.item_name}".strip()), ("Certified quantity", _q(lot.accepted_qty, lot.uom)),
            ("Batch / serial", lot.batch_number), ("Reference", lot.source_reference),
            ("Inspection lot", lot.lot_number), ("Date of inspection", _d(lot.decided_at)),
            ("Raw material MTC", lot.test_certificate_reference), ("Inspection type", QUALITY_INSPECTION_TYPE_LABELS.get(lot.inspection_type)),
        ],
        "sections": [{"heading": "Test / inspection results", "columns": ["Characteristic", "Specification", "Observed", "Result"],
                      "rows": rows, "widths": [2.0, 1.6, 2.6, 0.9]}],
        "statement": f"We certify that the {_q(lot.accepted_qty, lot.uom)} of {lot.item_name} listed above have been inspected "
                     f"and tested as per the approved inspection plan and conform to the specified requirements.{deviation}",
        "remarks": None,
        "signatures": [("Inspected by", _name(db, lot.results_recorded_by_id)), ("For Quality (authorised signatory)", _name(db, lot.decided_by_id))],
    }


def deviation_spec(db: Session, ncr: QualityNcr) -> dict:
    if ncr.disposition_type not in ("use_as_is", "repair") or ncr.disposition_status != "approved":
        raise DocumentNotReady(f"{ncr.ncr_number} has no approved 'use as is' or 'repair' disposition — the deviation "
                               "approval is generated once that disposition is approved by every required authority.")
    code = db.query(QualityDispositionCode).filter(QualityDispositionCode.id == ncr.disposition_code_id).first() if ncr.disposition_code_id else None
    defect = db.query(QualityDefectCode).filter(QualityDefectCode.id == ncr.defect_code_id).first() if ncr.defect_code_id else None
    approvals = [a for a in ncr.approvals if not a.superseded and a.decision == "approved"]
    return {
        "title": "DEVIATION APPROVAL", "number": f"DEV-{ncr.ncr_number}",
        "intro": f"Concession to {'use as is' if ncr.disposition_type == 'use_as_is' else 'repair and use'} non-conforming material "
                 f"recorded under {ncr.ncr_number}.",
        "facts": [
            ("Item", f"{ncr.item_code or ''} {ncr.item_name}".strip()), ("Quantity", _q(ncr.quantity, ncr.uom)),
            ("Batch / serial", ncr.batch_number), ("Vendor", ncr.vendor_name),
            ("Source", ncr.source_reference), ("Severity", ncr.severity.title()),
            ("Defect", f"{defect.code} {defect.name}" if defect else None), ("Disposition", code.name if code else ncr.disposition_type),
            ("Customer approval", ncr.customer_approval_reference or ("Required" if ncr.customer_approval_required else "Not required")),
            ("NCR date", _d(ncr.ncr_date)),
        ],
        "sections": [
            {"heading": "Non-conformance", "columns": ["Description"], "rows": [[ncr.description]], "widths": [7.1]},
            {"heading": "Disposition / justification", "columns": ["Remarks"], "rows": [[ncr.disposition_remarks or "—"]], "widths": [7.1]},
            {"heading": "Approvals", "columns": ["Authority", "Approved by", "Date", "Remarks"],
             "rows": [[QUALITY_NCR_APPROVAL_ROLE_LABELS.get(a.role, a.role), _name(db, a.approved_by_id) or "—", _d(a.created_at) or "—", a.remarks or ""]
                      for a in approvals], "widths": [1.4, 1.8, 1.0, 2.9]},
        ],
        "statement": "The material above is released under this deviation only; the deviation does not change the drawing "
                     "or specification for any other lot.",
        "remarks": ncr.remarks,
        "signatures": [(QUALITY_NCR_APPROVAL_ROLE_LABELS.get(a.role, a.role), _name(db, a.approved_by_id)) for a in approvals[:3]],
    }
