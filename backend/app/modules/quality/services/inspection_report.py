"""Inspection report of one lot as an Excel sheet in the owner's ISO format F/STR/01
"Incoming Inspection Standard" (template: quality/print_templates/f_str_01_incoming_inspection.xlsx).

The template's header box (logo, Format No / Effective Date / Rev), title, column
headings, the six-parameter body and the Prepared / Approved / Customer Approved
footer (with its signature images) are kept. The lot's own data is added: a lot
information band above the table, a Result and an Observed column next to the
template's columns, the decision block and the inspector below the table.
Rows are added as needed (an item with its own plan can have more than six
parameters); the footer moves down with them.

The template is read with openpyxl only — nothing in it is ever executed.

`collect(db, lot)` gathers the data (DB), `build_xlsx(data)` draws it (no DB) so it
can be tested alone."""
import io
import math
import re
from copy import copy
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session

from app.core.reporting.xlsx import put
from app.modules.main.models.user import User
from app.modules.quality.models.characteristic import QualityCharacteristic
from app.modules.quality.models.inspection_lot import QualityInspectionLot, QUALITY_LOT_DECISION_LABELS
from app.modules.quality.models.inspection_plan import QUALITY_INSPECTION_TYPE_LABELS, QualityInspectionPlan
from app.modules.quality.models.masters import QualityDefectCode

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "print_templates" / "f_str_01_incoming_inspection.xlsx"

_LAST_COL = 12  # L: A-J are the template's columns, K = Result, L = Observed / remarks
_FIRST_BODY_ROW_IN_TEMPLATE = 6  # row 5 is the title; everything from row 6 is rebuilt
_THIN = Side(style="thin")
_BOX = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_NOTE_ABNORMAL = "In case of any abnormal situation inform to QA In-charge immediately and sampling plan will be doubled."

_STATUS_LABELS = {
    "created": "Waiting for inspection", "in_inspection": "In inspection", "results_recorded": "Results recorded — waiting for the decision",
    "decision_made": "Decision made", "closed": "Closed", "cancelled": "Cancelled",
}


@dataclass
class ReportRow:
    parameter: str
    specification: str = ""
    method: str = ""
    sample_size: int | None = None
    acceptance: str = ""
    result: str = ""          # "OK" / "NOT OK" / "" (not recorded)
    observed: str = ""


@dataclass
class ReportData:
    lot_number: str
    status: str
    inspection_type_label: str
    grn_number: str
    vendor: str
    item_code: str
    item_name: str
    lot_qty_text: str
    lot_date: date | None
    batch: str
    sample_size: int | None
    sampling_text: str
    plan_text: str
    certificate_text: str
    rows: list[ReportRow] = field(default_factory=list)
    decision_text: str = ""
    decided_by: str = ""
    decided_at: date | None = None
    inspector: str = ""
    results_date: date | None = None
    decision_remarks: str = ""
    operation_name: str = "INCOMING INSPECTION"
    standard_plan: bool = False


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def _num(v: float) -> str:
    return f"{v:g}"


def _spec_text(res, ch: QualityCharacteristic | None) -> str:
    parts: list[str] = []
    if ch is not None and ch.description:
        parts.append(ch.description)
    if res.char_type == "variable" and (res.nominal is not None or res.min_value is not None or res.max_value is not None):
        lim = []
        if res.nominal is not None:
            lim.append(_num(res.nominal))
        if res.min_value is not None or res.max_value is not None:
            lim.append(f"({_num(res.min_value) if res.min_value is not None else '…'} to "
                       f"{_num(res.max_value) if res.max_value is not None else '…'})")
        parts.append(" ".join(lim) + (f" {res.unit}" if res.unit else ""))
    elif res.unit and not parts:
        parts.append(res.unit)
    return "\n".join(parts)


def _observed_text(res, defect_label: str | None) -> str:
    lines: list[str] = []
    if res.measured_values:
        lines.append("Measured: " + ", ".join(_num(float(v)) for v in res.measured_values) + (f" {res.unit}" if res.unit else ""))
    if res.defects_found is not None:
        lines.append(f"{res.defects_found} defective of {res.sample_size} checked")
    if res.gauge_reference:
        lines.append(f"Instrument: {res.gauge_reference}")
    if defect_label and res.result == "fail":
        lines.append(f"Defect: {defect_label}")
    if res.remarks:
        lines.append(res.remarks)
    return "\n".join(lines)


def _plain_date(v: date | datetime | None) -> date | None:
    return v.date() if isinstance(v, datetime) else v


def collect(db: Session, lot: QualityInspectionLot) -> ReportData:
    from app.modules.quality.services.standard_checklist import is_standard_plan
    plan = db.query(QualityInspectionPlan).filter(QualityInspectionPlan.id == lot.plan_id).first() if lot.plan_id else None
    chars = {c.id: c for c in db.query(QualityCharacteristic).filter(
        QualityCharacteristic.id.in_([r.characteristic_id for r in lot.results] or [-1])).all()}
    codes = {c.id: f"{c.code} — {c.name}" for c in db.query(QualityDefectCode).filter(
        QualityDefectCode.id.in_([r.defect_code_id for r in lot.results if r.defect_code_id] or [-1])).all()}
    uids = {lot.assigned_to_id, lot.results_recorded_by_id, lot.decided_by_id} | {r.recorded_by_id for r in lot.results}
    uids.discard(None)
    users = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}

    rows: list[ReportRow] = []
    for r in sorted(lot.results, key=lambda x: (x.sequence, x.id)):
        accept = f"Accept {r.accept_number} / Reject {r.reject_number}" if r.accept_number else "Zero Defect"
        rows.append(ReportRow(
            parameter=r.characteristic_name, specification=_spec_text(r, chars.get(r.characteristic_id)), method=r.method or "",
            sample_size=r.sample_size, acceptance=accept,
            result={"pass": "OK", "fail": "NOT OK"}.get(r.result or "", ""), observed=_observed_text(r, codes.get(r.defect_code_id)),
        ))

    decision = ""
    if lot.decision:
        decision = QUALITY_LOT_DECISION_LABELS.get(lot.decision, lot.decision)
        decision += f" — accepted {_num(lot.accepted_qty or 0)}, rejected {_num(lot.rejected_qty or 0)} {lot.uom or ''}".rstrip()
        if lot.deviation_reference:
            decision += f" (deviation {lot.deviation_reference})"
    else:
        decision = _STATUS_LABELS.get(lot.status, lot.status)

    sampling = {"normal": "Normal", "tightened": "Tightened (sample doubled)", "reduced": "Reduced"}.get(lot.sampling_severity, lot.sampling_severity)
    standard = is_standard_plan(plan)
    if plan is None:
        plan_text = "No inspection plan attached"
    elif standard:
        plan_text = "Standard checklist F/STR/01"
    else:
        plan_text = f"Plan {plan.plan_number} rev {lot.plan_revision or plan.revision}"
    if lot.test_certificate_required:
        cert = "Required — received" + (f" ({lot.test_certificate_reference})" if lot.test_certificate_reference else "") \
            if lot.test_certificate_received else "Required — not received yet"
    else:
        cert = "Not required"
    recorders = [users[i] for i in dict.fromkeys([lot.results_recorded_by_id] + [r.recorded_by_id for r in lot.results]) if i in users]
    return ReportData(
        lot_number=lot.lot_number, status=lot.status, inspection_type_label=QUALITY_INSPECTION_TYPE_LABELS.get(lot.inspection_type, lot.inspection_type),
        grn_number=lot.source_reference or "", vendor=lot.vendor_name or "", item_code=lot.item_code or "", item_name=lot.item_name,
        lot_qty_text=f"{_num(lot.quantity)} {lot.uom or ''}".strip(), lot_date=lot.lot_date, batch=lot.batch_number or "",
        sample_size=lot.sample_size, sampling_text=sampling, plan_text=plan_text, certificate_text=cert, rows=rows,
        decision_text=decision, decided_by=users.get(lot.decided_by_id, ""), decided_at=_plain_date(lot.decided_at),
        inspector=", ".join(recorders) or users.get(lot.assigned_to_id, ""), results_date=_plain_date(lot.results_recorded_at),
        decision_remarks=lot.decision_remarks or "",
        operation_name="INCOMING INSPECTION" if lot.inspection_type in ("incoming", "first_article") else
        QUALITY_INSPECTION_TYPE_LABELS.get(lot.inspection_type, lot.inspection_type).upper(),
        standard_plan=standard,
    )


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

def _fmt_date(d: date | None) -> str:
    return d.strftime("%d.%m.%Y") if d else ""


def _put(ws, row: int, col: int, value, style, *, bold: bool | None = None, align: str | None = None, wrap: bool = True):
    c = ws.cell(row=row, column=col)
    c._style = copy(style)
    put(c, value)  # text typed by people (vendor, remarks, names) that starts with = + - @ stays text, never a formula
    f = copy(c.font)
    if bold is not None:
        c.font = Font(name=f.name, sz=f.sz, b=bold, i=f.i, color=f.color)
    c.alignment = Alignment(horizontal=align or c.alignment.horizontal or "center", vertical="center", wrap_text=wrap)
    return c


def _merge(ws, row1: int, col1: int, row2: int, col2: int, value, style, *, bold: bool | None = None, align: str | None = None):
    for r in range(row1, row2 + 1):
        for c in range(col1, col2 + 1):
            ws.cell(row=r, column=c)._style = copy(style)
            ws.cell(row=r, column=c).border = _BOX
    top = _put(ws, row1, col1, value, style, bold=bold, align=align)
    top.border = _BOX
    if (row1, col1) != (row2, col2):
        ws.merge_cells(start_row=row1, start_column=col1, end_row=row2, end_column=col2)
    return top


def build_xlsx(data: ReportData) -> bytes:
    wb = load_workbook(TEMPLATE_PATH)
    ws = wb.worksheets[0]
    ws.title = "Incoming Inspection Standard"

    # Style snapshots from the template before the lower part is rebuilt.
    st_head = copy(ws["A6"]._style)
    st_body = copy(ws["C8"]._style)
    st_note_label = copy(ws["A13"]._style)
    st_note_text = copy(ws["A14"]._style)
    st_prep = copy(ws["A15"]._style)
    st_appr = copy(ws["D15"]._style)
    st_cust = copy(ws["G15"]._style)
    footer_height = ws.row_dimensions[15].height or 48
    note_text = ws["A14"].value
    note_label = ws["A13"].value
    heading = {c: ws.cell(row=6, column=c).value for c in range(1, 11)}
    foot_texts = (ws["A15"].value, ws["D15"].value, ws["G15"].value)
    # The two signature images sit in the footer row (row 15, 0-based 14).
    footer_images = [im for im in ws._images if im.anchor._from.row == 14]

    for rng in list(ws.merged_cells.ranges):
        if rng.min_row >= _FIRST_BODY_ROW_IN_TEMPLATE:
            ws.unmerge_cells(str(rng))
    ws.delete_rows(_FIRST_BODY_ROW_IN_TEMPLATE, ws.max_row)
    for r in range(_FIRST_BODY_ROW_IN_TEMPLATE, _FIRST_BODY_ROW_IN_TEMPLATE + 40):
        ws.row_dimensions[r].height = None

    # The table is two columns wider than the template (Result, Observed): stretch the title bar over them.
    ws.unmerge_cells("A5:J5")
    for col in (11, 12):
        ws.cell(row=5, column=col)._style = copy(ws["A5"]._style)
    ws.merge_cells("A5:L5")
    ws.column_dimensions["D"].width = 28
    ws.column_dimensions["K"].width = 12
    ws.column_dimensions["L"].width = 42

    st_label = copy(st_body)
    # --- lot information band (rows 6-8) ---
    info = [
        [("Lot No.", data.lot_number, 2), ("GRN / Source No.", data.grn_number, 1), ("Lot Date", _fmt_date(data.lot_date), 1), ("Vendor", data.vendor, 4)],
        [("Item", f"{data.item_code} — {data.item_name}" if data.item_code else data.item_name, 2), ("Lot Qty.", data.lot_qty_text, 1),
         ("Sample Size", str(data.sample_size) if data.sample_size is not None else "", 1), ("Batch / Heat No.", data.batch, 4)],
        [("Sampling", data.sampling_text, 2), ("Test Cert. / MTC", data.certificate_text, 1), ("Inspection", data.inspection_type_label, 1),
         ("Checklist", data.plan_text, 4)],
    ]
    # column anchors per band row: label in A, value B:C | label D, value E | label F, value G | label H, value I:L
    for i, (a, b, c, d) in enumerate(info):
        r = 6 + i
        ws.row_dimensions[r].height = 36
        _merge(ws, r, 1, r, 1, a[0], st_label, bold=True)
        _merge(ws, r, 2, r, 3, a[1], st_label, align="left")
        _merge(ws, r, 4, r, 4, b[0], st_label, bold=True)
        _merge(ws, r, 5, r, 5, b[1], st_label, align="left")
        _merge(ws, r, 6, r, 6, c[0], st_label, bold=True)
        _merge(ws, r, 7, r, 7, c[1], st_label, align="left")
        _merge(ws, r, 8, r, 8, d[0], st_label, bold=True)
        _merge(ws, r, 9, r, _LAST_COL, d[1], st_label, align="left")

    # --- table header (row 9) ---
    hr = 9
    ws.row_dimensions[hr].height = 45
    titles = [heading[1], heading[2], heading[3], heading[4], heading[5], heading[6], "Sample Size", heading[8], heading[9], heading[10],
              "Result", "Observed value / Inspector remarks"]
    for col, t in enumerate(titles, start=1):
        _put(ws, hr, col, (t or "").strip(), st_head)

    # --- parameter rows ---
    first = hr + 1
    n = max(1, len(data.rows))
    last = first + n - 1
    row_h = max(48.0, math.ceil(110 / n))
    for i in range(n):
        ws.row_dimensions[first + i].height = row_h
    for col in (1, 2, 6, 10):
        _merge(ws, first, col, last, col, None, st_body)
    put(ws.cell(row=first, column=1), 1)
    put(ws.cell(row=first, column=2), data.operation_name)
    put(ws.cell(row=first, column=6), data.lot_qty_text)
    put(ws.cell(row=first, column=10), _NOTE_ABNORMAL)
    for i in range(n):
        r = first + i
        row = data.rows[i] if i < len(data.rows) else ReportRow(parameter="")
        _put(ws, r, 3, row.parameter, st_body)
        _put(ws, r, 4, row.specification, st_body)
        _put(ws, r, 5, row.method, st_body)
        _put(ws, r, 7, row.sample_size if row.sample_size is not None else "", st_body)
        _put(ws, r, 8, "Every Lot", st_body)
        _put(ws, r, 9, row.acceptance, st_body)
        _put(ws, r, 11, row.result, st_body, bold=True)
        _put(ws, r, 12, row.observed, st_body, align="left")
        for col in range(1, _LAST_COL + 1):
            ws.cell(row=r, column=col).border = _BOX

    # --- decision + inspector (2 rows) ---
    d1 = last + 1
    for r in (d1, d1 + 1):
        ws.row_dimensions[r].height = 40
    _merge(ws, d1, 1, d1, 2, "Decision", st_label, bold=True)
    _merge(ws, d1, 3, d1, 5, data.decision_text, st_label, align="left")
    _merge(ws, d1, 6, d1, 7, "Decided By", st_label, bold=True)
    _merge(ws, d1, 8, d1, 9, data.decided_by, st_label, align="left")
    _merge(ws, d1, 10, d1, 11, "Decision Date", st_label, bold=True)
    _merge(ws, d1, 12, d1, 12, _fmt_date(data.decided_at), st_label, align="left")
    d2 = d1 + 1
    _merge(ws, d2, 1, d2, 2, "Inspector", st_label, bold=True)
    _merge(ws, d2, 3, d2, 5, data.inspector, st_label, align="left")
    _merge(ws, d2, 6, d2, 7, "Results Recorded On", st_label, bold=True)
    _merge(ws, d2, 8, d2, 9, _fmt_date(data.results_date), st_label, align="left")
    _merge(ws, d2, 10, d2, 11, "Decision Remarks", st_label, bold=True)
    _merge(ws, d2, 12, d2, 12, data.decision_remarks, st_label, align="left")

    # --- note (template rows 13-14) and footer (row 15) ---
    nr = d2 + 1
    ws.row_dimensions[nr].height = 35.4
    ws.row_dimensions[nr + 1].height = 53.4
    _merge(ws, nr, 1, nr, _LAST_COL, note_label, st_note_label)
    _merge(ws, nr + 1, 1, nr + 1, _LAST_COL, note_text, st_note_text, align="left")
    fr = nr + 2
    ws.row_dimensions[fr].height = footer_height
    _merge(ws, fr, 1, fr, 3, foot_texts[0], st_prep, align="left")
    _merge(ws, fr, 4, fr, 6, foot_texts[1], st_appr, align="left")
    _merge(ws, fr, 7, fr, _LAST_COL, foot_texts[2], st_cust, align="left")
    for im in footer_images:  # signature images keep their place in the footer row
        im.anchor._from.row = fr - 1
        im.anchor.to.row = fr - 1

    ws.print_area = f"A1:{get_column_letter(_LAST_COL)}{fr}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def report_filename(lot_number: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", lot_number)
    return f"{safe}_F-STR-01_Inspection_Report.xlsx"
