"""PDF builder for the CRM "Technical Offer Request" — replaces the earlier
.docx version. A PDF isn't natively editable (unlike a .docx, which anyone
opening it in Word can freely rewrite), and reuses quotation_pdf.py's
proven canvas-drawn letterhead instead of python-docx's floating-picture
anchors, which were bleeding into the body text at page breaks.

Numbered-section layout: Customer/Organization, Contact Person, Technical
Requirement Summary, Technical Specification, Requirement Summary, Project
Background, Technical Compliance Statement, Document Control — auto-numbered
so removing an empty section never leaves a gap.
"""

from __future__ import annotations

import io
from typing import Any, Mapping

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer

from app.modules.crm.reports.quotation_pdf import (
    _draw_letterhead, _p, FONT_NAME, FONT_NAME_BOLD, BODY_SIZE, HEADER_SIZE,
    PAGE_WIDTH, MARGIN, USABLE_WIDTH, ACCENT, MUTED, HEADER_HEIGHT, FOOTER_HEIGHT,
)


def _section_heading(number: int, text: str) -> Table:
    t = Table(
        [[_p(f"{number}. {text}", size=HEADER_SIZE + 1.5, bold=True, color=ACCENT)]],
        colWidths=[USABLE_WIDTH],
    )
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, 0), 1, ACCENT),
        ("TOPPADDING", (0, 0), (-1, 0), 2), ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
        ("LEFTPADDING", (0, 0), (-1, 0), 0), ("RIGHTPADDING", (0, 0), (-1, 0), 0),
    ]))
    return t


def _field_table(rows: list[tuple[str, str]]) -> Table:
    data = [[_p("Field", bold=True, color=ACCENT), _p("Value", bold=True, color=ACCENT)]]
    data += [[_p(label), _p(value)] for label, value in rows]
    t = Table(data, colWidths=[1.8 * inch, USABLE_WIDTH - 1.8 * inch])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#d6d3d1")),
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#eef0f6")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def build_technical_offer_pdf(ctx: Mapping[str, Any]) -> io.BytesIO:
    """Build the Technical Offer PDF from a plain dict context.

    Expected keys: offer_number, universal_id, org_name, org_type, org_address, org_gst_number,
    org_city, org_state, contact_name, contact_designation, contact_department, contact_mobile,
    contact_email, product_category, product, quantity_display, product_spec, requirement_desc,
    detailed_requirement, project_details, raised_by, raised_at. All optional except
    offer_number/universal_id — every section prints a placeholder rather than a fabricated
    value when its underlying field is empty on the record.
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=MARGIN + HEADER_HEIGHT + 0.15 * inch,
        bottomMargin=MARGIN + FOOTER_HEIGHT + 0.15 * inch,
        leftMargin=MARGIN, rightMargin=MARGIN,
    )
    story: list[Any] = []
    n = 0  # running section number, so a skipped/empty section never leaves a numbering gap

    story.append(_p("TECHNICAL OFFER", size=HEADER_SIZE + 8, bold=True, align="center", color=ACCENT))
    story.append(Spacer(1, 3))
    story.append(_p(ctx.get("product") or ctx.get("product_category") or ctx.get("universal_id") or "-", size=HEADER_SIZE + 3, bold=True, align="center"))
    story.append(Spacer(1, 2))
    story.append(_p(f"For {ctx.get('org_name') or '-'}", size=HEADER_SIZE + 1, align="center", color=MUTED))
    story.append(Spacer(1, 4))
    story.append(_p(f"Offer No. {ctx.get('offer_number', '-')}  ·  Ref. {ctx.get('universal_id', '-')}", size=BODY_SIZE, align="center", color=MUTED))
    story.append(Spacer(1, 16))

    # Customer / Organization Details
    n += 1
    story.append(_section_heading(n, "Customer / Organization Details"))
    story.append(Spacer(1, 6))
    org_rows = [("Organization", ctx.get("org_name") or "-")]
    if ctx.get("org_gst_number"):
        org_rows.append(("GST Number", ctx["org_gst_number"]))
    org_rows.append(("Organization Type", ctx.get("org_type") or "-"))
    city_state = ", ".join(v for v in (ctx.get("org_city"), ctx.get("org_state")) if v)
    if city_state:
        org_rows.append(("City / State", city_state))
    if ctx.get("org_address"):
        org_rows.append(("Address", ctx["org_address"]))
    story.append(_field_table(org_rows))
    story.append(Spacer(1, 14))

    # Contact Person
    if any(ctx.get(k) for k in ("contact_name", "contact_designation", "contact_department", "contact_mobile", "contact_email")):
        n += 1
        story.append(_section_heading(n, "Contact Person"))
        story.append(Spacer(1, 6))
        contact_rows = [
            (label, ctx[key]) for label, key in (
                ("Name", "contact_name"), ("Designation", "contact_designation"),
                ("Department", "contact_department"), ("Mobile", "contact_mobile"), ("Email", "contact_email"),
            ) if ctx.get(key)
        ]
        story.append(_field_table(contact_rows))
        story.append(Spacer(1, 14))

    # Technical Requirement Summary — Category / Product / Quantity / Inspection only
    n += 1
    story.append(_section_heading(n, "Technical Requirement Summary"))
    story.append(Spacer(1, 6))
    req_rows = [
        (label, str(ctx[key])) for label, key in (
            ("Category", "product_category"), ("Product", "product"),
            ("Quantity", "quantity_display"), ("Inspection", "inspection_req"),
        ) if ctx.get(key)
    ]
    if req_rows:
        story.append(_field_table(req_rows))
    else:
        story.append(_p("No structured requirement fields have been filled in for this record yet.", color=MUTED))
    story.append(Spacer(1, 14))

    # Technical Specification
    n += 1
    story.append(_section_heading(n, "Technical Specification"))
    story.append(Spacer(1, 6))
    story.append(_p(ctx.get("product_spec") or "Not specified."))
    story.append(Spacer(1, 14))

    # Requirement Summary
    n += 1
    story.append(_section_heading(n, "Requirement Summary"))
    story.append(Spacer(1, 6))
    story.append(_p(ctx.get("requirement_desc") or ctx.get("detailed_requirement") or "Not provided."))
    story.append(Spacer(1, 14))

    # Project Background
    n += 1
    story.append(_section_heading(n, "Project Background"))
    story.append(Spacer(1, 6))
    story.append(_p(ctx.get("project_details") or ctx.get("detailed_requirement") or "Not provided."))
    story.append(Spacer(1, 14))

    # Technical Compliance Statement
    n += 1
    story.append(_section_heading(n, "Technical Compliance Statement"))
    story.append(Spacer(1, 6))
    story.append(_p(
        "The proposed technical offer shall be evaluated against the above customer requirements. "
        "All deviations, if any, shall be explicitly identified in the final technical compliance statement."
    ))
    story.append(Spacer(1, 14))

    # Document Control
    n += 1
    story.append(_section_heading(n, "Document Control"))
    story.append(Spacer(1, 6))
    story.append(_field_table([
        ("Document Title", f"Technical Offer – {ctx.get('product') or ctx.get('product_category') or ctx.get('universal_id') or '-'}"),
        ("Customer", ctx.get("org_name") or "-"),
        ("Revision", "00"),
        ("Issue Date", ctx.get("raised_at", "-").split(",")[0] if ctx.get("raised_at") else "-"),
        ("Status", "Technical Offer Request"),
    ]))
    story.append(Spacer(1, 16))

    story.append(_p(f"Please quote Technical Offer No. {ctx.get('offer_number', '-')} in your technical offer for tracking.", bold=True))
    story.append(Spacer(1, 20))
    story.append(_p("End of Technical Offer", size=BODY_SIZE - 1, align="center", color=MUTED))
    story.append(Spacer(1, 6))
    story.append(_p(f"Raised by {ctx.get('raised_by', '-')} on {ctx.get('raised_at', '-')}.", size=BODY_SIZE - 1, color=MUTED))

    doc.build(story, onFirstPage=_draw_letterhead, onLaterPages=_draw_letterhead)
    buf.seek(0)
    return buf
