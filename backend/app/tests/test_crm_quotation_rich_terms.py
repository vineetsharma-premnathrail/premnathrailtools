"""Quotation Terms & Conditions from the rich-text editor (2026-11-18): sanitizing, the printable
blocks, and the PDF / Word quotation printing them instead of the three older fields."""
from __future__ import annotations

import io

import pytest
from docx import Document

from app.modules.crm.reports.quotation_docx import build_quotation_docx
from app.modules.crm.reports.quotation_pdf import build_quotation_pdf
from app.modules.crm.schemas.workflow import QuotationCreate
from app.modules.crm.services.rich_terms import sanitize_terms_html, terms_blocks, terms_plain_text

TERMS = ("<p><b>Price basis:</b> Ex-works Faridabad</p>"
         "<ol><li>30% <strong>advance</strong> with PO</li><li>Balance<ol><li>60% on dispatch</li><li>10% after commissioning</li></ol></li></ol>"
         "<ul><li>GST extra</li></ul><p>Validity: 30 days<br>Delivery: 12 weeks</p>")


def test_sanitizer_keeps_formatting_and_drops_scripts_attributes_and_unknown_tags():
    dirty = ('<p style="color:red" onclick="x()"><b>Bold</b> <script>alert(1)</script>text<img src=x onerror=alert(1)></p>'
             '<a href="javascript:alert(1)">link</a><ul><li class="c">one</li></ul><style>p{}</style>')
    clean = sanitize_terms_html(dirty)
    assert clean == "<p><b>Bold</b> text</p>link<ul><li>one</li></ul>"
    for bad in ("script", "onerror", "onclick", "style", "href", "img", "class"):
        assert bad not in clean
    assert sanitize_terms_html("<p>&lt;script&gt;</p>") == "<p>&lt;script&gt;</p>"  # typed text stays text
    assert sanitize_terms_html("<p> <br></p>") is None and sanitize_terms_html(None) is None


def test_blocks_number_clauses_letter_nested_ones_and_keep_bold_runs():
    blocks = terms_blocks(TERMS)
    assert [(b.kind, b.marker, b.level, b.text) for b in blocks] == [
        ("p", "", 0, "Price basis: Ex-works Faridabad"),
        ("li", "1.", 0, "30% advance with PO"),
        ("li", "2.", 0, "Balance"),
        ("li", "a.", 1, "60% on dispatch"),
        ("li", "b.", 1, "10% after commissioning"),
        ("li", "•", 0, "GST extra"),
        ("p", "", 0, "Validity: 30 days\nDelivery: 12 weeks"),
    ]
    assert ("Price basis:", True, False, False) in blocks[0].runs and ("advance", True, False, False) in blocks[1].runs
    assert terms_plain_text(TERMS).startswith("Price basis: Ex-works Faridabad 30% advance")


def test_the_create_payload_sanitizes_terms_and_refuses_very_long_ones():
    q = QuotationCreate(terms_html='<p onmouseover="x">Net <b>30</b></p><script>bad()</script>')
    assert q.terms_html == "<p>Net <b>30</b></p>"
    with pytest.raises(ValueError, match="keep them within"):
        QuotationCreate(terms_html="<p>" + "x" * 70_000 + "</p>")


def _ctx(**extra):
    return {"quotation_type": "Domestic", "gst_type": "CGST_SGST", "quot_number": "QT-RICH-1", "quote_date": "2026-11-18",
            "client_name": "Demo Railway", "pricing_mode": "itemwise",
            "items": [{"description": "Rail cum road vehicle", "quantity": 1, "unit_price": 100.0, "gst_percent": 18,
                       "subtotal": 100.0, "total": 118.0}], **extra}


def _docx_text(ctx) -> list[str]:
    return [p.text for p in Document(io.BytesIO(build_quotation_docx(ctx).getvalue())).paragraphs]


def test_word_prints_the_rich_terms_instead_of_the_older_fields():
    lines = _docx_text(_ctx(terms_html=TERMS, payment_terms="OLD PAYMENT", quote_conditions="OLD COND", notes="OLD NOTE"))
    joined = "\n".join(lines)
    assert "TERMS AND CONDITIONS" in joined and "Price basis: Ex-works Faridabad" in joined
    assert "1.\t30% advance with PO" in lines and "a.\t60% on dispatch" in lines and "•\tGST extra" in lines
    assert "OLD PAYMENT" not in joined and "OLD COND" not in joined and "OLD NOTE" not in joined


def test_without_rich_terms_the_older_fields_still_print():
    joined = "\n".join(_docx_text(_ctx(payment_terms="1. Net 30 2. GST extra", notes="Mobile-app note")))
    assert "Payment Terms" in joined and "Net 30" in joined and "Mobile-app note" in joined


def test_pdf_builds_with_rich_terms_and_lump_sum():
    assert build_quotation_pdf(_ctx(terms_html=TERMS)).getvalue().startswith(b"%PDF")
    lump = _ctx(terms_html=TERMS, pricing_mode="lumpsum", price=500000, lump_sum_gst_percent=18)
    assert build_quotation_pdf(lump).getvalue().startswith(b"%PDF")
    assert "PRICE TERMS & CONDITIONS" in "\n".join(_docx_text(lump))
