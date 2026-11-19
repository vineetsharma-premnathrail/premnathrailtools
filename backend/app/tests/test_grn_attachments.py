"""Vendor invoice / delivery challan files on a GRN (owner, 2026-11-19): Store adds them while
receiving; anyone who can open the GRN can view / download them."""
from unittest import mock

from app.core.config import settings
from app.modules.p2p.routes import goods_receipts as grn_routes
from app.modules.main.models.user import User
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_item_master_link import GRN, _grn, _po_for, _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    _approve_and_raise_po, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header,
)


def _sharepoint(stack_calls):
    async def _up(_site, folder, file):
        stack_calls.append(folder)
        return {"name": file.filename, "size": 4, "path": f"{folder}/{file.filename}", "webUrl": None}

    async def _down(_site, _path):
        return b"%PDF", "application/pdf"

    async def _preview(_site, path):
        return f"https://tenant.sharepoint.com/view/{path.rsplit('/', 1)[-1]}"

    return [
        mock.patch("app.utils.sharepoint.upload_file_to_sharepoint", _up),
        mock.patch("app.utils.sharepoint.download_file_content", _down),
        mock.patch("app.utils.sharepoint.get_preview_url", _preview),
        mock.patch.object(settings, "SHAREPOINT_SITE_ID", "site"),
    ]


def test_store_attaches_invoice_and_challan_to_a_grn_and_others_cannot(client, db):
    item = master_item(db, "Brake shoe", code="RM-BRK-AT", uom="NOS")
    loc = _store(db, "AT1")
    requester = _requester(db, "at.req@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"store_item_id": item.id, "quantity": 5, "project_inhouse": "Project"}])
    buyer = _purchaser(db, "at.buyer@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    grn = _grn(client, buyer, _po_for(client, buyer, pr["id"]), loc, 5)
    assert grn.status_code == 200, grn.text
    grn = grn.json()
    assert grn["attachments"] == []

    folders: list[str] = []
    patches = _sharepoint(folders)
    for p in patches:
        p.start()
    try:
        url = f"{GRN}/{grn['id']}/attachments"
        r = client.post(url, files={"file": ("bill.pdf", b"%PDF", "application/pdf")}, data={"doc_type": "invoice"}, headers=auth_header(buyer))
        assert r.status_code == 200, r.text
        r = client.post(url, files={"file": ("dc.jpg", b"jpeg", "image/jpeg")}, data={"doc_type": "challan"}, headers=auth_header(buyer))
        assert r.status_code == 200, r.text
        files = r.json()["attachments"]
        assert [(f["doc_type"], f["filename"]) for f in files] == [("invoice", "bill.pdf"), ("challan", "dc.jpg")]
        assert folders and all(grn["grn_number"] in f for f in folders)

        bad = client.post(url, files={"file": ("x.pdf", b"%PDF", "application/pdf")}, data={"doc_type": "bogus"}, headers=auth_header(buyer))
        assert bad.status_code == 400 and "invoice" in bad.json()["detail"]

        att = files[0]["id"]
        got = client.get(f"{url}/{att}/content", headers=auth_header(buyer))
        assert got.status_code == 200 and got.content == b"%PDF"
        view = client.get(f"{url}/{att}/preview", headers=auth_header(buyer))
        assert view.status_code == 200 and view.json()["getUrl"].endswith("bill.pdf")
        assert client.get(f"{url}/999999/content", headers=auth_header(buyer)).status_code == 404

        # Someone without Store › GRN can neither add nor open the files.
        outsider = User(email="at.out@premnathrail.com", name="Out", role="user", is_active=True, assigned_apps=["crm"], granular_permissions=[])
        db.add(outsider)
        db.commit()
        assert client.get(f"{url}/{att}/content", headers=auth_header(outsider)).status_code == 403
        assert client.post(url, files={"file": ("y.pdf", b"%PDF", "application/pdf")}, data={"doc_type": "invoice"},
                           headers=auth_header(outsider)).status_code == 403
        # The GRN itself lists them.
        assert len(client.get(f"{GRN}/{grn['id']}", headers=auth_header(buyer)).json()["attachments"]) == 2
    finally:
        for p in patches:
            p.stop()


def test_route_module_exposes_the_attachment_routes():
    paths = {r.path for r in grn_routes.router.routes}
    assert {"/p2p/goods-receipts/{grn_id}/attachments", "/p2p/goods-receipts/{grn_id}/attachments/{attachment_id}/content",
            "/p2p/goods-receipts/{grn_id}/attachments/{attachment_id}/preview"} <= paths
