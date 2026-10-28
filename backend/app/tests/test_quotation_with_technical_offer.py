"""The quotation sent to the customer = R&D's Technical Offer on top + the
commercial quotation below, one Word file editable in Word; Download PDF
without a Word document joins the two PDFs (owner, 2026-10-27)."""
import io

from docx import Document

from app.tests.quote_lines import quote_product  # noqa: F401 — autouse fixture
from app.tests.test_cov_crm_quotations_rnd import ITEM, auth, make_user
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_technical_offers import CRM, RND, _sent_inquiry, _word
from app.utils.document_merge import merge_docx


def _text(data: bytes) -> str:
    return "\n".join(p.text for p in Document(io.BytesIO(data)).paragraphs)


def _doc(*lines: str) -> bytes:
    d = Document()
    for line in lines:
        d.add_paragraph(line)
    out = io.BytesIO()
    d.save(out)
    return out.getvalue()


def test_merge_docx_keeps_order_and_both_parts():
    text = _text(merge_docx(_doc("TECHNICAL PART"), _doc("COMMERCIAL PART")))
    assert text.index("TECHNICAL PART") < text.index("COMMERCIAL PART")


def test_quotation_word_starts_with_the_technical_offer(client, db, sp):
    bd = make_user(db, "qto.bd@premnathrail.com")
    head = make_user(db, "qto.head@premnathrail.com", role="admin", apps=("crm", "rnd"))
    inq = _sent_inquiry(db, bd)
    offer = client.post(f"{RND}/inquiry/{inq.id}/technical-offers", json={"title": "Rail Grinding Machine"}, headers=auth(head)).json()
    _word(client, offer["id"], head)
    # R&D edits its offer in Word — the quotation must carry that edited text.
    item = next(i for i, v in sp.files.items() if v)
    sp.files[item].append(_doc("R&D EDITED TECHNICAL OFFER", "Gauge 1676 mm"))
    assert client.post(f"{RND}/technical-offers/{offer['id']}/release", headers=auth(head)).status_code == 200

    with_offer = client.post(f"{CRM}/inquiries/{inq.id}/quotations", json={"items": [ITEM], "technical_offer_id": offer["id"]}, headers=auth(bd)).json()
    r = client.post(f"/api/v1/managed-documents/crm_quotation/{with_offer['id']}", headers=auth(bd))
    assert r.status_code == 200, r.text
    quote_item = max(sp.files)  # the quotation's Word file is the newest upload
    text = _text(sp.files[quote_item][-1])
    assert "R&D EDITED TECHNICAL OFFER" in text and "Gauge 1676 mm" in text
    assert text.index("R&D EDITED TECHNICAL OFFER") < text.index("Amount in words")


def test_quotation_without_technical_offer_is_commercial_only(client, db, sp):
    bd = make_user(db, "qto2.bd@premnathrail.com")
    inq = _sent_inquiry(db, bd)
    quot = client.post(f"{CRM}/inquiries/{inq.id}/quotations", json={"items": [ITEM]}, headers=auth(bd)).json()
    r = client.post(f"/api/v1/managed-documents/crm_quotation/{quot['id']}", headers=auth(bd))
    assert r.status_code == 200, r.text
    text = _text(sp.files[max(sp.files)][-1])
    assert text.startswith("QUOTATION") and "Amount in words" in text


def test_merge_pdf_puts_technical_offer_pages_first():
    from pypdf import PdfReader
    from reportlab.pdfgen import canvas

    from app.utils.document_merge import merge_pdf

    def pdf(*pages: str) -> bytes:
        out = io.BytesIO()
        c = canvas.Canvas(out)
        for text in pages:
            c.drawString(72, 720, text)
            c.showPage()
        c.save()
        return out.getvalue()

    merged = PdfReader(io.BytesIO(merge_pdf(pdf("TECH 1", "TECH 2"), pdf("COMMERCIAL"))))
    assert [p.extract_text().strip() for p in merged.pages] == ["TECH 1", "TECH 2", "COMMERCIAL"]
