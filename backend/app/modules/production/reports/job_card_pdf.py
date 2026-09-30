"""PDF builder for the Production work-order job card (shop-floor traveler).

One A4 page per work order: header facts, the material pick list with a
"picked by" column, and the routing with blank columns for the operator to
fill in by hand (start/end, good/scrap, sign) as the job moves bay to bay.
Quality-gate steps are marked so nobody skips the inspection. Same
reportlab/platypus approach as app/modules/crm/reports/mom_pdf.py.
"""

from __future__ import annotations

import io
import os
from typing import Any, Mapping
from xml.sax.saxutils import escape

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor, white, black
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Image, Spacer
    from reportlab.lib.styles import ParagraphStyle
except ImportError:
    SimpleDocTemplate = None

LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "utils", "templates", "premnath_logo_mark.png")
FONT = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
GRID = HexColor("#9ca3af")
SHADE = HexColor("#f3f4f6")


def _p(text: Any, size: float = 8.5, bold: bool = False) -> "Paragraph":
    return Paragraph(escape("" if text is None else str(text)), ParagraphStyle(
        "c", fontName=FONT_BOLD if bold else FONT, fontSize=size, leading=size + 2,
    ))


def build_job_card_pdf(ctx: Mapping[str, Any]) -> io.BytesIO:
    """ctx keys: wo_number, status, priority, product, quantity, uom, bom,
    project, planned, supervisor, source_location, target_location, remarks,
    printed_at, printed_by, materials (list of {code, name, uom, required,
    issued}), operations (list of {sequence, name, workstation, planned_hours,
    quality_gate, instructions})."""
    if SimpleDocTemplate is None:
        raise Exception("reportlab library is not installed. Please run: pip install reportlab")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, topMargin=10 * mm, bottomMargin=10 * mm, leftMargin=10 * mm, rightMargin=10 * mm,
        title=f"Job Card {ctx['wo_number']}",
    )
    width = A4[0] - 20 * mm
    story: list[Any] = []

    logo = Image(LOGO_PATH, width=24 * mm, height=9 * mm) if os.path.exists(LOGO_PATH) else _p("")
    title = Table(
        [[logo, _p("WORK ORDER — JOB CARD", 14, True), _p(ctx["wo_number"], 14, True)]],
        colWidths=[30 * mm, width - 80 * mm, 50 * mm],
    )
    title.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (2, 0), (2, 0), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, black),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [title, Spacer(1, 4 * mm)]

    facts = [
        ("Product", ctx["product"]), ("Quantity", f"{ctx['quantity']:g} {ctx.get('uom') or ''}"),
        ("BOM", ctx["bom"]), ("Status / Priority", f"{ctx['status']} / {ctx['priority']}"),
        ("Machine / Project", ctx.get("project") or "Stock build"), ("Planned", ctx.get("planned") or "—"),
        ("Issue From", ctx.get("source_location") or "—"), ("Receive Into", ctx.get("target_location") or "—"),
        ("Supervisor", ctx.get("supervisor") or "—"), ("Printed", f"{ctx['printed_at']} by {ctx['printed_by']}"),
    ]
    rows = [[_p(facts[i][0], 8, True), _p(facts[i][1]), _p(facts[i + 1][0], 8, True), _p(facts[i + 1][1])] for i in range(0, len(facts), 2)]
    info = Table(rows, colWidths=[28 * mm, width / 2 - 28 * mm, 28 * mm, width / 2 - 28 * mm])
    info.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, GRID),
        ("BACKGROUND", (0, 0), (0, -1), SHADE), ("BACKGROUND", (2, 0), (2, -1), SHADE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story += [info, Spacer(1, 5 * mm)]

    def section(label: str) -> Table:
        heading = Paragraph(escape(label), ParagraphStyle("h", fontName=FONT_BOLD, fontSize=9, leading=11, textColor=white))
        t = Table([[heading]], colWidths=[width])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), black)]))
        return t

    story.append(section("MATERIAL PICK LIST"))
    mat_rows = [[_p(h, 8, True) for h in ("#", "Item Code", "Description", "UOM", "Required", "Issued", "Picked By")]]
    for n, m in enumerate(ctx["materials"], 1):
        mat_rows.append([_p(n), _p(m["code"]), _p(m["name"]), _p(m["uom"] or ""), _p(f"{m['required']:g}"), _p(f"{m['issued']:g}"), _p("")])
    if len(mat_rows) == 1:
        mat_rows.append([_p(""), _p("No material lines"), "", "", "", "", ""])
    mats = Table(mat_rows, colWidths=[8 * mm, 30 * mm, width - 128 * mm, 14 * mm, 22 * mm, 22 * mm, 32 * mm], repeatRows=1)
    mats.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, GRID), ("BACKGROUND", (0, 0), (-1, 0), SHADE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ROWHEIGHT", (0, 1), (-1, -1), 7 * mm),
    ]))
    story += [mats, Spacer(1, 5 * mm)]

    story.append(section("ROUTING — fill in as each operation is done"))
    op_rows = [[_p(h, 8, True) for h in ("Seq", "Operation / Instructions", "Workstation", "Plan Hrs", "Start", "End", "Good", "Scrap", "Operator Sign")]]
    gate_rows = []
    for op in ctx["operations"]:
        label = f"<b>{escape(op['name'])}</b>"
        if op.get("quality_gate"):
            label += " &nbsp;<font color='#b91c1c'><b>[QUALITY GATE — inspection required]</b></font>"
        if op.get("instructions"):
            label += f"<br/><font size='7'>{escape(op['instructions'])}</font>"
        op_rows.append([
            _p(op["sequence"]), Paragraph(label, ParagraphStyle("o", fontName=FONT, fontSize=8.5, leading=10.5)),
            _p(op.get("workstation") or "—"), _p(f"{op['planned_hours']:g}"), "", "", "", "", "",
        ])
        if op.get("quality_gate"):
            gate_rows.append(len(op_rows) - 1)
    ops = Table(op_rows, colWidths=[10 * mm, width - 150 * mm, 30 * mm, 14 * mm, 18 * mm, 18 * mm, 14 * mm, 14 * mm, 32 * mm], repeatRows=1)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, GRID), ("BACKGROUND", (0, 0), (-1, 0), SHADE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ROWHEIGHT", (0, 1), (-1, -1), 10 * mm),
    ]
    style += [("BACKGROUND", (0, r), (-1, r), HexColor("#fef2f2")) for r in gate_rows]
    ops.setStyle(TableStyle(style))
    story += [ops, Spacer(1, 5 * mm)]

    if ctx.get("remarks"):
        story += [_p("Remarks", 8, True), _p(ctx["remarks"]), Spacer(1, 4 * mm)]

    signs = Table(
        [[_p("Prepared By", 8, True), _p("Production Supervisor", 8, True), _p("Quality (Final)", 8, True), _p("Store (FG Received)", 8, True)],
         ["", "", "", ""]],
        colWidths=[width / 4] * 4, rowHeights=[6 * mm, 16 * mm],
    )
    signs.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, GRID), ("BACKGROUND", (0, 0), (-1, 0), SHADE)]))
    story.append(signs)

    doc.build(story)
    buf.seek(0)
    return buf
