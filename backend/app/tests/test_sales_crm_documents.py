"""Sales orders link CRM documents of their source inquiry (owner, 2026-10-27):
picked at creation, link only (no copy), opened through the order."""
from app.core.config import settings
from app.modules.crm.models.document import CrmDocument
from app.modules.sales.models.crm_document_link import SalesOrderCrmDocument
from app.tests.test_sales import BASE, create_order, hdr, make_user, setup_customer, setup_people

ATT = f"{BASE}/attachments"


def _doc(db, related_module, related_id, name, folder="client"):
    d = CrmDocument(related_module=related_module, related_id=related_id, folder_type=folder, file_name=name,
                    file_path=f"crm/{name}", sharepoint_path=f"crm/{name}", mime_type="application/pdf")
    db.add(d)
    db.commit()
    return d


def test_pick_crm_documents_on_create_and_open_through_order(client, db, monkeypatch):
    maker, _, _, _ = setup_people(db)
    _, inq, _ = setup_customer(db)
    spec = _doc(db, "inquiry", inq.id, "customer-spec.pdf")
    tor = _doc(db, "inquiry", inq.id, "TOR.docx", folder="technical_offer")
    skipped = _doc(db, "inquiry", inq.id, "old-drawing.pdf", folder="internal")
    other = _doc(db, "inquiry", inq.id + 999, "someone-else.pdf")

    r = client.get(f"{ATT}/crm-candidates", params={"inquiry_id": inq.id}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    assert {d["id"] for d in r.json()} == {spec.id, tor.id, skipped.id}

    so = create_order(client, db, maker, inq, crm_document_ids=[spec.id, tor.id])
    links = client.get(f"{ATT}/crm-links", params={"sales_order_id": so["id"]}, headers=hdr(maker))
    assert links.status_code == 200, links.text
    assert {d["id"] for d in links.json()} == {spec.id, tor.id}
    assert db.query(CrmDocument).count() == 4  # nothing copied

    # A document of another record can't be linked.
    r = client.put(f"{ATT}/crm-links", params={"sales_order_id": so["id"]}, json={"crm_document_ids": [other.id]}, headers=hdr(maker))
    assert r.status_code == 422 and "don't belong" in r.json()["detail"]

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site")

    async def fake_download(site, path):
        return b"bytes-of-" + path.encode(), "application/pdf"
    monkeypatch.setattr("app.modules.sales.routes.documents.download_file_content", fake_download)
    r = client.get(f"{ATT}/crm-links/{spec.id}/content", params={"sales_order_id": so["id"]}, headers=hdr(maker))
    assert r.status_code == 200 and r.content == b"bytes-of-crm/customer-spec.pdf"
    # Not linked → not opened through the order.
    r = client.get(f"{ATT}/crm-links/{skipped.id}/content", params={"sales_order_id": so["id"]}, headers=hdr(maker))
    assert r.status_code == 404

    # Change the selection later: drop the TOR, add the drawing.
    r = client.put(f"{ATT}/crm-links", params={"sales_order_id": so["id"]}, json={"crm_document_ids": [spec.id, skipped.id]},
                   headers=hdr(maker))
    assert r.status_code == 200, r.text
    assert {d["id"] for d in r.json()} == {spec.id, skipped.id}
    assert db.query(SalesOrderCrmDocument).count() == 2

    # A user without Sales can't list or open them.
    outsider = make_user(db, "crm.only@premnathrail.com", apps=("crm",))
    assert client.get(f"{ATT}/crm-links", params={"sales_order_id": so["id"]}, headers=hdr(outsider)).status_code == 403


def test_direct_order_has_no_crm_documents_to_link(client, db):
    maker, _, _, _ = setup_people(db)
    _, inq, _ = setup_customer(db)
    doc = _doc(db, "inquiry", inq.id, "spec.pdf")
    so = create_order(client, db, maker, inq)
    # An old (pre-2026-10-28) direct order: new orders always come from CRM.
    from app.modules.sales.models.order import SalesOrder
    db.query(SalesOrder).filter(SalesOrder.id == so["id"]).update({"source_type": "direct", "source_inquiry_id": None, "source_quotation_id": None})
    db.commit()
    r = client.put(f"{ATT}/crm-links", params={"sales_order_id": so["id"]}, json={"crm_document_ids": [doc.id]}, headers=hdr(maker))
    assert r.status_code == 422 and "isn't linked to an inquiry or tender" in r.json()["detail"]
