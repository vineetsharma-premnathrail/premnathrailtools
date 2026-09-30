"""PDF builder for the RRV Production Handover Certificate.

One A4 page per handed-over vehicle: vehicle identity, customer & order,
handover facts, the final inspection and required vehicle tests, the stage
sign-off trail, and signature blocks for Premnath and the customer. Same
reportlab/platypus approach as job_card_pdf.py.
"""

from __future__ import annotations

import io
import os
from typing import Any, Mapping
from xml.sax.saxutils import escape

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor, black
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
    return Paragraph(escape("—" if text in (None, "") else str(text)), ParagraphStyle(
        "c", fontName=FONT_BOLD if bold else FONT, fontSize=size, leading=size + 2,
    ))


def _grid(rows: list[list[Any]], widths: list[float], header: bool = False) -> "Table":
    table = Table(rows, colWidths=widths)
    style = [("GRID", (0, 0), (-1, -1), 0.4, GRID), ("VALIGN", (0, 0), (-1, -1), "TOP")]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), SHADE))
    table.setStyle(TableStyle(style))
    return table


def build_rrv_handover_pdf(ctx: Mapping[str, Any]) -> io.BytesIO:
    """ctx keys: build_number, rrv_model, customer, po, serial, chassis,
    engine, year, handover_date, commissioning_date, location, handed_to,
    handed_to_org, acceptance_ref, warranty, final_inspection, tests (list of
    (label, result)), stages (list of (label, status, by, date)),
    handed_over_by, remarks, printed_at, printed_by."""
    if SimpleDocTemplate is None:
        raise Exception("reportlab library is not installed. Please run: pip install reportlab")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, topMargin=10 * mm, bottomMargin=10 * mm, leftMargin=12 * mm, rightMargin=12 * mm,
        title=f"RRV Handover Certificate {ctx['build_number']}",
    )
    width = A4[0] - 24 * mm
    story: list[Any] = []

    logo = Image(LOGO_PATH, width=24 * mm, height=9 * mm) if os.path.exists(LOGO_PATH) else _p("")
    title = Table(
        [[logo, _p("PRODUCTION HANDOVER CERTIFICATE", 14, True), _p(ctx["build_number"], 12, True)]],
        colWidths=[30 * mm, width - 75 * mm, 45 * mm],
    )
    title.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (2, 0), (2, 0), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, black), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [title, Spacer(1, 3 * mm), _p(
        f"This certifies that the Rail-cum-Road Vehicle described below has been manufactured, inspected and tested, "
        f"and was handed over to {ctx.get('handed_to') or 'the customer'}"
        f"{' of ' + ctx['handed_to_org'] if ctx.get('handed_to_org') else ''} on {ctx['handover_date']}.", 9.5,
    ), Spacer(1, 4 * mm)]

    facts = [
        ("RRV model", ctx["rrv_model"]), ("Customer", ctx.get("customer")),
        ("Vehicle serial", ctx.get("serial")), ("Customer PO", ctx.get("po")),
        ("Chassis no.", ctx.get("chassis")), ("Engine no.", ctx.get("engine")),
        ("Year of manufacture", ctx.get("year")), ("Warranty", ctx.get("warranty")),
        ("Handover date", ctx["handover_date"]), ("Commissioning date", ctx.get("commissioning_date")),
        ("Handover location", ctx.get("location")), ("Customer acceptance ref.", ctx.get("acceptance_ref")),
        ("Final inspection", ctx.get("final_inspection")), ("Handed over by", ctx.get("handed_over_by")),
    ]
    rows = [[_p(facts[i][0], 8, True), _p(facts[i][1]), _p(facts[i + 1][0], 8, True), _p(facts[i + 1][1])] for i in range(0, len(facts), 2)]
    info = _grid(rows, [32 * mm, width / 2 - 32 * mm, 32 * mm, width / 2 - 32 * mm])
    info.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), SHADE), ("BACKGROUND", (2, 0), (2, -1), SHADE)]))
    story += [info, Spacer(1, 5 * mm)]

    story.append(_p("Vehicle tests", 10, True))
    tests = [[_p("Test", 8, True), _p("Result", 8, True)]] + [[_p(label), _p((res or "pending").upper(), 8.5, True)] for label, res in ctx.get("tests") or []]
    story += [Spacer(1, 1.5 * mm), _grid(tests, [width - 35 * mm, 35 * mm], header=True), Spacer(1, 5 * mm)]

    story.append(_p("Production stage sign-off", 10, True))
    stages = [[_p("Stage", 8, True), _p("Status", 8, True), _p("Signed off by", 8, True), _p("Date", 8, True)]] + [
        [_p(label), _p(status), _p(by), _p(when)] for label, status, by, when in ctx.get("stages") or []
    ]
    story += [Spacer(1, 1.5 * mm), _grid(stages, [width - 105 * mm, 30 * mm, 50 * mm, 25 * mm], header=True), Spacer(1, 4 * mm)]

    if ctx.get("remarks"):
        story += [_p("Remarks", 9, True), _p(ctx["remarks"]), Spacer(1, 4 * mm)]

    sign = Table([
        [_p("For Premnath Rail", 9, True), _p("Received by (customer)", 9, True)],
        [_p("\n\n\nSignature & stamp"), _p("\n\n\nSignature & stamp")],
        [_p(f"Name: {ctx.get('handed_over_by') or ''}"), _p(f"Name: {ctx.get('handed_to') or ''}")],
    ], colWidths=[width / 2, width / 2], rowHeights=[None, 22 * mm, None])
    sign.setStyle(TableStyle([("BOX", (0, 0), (0, -1), 0.6, GRID), ("BOX", (1, 0), (1, -1), 0.6, GRID), ("VALIGN", (0, 0), (-1, -1), "BOTTOM")]))
    story += [sign, Spacer(1, 3 * mm), _p(f"Generated {ctx['printed_at']} by {ctx['printed_by']} from the Premnath Rail portal.", 7)]

    doc.build(story)
    buf.seek(0)
    return buf
