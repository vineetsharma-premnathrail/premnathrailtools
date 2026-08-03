"""PDF builder for the CRM "Minutes of Meeting" export.

Mirrors the layout of mom_docx.py (letterhead, black title banner, client/
subject/date rows, attendee lists, activity table) using reportlab's
platypus Table instead of a python-docx table, so no DOCX-to-PDF conversion
step is needed.
"""

from __future__ import annotations

import io
import os
from typing import Any, Mapping, Sequence

try:
    from reportlab.lib.pagesizes import landscape
    from reportlab.lib.units import inch
    from reportlab.lib.colors import white, black
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Image
    from reportlab.lib.styles import ParagraphStyle
except ImportError:
    SimpleDocTemplate = None

LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "utils", "templates", "premnath_logo_mark.png")
FONT_NAME = "Helvetica"
FONT_NAME_BOLD = "Helvetica-Bold"

# Column widths in inches — proportioned from mom_docx.py's COL_WIDTHS_TWIPS
# (688, 6617, 2801, 2201, 1282 twips out of 13589 total) against a 9.7"
# usable width (11" page minus 0.5"+0.75" margins).
COL_WIDTHS_IN = [0.49, 4.72, 2.00, 1.57, 0.92]


def _attendee_lines(members: Sequence[Mapping[str, Any]]) -> list[str]:
    if not members:
        return ["-"]
    lines = []
    for member in members:
        label = member.get("name") or "-"
        if member.get("designation"):
            label = f"{label} ({member['designation']})"
        lines.append(label)
    return lines


def build_mom_pdf(ctx: Mapping[str, Any]) -> io.BytesIO:
    """Build the MOM .pdf from the same plain-dict context used by build_mom_docx.

    Expected keys: org_name, subject, meeting_date (already formatted str),
    pew_members / client_members (list of {name, designation}), and
    activities (list of {observation, action_plan, responsibility, target}).
    """
    if SimpleDocTemplate is None:
        raise Exception("reportlab library is not installed. Please run: pip install reportlab")

    buf = io.BytesIO()
    page_size = landscape((8.5 * inch, 11 * inch))
    doc = SimpleDocTemplate(
        buf, pagesize=page_size,
        topMargin=0.2 * inch, bottomMargin=0.2 * inch,
        leftMargin=0.5 * inch, rightMargin=0.75 * inch,
    )

    body = ParagraphStyle("body", fontName=FONT_NAME, fontSize=10, leading=12)

    def bold(text: str, size: float = 11) -> Paragraph:
        return Paragraph(text, ParagraphStyle("b", fontName=FONT_NAME_BOLD, fontSize=size, leading=size + 2))

    def plain(text: str, size: float = 10) -> Paragraph:
        return Paragraph(text, ParagraphStyle("p", fontName=FONT_NAME, fontSize=size, leading=size + 2))

    def center(text: str, size: float = 10, b: bool = False) -> Paragraph:
        return Paragraph(text, ParagraphStyle(
            "c", fontName=FONT_NAME_BOLD if b else FONT_NAME, fontSize=size, leading=size + 2, alignment=TA_CENTER,
        ))

    story: list[Any] = []

    # Letterhead: logo + company name, format-no block.
    if os.path.exists(LOGO_PATH):
        try:
            logo_cell = Image(LOGO_PATH, width=1.1 * inch, height=0.42 * inch)
        except Exception:
            logo_cell = ""
    else:
        logo_cell = ""

    letterhead_data = [
        [logo_cell, center("Premnath Engineering Works", size=14, b=True), "", bold("Format No :"), bold("F/HRD/4")],
        ["", "", "", bold("Effective Date :"), bold("01.02.2025")],
        ["", "", "", bold("Rev. No :"), bold("00")],
        ["", "", "", bold("Rev Date :"), bold("00")],
    ]
    letterhead = Table(letterhead_data, colWidths=[w * inch for w in COL_WIDTHS_IN], rowHeights=0.3 * inch)
    letterhead.setStyle(TableStyle([
        ("SPAN", (0, 0), (0, 3)),
        ("SPAN", (1, 0), (2, 3)),
        ("VALIGN", (0, 0), (2, 3), "MIDDLE"),
        ("ALIGN", (0, 0), (0, 3), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 1, black),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(letterhead)

    # Black "MINUTES OF MEETING" banner.
    banner = Table(
        [[Paragraph("MINUTES OF MEETING", ParagraphStyle(
            "banner", fontName=FONT_NAME_BOLD, fontSize=18, leading=22, alignment=TA_CENTER, textColor=white,
        ))]],
        colWidths=[sum(COL_WIDTHS_IN) * inch], rowHeights=0.4 * inch,
    )
    banner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 1, black),
    ]))
    story.append(banner)

    # Client name.
    client_row = Table(
        [[bold(f"CLIENT: {ctx.get('org_name') or '-'}", size=14)]],
        colWidths=[sum(COL_WIDTHS_IN) * inch], rowHeights=0.32 * inch,
    )
    client_row.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 1, black), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(client_row)

    # Subject / date.
    subject_date = Table(
        [[bold(f"SUBJECT : {ctx.get('subject') or '-'}", size=13), bold(f"DATE: {ctx.get('meeting_date') or '-'}", size=12)]],
        colWidths=[(COL_WIDTHS_IN[0] + COL_WIDTHS_IN[1]) * inch, (COL_WIDTHS_IN[2] + COL_WIDTHS_IN[3] + COL_WIDTHS_IN[4]) * inch],
        rowHeights=0.32 * inch,
    )
    subject_date.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 1, black), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(subject_date)

    # PEW / client members present.
    pew_lines = "<br/>".join(_attendee_lines(ctx.get("pew_members") or []))
    client_lines = "<br/>".join(_attendee_lines(ctx.get("client_members") or []))
    members = Table(
        [[
            Paragraph(f"<b>PEW MEMBER PRESENT:-</b><br/>{pew_lines}", body),
            Paragraph(f"<b>CLIENT MEMBERS PRESENT -</b><br/>{client_lines}", body),
        ]],
        colWidths=[(COL_WIDTHS_IN[0] + COL_WIDTHS_IN[1]) * inch, (COL_WIDTHS_IN[2] + COL_WIDTHS_IN[3] + COL_WIDTHS_IN[4]) * inch],
    )
    members.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 1, black), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(members)

    # Activity table (header + rows).
    headers = ["S NO", "OBSERVATION", "ACTION PLAN", "RESPONSIBILITY", "TARGET\nDATE"]
    table_data = [[center(h.replace("\n", "<br/>"), size=12, b=True) for h in headers]]
    activities = ctx.get("activities") or []
    for i, activity in enumerate(activities):
        table_data.append([
            center(str(i + 1)),
            plain(activity.get("observation") or "-"),
            plain(activity.get("action_plan") or "-"),
            center(activity.get("responsibility") or "-"),
            center(activity.get("target") or "-"),
        ])

    activity_table = Table(table_data, colWidths=[w * inch for w in COL_WIDTHS_IN], repeatRows=1)
    activity_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 1, black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(activity_table)

    doc.build(story)
    buf.seek(0)
    return buf
