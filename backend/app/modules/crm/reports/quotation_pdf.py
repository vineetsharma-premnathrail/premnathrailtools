"""PDF builder for the CRM "Quotation" export.

Uses reportlab's platypus Table/Image so no LaTeX toolchain is needed. The
company letterhead (logo.JPG) is stamped as a full-width header banner and
logo-1.JPG as a full-width footer banner on every page, matching the look
used by the R&D "Braking Calculation" LaTeX reports (backend/app/utils/templates/template.tex).
"""

from __future__ import annotations

import io
import os
from typing import Any, Mapping

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import inch
    from reportlab.lib.colors import white, black, HexColor
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.utils import ImageReader
except ImportError:
    SimpleDocTemplate = None

try:
    from PIL import Image as PILImage, ImageChops
except ImportError:
    PILImage = None

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "utils", "templates")
HEADER_LOGO_PATH = os.path.join(TEMPLATES_DIR, "logo.JPG")
FOOTER_LOGO_PATH = os.path.join(TEMPLATES_DIR, "logo-1.JPG")

FONT_NAME = "Helvetica"
FONT_NAME_BOLD = "Helvetica-Bold"

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 0.55 * inch
USABLE_WIDTH = PAGE_WIDTH - 2 * MARGIN

ACCENT = HexColor("#1f1108")


def _load_content_cropped(path: str) -> ImageReader | None:
    """Load an image trimmed to its actual artwork's bounding box.

    The source letterhead JPEGs carry built-in white padding that isn't
    symmetric (logo-1.JPG's content only spans ~3%-72% of its own width),
    so stretching the raw file to full page width leaves a large blank
    strip on one side. Cropping to content first makes the artwork itself
    span edge-to-edge.
    """
    if PILImage is None or not os.path.exists(path):
        return None
    try:
        img = PILImage.open(path).convert("RGB")
        bg = PILImage.new("RGB", img.size, (255, 255, 255))
        diff = ImageChops.difference(img, bg)
        bbox = diff.getbbox()
        if bbox:
            img = img.crop(bbox)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return ImageReader(buf)
    except Exception:
        return None


def _full_width_height(reader: ImageReader | None, fallback: float) -> float:
    """Height a full-page-width edge-to-edge image would occupy, preserving its aspect ratio."""
    if reader is None:
        return fallback
    try:
        iw, ih = reader.getSize()
        return PAGE_WIDTH * (ih / iw)
    except Exception:
        return fallback


HEADER_LOGO = _load_content_cropped(HEADER_LOGO_PATH)
FOOTER_LOGO = _load_content_cropped(FOOTER_LOGO_PATH)
HEADER_HEIGHT = _full_width_height(HEADER_LOGO, 0.85 * inch)
FOOTER_HEIGHT = _full_width_height(FOOTER_LOGO, 0.55 * inch)


def _draw_letterhead(canvas, doc) -> None:
    canvas.saveState()
    if HEADER_LOGO is not None:
        try:
            canvas.drawImage(
                HEADER_LOGO, 0, PAGE_HEIGHT - HEADER_HEIGHT,
                width=PAGE_WIDTH, height=HEADER_HEIGHT, mask="auto",
            )
        except Exception:
            pass
    if FOOTER_LOGO is not None:
        try:
            canvas.drawImage(
                FOOTER_LOGO, 0, 0,
                width=PAGE_WIDTH, height=FOOTER_HEIGHT, mask="auto",
            )
        except Exception:
            pass
    canvas.restoreState()


def _p(text: str, size: float = 10, bold: bool = False, align: str = "left", color=black) -> Paragraph:
    return Paragraph(text, ParagraphStyle(
        "s", fontName=FONT_NAME_BOLD if bold else FONT_NAME, fontSize=size, leading=size + 3,
        alignment={"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT}[align], textColor=color,
    ))


def _fmt_amount(value: Any) -> str:
    if value is None:
        return "-"
    try:
        return f"{float(value):,.2f}"
    except (TypeError, ValueError):
        return str(value)


def build_quotation_pdf(ctx: Mapping[str, Any]) -> io.BytesIO:
    """Build a quotation PDF from a plain dict context.

    Expected keys: quot_number, revision_number, quotation_type, quote_date,
    org_name, client_name, client_contact_name, client_contact_email,
    client_contact_phone, valid_until, delivery_time, payment_terms, notes,
    currency_symbol, items (list of {description, model_number, quantity,
    unit_price, gst_percent, subtotal, total}).
    """
    if SimpleDocTemplate is None:
        raise Exception("reportlab library is not installed. Please run: pip install reportlab")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=MARGIN + HEADER_HEIGHT + 0.15 * inch,
        bottomMargin=MARGIN + FOOTER_HEIGHT + 0.15 * inch,
        leftMargin=MARGIN, rightMargin=MARGIN,
    )

    story: list[Any] = []
    currency = ctx.get("currency_symbol") or "Rs."
    is_export = (ctx.get("quotation_type") or "Domestic") == "Export"

    title = f"QUOTATION {ctx.get('quot_number') or ''}".strip()
    if ctx.get("revision_number"):
        title += f" (Revision {ctx['revision_number']})"
    banner = Table(
        [[_p(title, size=16, bold=True, align="center", color=white)]],
        colWidths=[USABLE_WIDTH], rowHeights=0.42 * inch,
    )
    banner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(banner)
    story.append(Spacer(1, 10))

    meta_rows = [
        [_p("Quotation Type:", bold=True), _p(ctx.get("quotation_type") or "-"),
         _p("Quote Date:", bold=True), _p(ctx.get("quote_date") or "-")],
        [_p("Valid Until:", bold=True), _p(ctx.get("valid_until") or "-"),
         _p("Delivery Time:", bold=True), _p(ctx.get("delivery_time") or "-")],
    ]
    meta = Table(meta_rows, colWidths=[1.2 * inch, 2.35 * inch, 1.2 * inch, USABLE_WIDTH - 4.75 * inch])
    meta.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(meta)
    story.append(Spacer(1, 8))

    client_rows = [
        [_p(f"CLIENT: {ctx.get('client_name') or '-'}", size=12, bold=True)],
    ]
    if ctx.get("client_address"):
        client_rows.append([_p(f"Address: {ctx['client_address']}")])
    if ctx.get("client_gst_number"):
        client_rows.append([_p(f"GSTIN: {ctx['client_gst_number']}")])
    contact_bits = []
    if ctx.get("client_contact_name"):
        contact_bits.append(ctx["client_contact_name"])
    if ctx.get("client_contact_email"):
        contact_bits.append(ctx["client_contact_email"])
    if ctx.get("client_contact_phone"):
        contact_bits.append(ctx["client_contact_phone"])
    if contact_bits:
        client_rows.append([_p("Contact: " + " · ".join(contact_bits))])
    client_table = Table(client_rows, colWidths=[USABLE_WIDTH])
    client_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.75, black),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(client_table)
    story.append(Spacer(1, 10))

    headers = ["#", "Description", "Model No.", "Qty", f"Unit Price ({currency})", f"Taxable Value ({currency})"]
    if not is_export:
        headers += ["GST %", f"GST Amt ({currency})"]
    headers.append(f"Total ({currency})")

    col_widths = [0.3, 1.95, 0.95, 0.45, 0.95, 0.95]
    if not is_export:
        col_widths += [0.5, 0.85]
    col_widths.append(0.95)
    scale = USABLE_WIDTH / (sum(col_widths) * inch)
    col_widths = [w * inch * scale for w in col_widths]

    table_data = [[_p(h, size=8.5, bold=True, align="center", color=white) for h in headers]]
    items = ctx.get("items") or []
    taxable_total = 0.0
    gst_total = 0.0
    for i, item in enumerate(items):
        subtotal = float(item.get("subtotal") or 0)
        gst_pct = float(item.get("gst_percent") or 0)
        gst_amt = subtotal * gst_pct / 100
        taxable_total += subtotal
        gst_total += gst_amt
        row = [
            _p(str(i + 1), align="center"),
            _p(item.get("description") or "-"),
            _p(item.get("model_number") or "-", align="center"),
            _p(str(item.get("quantity")) if item.get("quantity") is not None else "-", align="center"),
            _p(_fmt_amount(item.get("unit_price")), align="right"),
            _p(_fmt_amount(subtotal), align="right"),
        ]
        if not is_export:
            row += [
                _p(_fmt_amount(item.get("gst_percent")), align="center"),
                _p(_fmt_amount(gst_amt), align="right"),
            ]
        row.append(_p(_fmt_amount(item.get("total")), align="right"))
        table_data.append(row)

    items_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    items_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, black),
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 8))

    grand_total = sum(float(item.get("total") or 0) for item in items)
    summary_rows = [[_p("Taxable Value", bold=True, align="right"), _p(_fmt_amount(taxable_total), align="right")]]
    if not is_export:
        gst_type = ctx.get("gst_type") or "CGST_SGST"
        if gst_type == "IGST":
            summary_rows.append([_p("IGST", bold=True, align="right"), _p(_fmt_amount(gst_total), align="right")])
        else:
            half = gst_total / 2
            summary_rows.append([_p("CGST", bold=True, align="right"), _p(_fmt_amount(half), align="right")])
            summary_rows.append([_p("SGST", bold=True, align="right"), _p(_fmt_amount(half), align="right")])
    summary_rows.append([_p("Grand Total", bold=True, size=11, align="right"), _p(_fmt_amount(grand_total), bold=True, size=11, align="right")])
    summary_table = Table(summary_rows, colWidths=[USABLE_WIDTH - 1.5 * inch, 1.5 * inch])
    summary_table.setStyle(TableStyle([
        ("LINEABOVE", (0, -1), (-1, -1), 1, black),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 14))

    if ctx.get("payment_terms"):
        story.append(_p(f"<b>Payment Terms:</b> {ctx['payment_terms']}", size=10))
        story.append(Spacer(1, 4))
    if ctx.get("notes"):
        story.append(_p(f"<b>Notes:</b> {ctx['notes']}", size=10))
        story.append(Spacer(1, 4))

    story.append(Spacer(1, 30))
    sign_table = Table(
        [[_p("For Premnath Engineering Works", bold=True)], [Spacer(1, 30)], [_p("Authorized Signatory")]],
        colWidths=[2.6 * inch],
    )
    sign_table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "LEFT")]))
    wrapper = Table([["", sign_table]], colWidths=[USABLE_WIDTH - 2.6 * inch, 2.6 * inch])
    wrapper.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(wrapper)

    doc.build(story, onFirstPage=_draw_letterhead, onLaterPages=_draw_letterhead)
    buf.seek(0)
    return buf
