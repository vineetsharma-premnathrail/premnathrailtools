"""PDF builder for the CRM "Quotation" export.

Uses reportlab's platypus Table/Image so no LaTeX toolchain is needed. The
company letterhead (logo.JPG) is stamped as a full-width header banner and
logo-1.JPG as a full-width footer banner on every page, matching the look
used by the R&D "Braking Calculation" LaTeX reports (backend/app/utils/templates/template.tex).
"""

from __future__ import annotations

import io
import os
import re
from typing import Any, Mapping
from xml.sax.saxutils import escape as _xml_escape

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import inch
    from reportlab.lib.colors import white, black, HexColor
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, KeepTogether
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
APTOS_REGULAR_PATH = os.path.join(TEMPLATES_DIR, "Aptos.ttf")
APTOS_BOLD_PATH = os.path.join(TEMPLATES_DIR, "Aptos-Bold.ttf")

FONT_NAME = "Helvetica"
FONT_NAME_BOLD = "Helvetica-Bold"
try:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    if os.path.exists(APTOS_REGULAR_PATH) and os.path.exists(APTOS_BOLD_PATH):
        pdfmetrics.registerFont(TTFont("Aptos", APTOS_REGULAR_PATH))
        pdfmetrics.registerFont(TTFont("Aptos-Bold", APTOS_BOLD_PATH))
        FONT_NAME = "Aptos"
        FONT_NAME_BOLD = "Aptos-Bold"
except Exception:
    pass
# Aptos ships with Microsoft Office and isn't freely redistributable, so it can't
# be bundled in the repo. Drop Aptos.ttf / Aptos-Bold.ttf into this templates
# folder to switch the quotation PDF over to it; falls back to Helvetica otherwise.

BODY_SIZE = 9
HEADER_SIZE = 10

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 0.55 * inch
USABLE_WIDTH = PAGE_WIDTH - 2 * MARGIN

ACCENT = HexColor("#1c213e")  # navy blue sampled from the company logo
ACCENT_LIGHT = HexColor("#eef0f6")  # pale tint of ACCENT, used for the total highlight band
MUTED = HexColor("#57534e")


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


def _p(text: str, size: float = BODY_SIZE, bold: bool = False, align: str = "left", color=black, escape: bool = True) -> Paragraph:
    # reportlab's Paragraph treats its text as a tiny XML dialect, so any raw "&"/"<"/">"
    # in real data (org names, item descriptions, terms text — "T&C", "T&L-APAC", etc.)
    # trips its parser and corrupts the rendered text (e.g. a stray trailing ";").
    # escape=False is only for the few call sites that deliberately pass literal markup.
    safe_text = _xml_escape(text) if escape and text else text
    return Paragraph(safe_text, ParagraphStyle(
        "s", fontName=FONT_NAME_BOLD if bold else FONT_NAME, fontSize=size, leading=size + 3,
        alignment={"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT}[align], textColor=color,
    ))


def _sentence_case(text: str | None) -> str:
    """True sentence case: capitalize only the first letter of each sentence;
    every other word is left exactly as typed, so proper names, brands,
    abbreviations, and technical terms (GSTIN, Ashok Leyland, RDSO, India, ...)
    are never mangled by a blind lowercase pass. Only a lowercase first letter
    at a sentence boundary gets fixed — nothing already capitalized is touched.

    Sentence boundaries are detected after '.', '!' or '?' (including numbered
    markers like "1."), so multi-sentence terms text is capitalized per
    sentence rather than only at the very start of the whole string.
    """
    if not text:
        return text or ""
    tokens = re.findall(r"\S+|\s+", text)
    out = []
    start_of_sentence = True
    for tok in tokens:
        if tok.isspace():
            out.append(tok)
            continue
        if start_of_sentence and tok[0].isalpha() and tok[0].islower():
            tok = tok[0].upper() + tok[1:]
        out.append(tok)
        start_of_sentence = tok.rstrip("\"')").endswith((".", "!", "?"))
    return "".join(out)


# Matches the start of an inline numbered point like "1. ", "2) " — including mid-sentence,
# since terms text is often typed as one run-on line ("1. xyz 2. abc 3. def") rather than
# with real newlines.
_NUMBERED_POINT_START = re.compile(r"(?:^|\s)(?=\d{1,2}[.)]\s)")


def _split_numbered_points(text: str) -> list[str]:
    """Split a terms/conditions string into its individual numbered points, if any,
    so each renders as its own paragraph instead of one run-on block. Falls back to
    the whole string as a single point when no numbering is detected."""
    if not text:
        return []
    parts = [p.strip() for p in _NUMBERED_POINT_START.split(text) if p and p.strip()]
    return parts if len(parts) > 1 else [text]


def _indian_grouping(int_part: str) -> str:
    if len(int_part) <= 3:
        return int_part
    last3 = int_part[-3:]
    rest = int_part[:-3]
    groups = []
    while len(rest) > 2:
        groups.insert(0, rest[-2:])
        rest = rest[:-2]
    if rest:
        groups.insert(0, rest)
    return ",".join(groups) + "," + last3


def _fmt_amount(value: Any, is_export: bool = False) -> str:
    if value is None:
        return "-"
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return str(value)
    int_part, _, dec_part = f"{amount:,.2f}".replace(",", "").partition(".")
    sign = "-" if int_part.startswith("-") else ""
    int_part = int_part.lstrip("-")
    grouped = int_part if is_export else _indian_grouping(int_part)
    if is_export:
        grouped = f"{int(int_part):,d}"
    return f"{sign}{grouped}.{dec_part}"


def _fmt_quantity(value: Any) -> str:
    if value is None:
        return "-"
    try:
        return f"{int(round(float(value))):,d}"
    except (TypeError, ValueError):
        return str(value)


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
         "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two_digit_words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    return (_TENS[n // 10] + (f" {_ONES[n % 10]}" if n % 10 else "")).strip()


def _three_digit_words(n: int) -> str:
    if n >= 100:
        return f"{_ONES[n // 100]} Hundred" + (f" {_two_digit_words(n % 100)}" if n % 100 else "")
    return _two_digit_words(n)


def _amount_in_words(value: Any, is_export: bool) -> str:
    """Whole-number part spelled out using the Indian (Crore/Lakh) grouping for
    INR quotes, and the international (Million/Thousand) grouping for USD."""
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        amount = 0.0
    rupees = int(round(amount))
    paise = int(round((amount - int(amount)) * 100))
    if rupees == 0:
        words = "Zero"
    elif is_export:
        parts = []
        for divisor, name in ((1_000_000_000, "Billion"), (1_000_000, "Million"), (1_000, "Thousand"), (1, "")):
            chunk, rupees = divmod(rupees, divisor)
            if chunk:
                parts.append(f"{_three_digit_words(chunk)} {name}".strip())
        words = " ".join(parts)
    else:
        parts = []
        for divisor, name in ((10_000_000, "Crore"), (100_000, "Lakh"), (1_000, "Thousand"), (1, "")):
            chunk, rupees = divmod(rupees, divisor)
            if chunk:
                parts.append(f"{_three_digit_words(chunk)} {name}".strip())
        words = " ".join(parts)
    currency_name = "US Dollars" if is_export else "Rupees"
    result = f"{words} {currency_name} Only"
    if paise:
        result = f"{words} {currency_name} and {_two_digit_words(paise)} Cents Only" if is_export else \
            f"{words} {currency_name} and {_two_digit_words(paise)} Paise Only"
    return result


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

    # ── Header band: company name/type on the left, big "QUOTATION" title on the right ──
    story.append(_p("QUOTATION", size=HEADER_SIZE + 12, bold=True, align="right", color=ACCENT))
    story.append(Spacer(1, 2))
    story.append(_p(f"Quotation type: {ctx.get('quotation_type') or 'Domestic'}", size=BODY_SIZE, align="right", color=MUTED))
    story.append(Spacer(1, 14))

    # ── Client (left) + Quotation #/Date/Valid until/Delivery time (right) ──
    # quot.quot_number already has "-r<N>" baked in by the revise workflow (see
    # routes/workflow.py's update_quotation), so appending it again here would
    # double it up as "...-r3-r3".
    quote_number_display = ctx.get("quot_number") or "-"

    bill_to_lines = [_p("CLIENT", size=BODY_SIZE - 1, bold=True, color=ACCENT), Spacer(1, 3),
                      _p(ctx.get("client_name") or "-", size=HEADER_SIZE + 1, bold=True)]
    if ctx.get("client_address"):
        bill_to_lines.append(_p(_sentence_case(ctx["client_address"])))
    if ctx.get("client_gst_number"):
        bill_to_lines.append(_p(f"GSTIN: {ctx['client_gst_number']}"))
    if ctx.get("client_contact_name"):
        bill_to_lines.append(_p(_sentence_case(ctx["client_contact_name"])))
    if ctx.get("client_contact_email"):
        bill_to_lines.append(_p(ctx["client_contact_email"]))
    if ctx.get("client_contact_phone"):
        bill_to_lines.append(_p(ctx["client_contact_phone"]))
    bill_to = Table([[line] for line in bill_to_lines], colWidths=[USABLE_WIDTH * 0.55])
    bill_to.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))

    meta_pairs = [("Quotation #", quote_number_display), ("Quotation date", ctx.get("quote_date") or "-")]
    if ctx.get("technical_offer_number"):
        meta_pairs.append(("Technical offer #", ctx["technical_offer_number"]))
    if ctx.get("technical_offer_date"):
        meta_pairs.append(("Technical offer date", ctx["technical_offer_date"]))
    if ctx.get("valid_until"):
        meta_pairs.append(("Valid Until", ctx["valid_until"]))
    if ctx.get("delivery_time"):
        meta_pairs.append(("Delivery Time", _sentence_case(ctx["delivery_time"])))
    meta_rows = [[_p(label, bold=True, align="right", color=ACCENT), _p(value, align="right")] for label, value in meta_pairs]
    meta_table = Table(meta_rows, colWidths=[1.3 * inch, (USABLE_WIDTH * 0.45) - 1.3 * inch])
    meta_table.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))

    top_block = Table([[bill_to, meta_table]], colWidths=[USABLE_WIDTH * 0.55, USABLE_WIDTH * 0.45])
    top_block.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(top_block)
    story.append(Spacer(1, 16))

    headers = ["#", "Description", "Model no.", "Qty", f"Unit price ({currency})", f"Taxable value ({currency})"]
    if not is_export:
        headers.append("GST %")
    headers.append(f"Total ({currency})")

    # Wide enough for amounts like "10,00,00,000.00" to sit on one line instead of wrapping.
    # Description gets the most room — long product/model descriptions (e.g. a full truck
    # spec) wrap far more readably with a wider column than Model No., which is usually a
    # short code.
    col_widths = [0.3, 2.5, 0.7, 0.5, 1.3, 1.3]
    if not is_export:
        col_widths.append(0.5)
    col_widths.append(1.4)
    scale = USABLE_WIDTH / (sum(col_widths) * inch)
    col_widths = [w * inch * scale for w in col_widths]

    table_data = [[_p(h, size=BODY_SIZE, bold=True, align="center", color=white) for h in headers]]
    items = ctx.get("items") or []
    taxable_total = 0.0
    gst_total = 0.0
    for i, item in enumerate(items):
        # Keep the raw (possibly-None) subtotal for display so an item with no
        # quantity/price shows "-" consistently across Qty/Unit price/Taxable value/Total,
        # instead of "-" everywhere except a misleading "0.00" for Taxable value. The
        # running totals below still need a real number, so they fall back to 0 on their own.
        raw_subtotal = item.get("subtotal")
        subtotal = float(raw_subtotal) if raw_subtotal is not None else 0.0
        gst_pct = float(item.get("gst_percent") or 0)
        gst_amt = subtotal * gst_pct / 100
        taxable_total += subtotal
        gst_total += gst_amt
        row = [
            _p(str(i + 1), align="center"),
            _p(_sentence_case(item.get("description")) or "-"),
            _p(item.get("model_number") or "-", align="center"),
            _p(_fmt_quantity(item.get("quantity")), align="center"),
            _p(_fmt_amount(item.get("unit_price"), is_export), align="right"),
            _p(_fmt_amount(raw_subtotal, is_export), align="right"),
        ]
        if not is_export:
            row.append(_p(_fmt_amount(item.get("gst_percent"), is_export), align="center"))
        row.append(_p(_fmt_amount(item.get("total"), is_export), align="right"))
        table_data.append(row)

    items_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("GRID", (0, 0), (-1, -1), 0.75, black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 8))

    grand_total = sum(float(item.get("total") or 0) for item in items)
    summary_rows = [[_p("Taxable value", bold=True, align="right"), _p(_fmt_amount(taxable_total, is_export), align="right")]]
    if not is_export:
        gst_type = ctx.get("gst_type") or "CGST_SGST"
        if gst_type == "IGST":
            summary_rows.append([_p("IGST", bold=True, align="right"), _p(_fmt_amount(gst_total, is_export), align="right")])
        else:
            half = gst_total / 2
            summary_rows.append([_p("CGST", bold=True, align="right"), _p(_fmt_amount(half, is_export), align="right")])
            summary_rows.append([_p("SGST", bold=True, align="right"), _p(_fmt_amount(half, is_export), align="right")])
    if ctx.get("discount"):
        discount = float(ctx["discount"])
        discount_amt = grand_total * discount / 100 if ctx.get("discount_type") == "percent" else discount
        grand_total -= discount_amt
        discount_label = f"Discount ({discount:g}%)" if ctx.get("discount_type") == "percent" else "Discount"
        summary_rows.append([_p(discount_label, bold=True, align="right"), _p(f"-{_fmt_amount(discount_amt, is_export)}", align="right")])
    summary_rows.append([_p("Grand total", bold=True, size=HEADER_SIZE + 1, align="right"), _p(_fmt_amount(grand_total, is_export), bold=True, size=HEADER_SIZE + 1, align="right")])
    last = len(summary_rows) - 1
    summary_table = Table(summary_rows, colWidths=[USABLE_WIDTH - 1.5 * inch, 1.5 * inch])
    summary_table.setStyle(TableStyle([
        ("LINEABOVE", (0, last), (-1, last), 1, ACCENT),
        ("BACKGROUND", (0, last), (-1, last), ACCENT_LIGHT),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, last), (-1, last), 6), ("BOTTOMPADDING", (0, last), (-1, last), 6),
        ("RIGHTPADDING", (0, last), (-1, last), 6),
    ]))
    # KeepTogether so the totals table never splits mid-row across a page break (e.g. only
    # "Taxable value" left behind on the page with the items table, CGST/SGST/Grand total
    # stranded alone at the top of the next) — it moves to the next page as one block instead.
    story.append(KeepTogether([
        summary_table,
        Spacer(1, 14),
        _p(f"<b>Amount in words: {_amount_in_words(grand_total, is_export)}</b>", size=BODY_SIZE, escape=False),
    ]))
    story.append(Spacer(1, 20))

    terms_sections = []
    if ctx.get("payment_terms"):
        terms_sections.append(("Payment Terms", _sentence_case(ctx["payment_terms"])))
    if ctx.get("quote_conditions"):
        terms_sections.append(("Terms & Conditions", _sentence_case(ctx["quote_conditions"])))
    if ctx.get("notes"):
        terms_sections.append(("Notes", _sentence_case(ctx["notes"])))
    if terms_sections:
        terms_block: list[Any] = [_p("TERMS AND CONDITIONS", size=BODY_SIZE + 1, bold=True, color=ACCENT), Spacer(1, 8)]
        for label, text in terms_sections:
            terms_block.append(_p(label, size=BODY_SIZE, bold=True, color=MUTED))
            terms_block.append(Spacer(1, 3))
            for point in _split_numbered_points(text):
                terms_block.append(_p(point, size=BODY_SIZE))
                terms_block.append(Spacer(1, 5))
            terms_block.append(Spacer(1, 6))
        # KeepTogether so the heading is never orphaned from its content; if the
        # terms text is too long for one page it still flows normally onto the next.
        story.append(KeepTogether(terms_block))

    story.append(Spacer(1, 24))
    sign_table = Table(
        [[_p("_" * 34)], [_p("Authorized Signatory", color=MUTED)]],
        colWidths=[2.6 * inch],
    )
    sign_table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "LEFT"), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    wrapper = Table([["", sign_table]], colWidths=[USABLE_WIDTH - 2.6 * inch, 2.6 * inch])
    wrapper.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(wrapper)

    doc.build(story, onFirstPage=_draw_letterhead, onLaterPages=_draw_letterhead)
    buf.seek(0)
    return buf
