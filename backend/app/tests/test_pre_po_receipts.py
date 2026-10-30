"""Before-PO receipts: Store records goods that came before their PO (no stock
posted); Procurement raises a requisition for them (Create requisition) and uploads
the Tally PO on it (Upload PO), which links the receipt; the PO goes through normal
approval and GRN; the GRN closes the receipt."""
from datetime import date

from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.audit_log import AuditLog
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.store.models.pre_po_receipt import StorePrePoReceipt
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.tests.p2p_po_helpers import post_upload_po, upload_po_details
from app.tests.p2p_workflow_helpers import master_item, set_po_workflow
from app.tests.test_mm_po_split_amend_quotes import _decide_all
from app.tests.test_p2p_item_master_link import _grn, _inspect_all, _store
from app.tests.test_p2p_requests import (  # noqa: F401 - _sqlite_number_series is an autouse fixture
    _purchaser, _sqlite_number_series, auth_header, make_user,
)

def _ensure_routers_mounted():
    """Mounts the two routers when main.py does not include them yet (the Manager adds the include lines)."""
    from app.main import app
    from app.modules.p2p.routes import pre_po_receipts as p2p_routes
    from app.modules.store.routes import pre_po_receipts as store_routes
    paths = {getattr(r, "path", "") for r in app.routes}
    if not any(p.startswith("/api/v1/store/pre-po-receipts") for p in paths):
        app.include_router(store_routes.router, prefix="/api/v1")
    if not any(p.startswith("/api/v1/p2p/pre-po-receipts") for p in paths):
        app.include_router(p2p_routes.router, prefix="/api/v1")


_ensure_routers_mounted()

STORE = "/api/v1/store/pre-po-receipts"
PROC = "/api/v1/p2p/pre-po-receipts"
RFQS = "/api/v1/p2p/rfqs"


def _store_user(db, email, perms=("store:grn:view", "store:grn:create")):
    u = make_user(db, email, assigned_apps=("store",))
    u.granular_permissions = list(perms)
    db.commit()
    # Every store person runs a store: receipts are booked into it.
    db.add(StoreLocation(name=f"Store of {email}", code=f"S-{u.id}", manager_user_id=u.id))
    db.commit()
    return u


def _vendor(db, code="V-BPO1", status="active"):
    v = Vendor(code=code, name=f"Vendor {code}", status=status, gst_registration_type="unregistered")
    db.add(v)
    db.commit()
    return v


def _body(vendor, item, qty=10, **kw):
    return {"vendor_id": vendor.id, "received_date": date.today().isoformat(),
            "items": [{"store_item_id": item.id, "quantity": qty}], **kw}


def test_store_records_a_receipt_without_posting_stock(client, db):
    keeper = _store_user(db, "bpo.keeper@premnathrail.com")
    v, item = _vendor(db), master_item(db, "Bolt BPO", code="BPO-1", uom="Nos")
    r = client.post(STORE, json=_body(v, item, 10, delivery_challan_number="DC-1"), headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending_po" and body["receipt_number"].startswith("BPO-")
    assert body["vendor_name"] == v.name and body["items"][0]["item_code"] == "BPO-1" and body["items"][0]["unit"] == "Nos"
    assert db.query(StoreStockBalance).filter_by(item_id=item.id).count() == 0  # held, not in stock
    lst = client.get(STORE, headers=auth_header(keeper)).json()
    assert [x["receipt_number"] for x in lst] == [body["receipt_number"]]


def test_store_person_books_into_own_store_only(client, db):
    keeper = _store_user(db, "bpo.own@premnathrail.com")
    own = db.query(StoreLocation).filter_by(manager_user_id=keeper.id).one()
    other = StoreLocation(name="Other store BPO", code="BPO-OTH")
    db.add(other)
    db.commit()
    v, item = _vendor(db, "V-BPOO"), master_item(db, "Pin BPO", code="BPO-O", uom="Nos")
    # Whatever store is sent, the receipt lands in the keeper's own store.
    r = client.post(STORE, json=_body(v, item, 2, store_location_id=other.id), headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    assert r.json()["store_location_id"] == own.id
    # A user with no store of their own is refused with the fix.
    db.delete(own)
    db.delete(other)
    db.commit()
    r = client.post(STORE, json=_body(v, item, 2), headers=auth_header(keeper))
    assert r.status_code == 403 and "No store is linked to you" in r.json()["detail"]


def test_create_refuses_blocked_vendor_duplicate_lines_and_empty_items(client, db):
    keeper = _store_user(db, "bpo.keeper2@premnathrail.com")
    item = master_item(db, "Nut BPO", code="BPO-2", uom="Nos")
    blocked = _vendor(db, "V-BPOB", status="blocked")
    r = client.post(STORE, json=_body(blocked, item), headers=auth_header(keeper))
    assert r.status_code == 409 and "blocked" in r.json()["detail"]
    ok = _vendor(db, "V-BPOK")
    dup = _body(ok, item)
    dup["items"].append({"store_item_id": item.id, "quantity": 2})
    r = client.post(STORE, json=dup, headers=auth_header(keeper))
    assert r.status_code == 422 and "more than once" in r.json()["detail"]
    assert client.post(STORE, json={**_body(ok, item), "items": []}, headers=auth_header(keeper)).status_code == 422


def test_routes_deny_users_without_permission_and_other_peoples_receipts(client, db, monkeypatch):
    keeper = _store_user(db, "bpo.keeper3@premnathrail.com")
    v, item = _vendor(db, "V-BPO3"), master_item(db, "Pin BPO", code="BPO-3", uom="Nos")
    rid = client.post(STORE, json=_body(v, item), headers=auth_header(keeper)).json()["id"]
    nobody = make_user(db, "bpo.nobody@premnathrail.com", assigned_apps=("hr",))
    assert client.get(STORE, headers=auth_header(nobody)).status_code == 403
    assert client.post(STORE, json=_body(v, item), headers=auth_header(nobody)).status_code == 403
    assert client.get(f"{STORE}/{rid}", headers=auth_header(nobody)).status_code == 403
    viewer = _store_user(db, "bpo.viewer@premnathrail.com", perms=("store:grn:view",))
    assert client.post(STORE, json=_body(v, item), headers=auth_header(viewer)).status_code == 403
    assert client.post(f"{STORE}/{rid}/cancel", json={"reason": "x"}, headers=auth_header(viewer)).status_code == 403
    from app.core.config import settings
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "assigned")  # the production default
    # Data scope: another keeper (own/assigned scope) can't open it by id; the list hides it.
    other = _store_user(db, "bpo.other@premnathrail.com")
    assert client.get(f"{STORE}/{rid}", headers=auth_header(other)).status_code == 403
    assert client.get(STORE, headers=auth_header(other)).json() == []
    # Procurement side is gated by the Procurement Purchase Orders tab.
    assert client.get(f"{PROC}/pending", headers=auth_header(keeper)).status_code == 403
    assert client.post(f"{PROC}/{rid}/create-requisition", headers=auth_header(keeper)).status_code == 403


def test_cancel_needs_a_reason_and_only_while_pending(client, db):
    keeper = _store_user(db, "bpo.keeper4@premnathrail.com")
    v, item = _vendor(db, "V-BPO4"), master_item(db, "Ring BPO", code="BPO-4", uom="Nos")
    rid = client.post(STORE, json=_body(v, item), headers=auth_header(keeper)).json()["id"]
    assert client.post(f"{STORE}/{rid}/cancel", json={"reason": "  "}, headers=auth_header(keeper)).status_code == 422
    r = client.post(f"{STORE}/{rid}/cancel", json={"reason": "Returned to vendor"}, headers=auth_header(keeper))
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["cancel_reason"] == "Returned to vendor"
    again = client.post(f"{STORE}/{rid}/cancel", json={"reason": "again"}, headers=auth_header(keeper))
    assert again.status_code == 409 and "already cancelled" in again.json()["detail"]
    buyer = _purchaser(db, "bpo.buyer4@premnathrail.com")
    assert client.get(f"{PROC}/pending", headers=auth_header(buyer)).json() == []
    assert client.post(f"{PROC}/{rid}/create-requisition", headers=auth_header(buyer)).status_code == 409


def _upload_on(client, db, buyer, rfq_id, pr_id, tally="TALLY-BPO-1", **kw):
    """Upload the Tally PO on a Before-PO requisition: the vendor is the receipt's (the RFQ's one quote), so
    the payload names none."""
    details = upload_po_details(db, pr_id, unit_price=kw.pop("unit_price", 20), tax_rate=kw.pop("tax_rate", None), **kw)
    details.pop("vendor_id")
    return post_upload_po(client, buyer, rfq_id, details, tally)


def test_procurement_raises_the_requisition_uploads_the_po_it_is_approved_received_and_the_receipt_closes(client, db):
    keeper = _store_user(db, "bpo.keeper5@premnathrail.com")
    v, item = _vendor(db, "V-BPO5"), master_item(db, "Valve BPO", code="BPO-5", uom="Nos")
    rec = client.post(STORE, json=_body(v, item, 7), headers=auth_header(keeper)).json()
    buyer = _purchaser(db, "bpo.buyer5@premnathrail.com")
    admin = make_user(db, "bpo.admin@premnathrail.com", role="admin")
    approver = make_user(db, "bpo.approver@premnathrail.com")
    partner = make_user(db, "bpo.partner@premnathrail.com", is_partner=True)
    set_po_workflow(db, [approver.id], admin, partner=True)

    pending = client.get(f"{PROC}/pending", headers=auth_header(buyer)).json()
    assert [p["id"] for p in pending] == [rec["id"]]

    r = client.post(f"{PROC}/{rec['id']}/create-requisition", headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    out = r.json()
    rfq = out["rfq"]
    assert "po" not in out  # no PO is made here: it is made in Tally and uploaded on the requisition
    assert rfq["status"] == "locked" and rfq["is_single_quotation"] is True
    db.expire_all()
    row = db.get(StorePrePoReceipt, rec["id"])
    assert row.status == "pending_po" and row.purchase_order_id is None and row.p2p_request_id
    pr = db.get(P2PRequest, row.p2p_request_id)
    assert pr.status == "vendor_selected" and pr.purpose == "stock"
    assert [(i.store_item_id, i.quantity) for i in pr.items] == [(item.id, 7)]
    assert db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr.id, action="created_from_pre_po_receipt").count() == 1
    # Still waiting for its PO, and a second click is refused with where to go.
    assert [p["id"] for p in client.get(f"{PROC}/pending", headers=auth_header(buyer)).json()] == [rec["id"]]
    again = client.post(f"{PROC}/{rec['id']}/create-requisition", headers=auth_header(buyer))
    assert again.status_code == 409 and "already has requisition" in again.json()["detail"] and pr.p2p_number in again.json()["detail"]

    # Upload PO: a line that isn't on the requisition is refused; the receipt stays waiting.
    stray = upload_po_details(db, pr.id, unit_price=5)
    stray.pop("vendor_id")
    stray["lines"] = [{"pr_item_id": pr.items[0].id + 999, "unit_price": 5}]
    bad = post_upload_po(client, buyer, rfq["id"], stray, "TALLY-BPO-0")
    assert bad.status_code == 422 and "not open lines" in bad.json()["detail"]
    db.expire_all()
    assert db.get(StorePrePoReceipt, rec["id"]).status == "pending_po"
    # Priced as on the Tally PO, it goes into approval and links the receipt.
    po_resp = _upload_on(client, db, buyer, rfq["id"], pr.id)
    assert po_resp.status_code == 200, po_resp.text
    po = po_resp.json()
    assert po["status"] == "issued" and po["vendor_id"] == v.id and po["external_ref"] == "TALLY-BPO-1"
    assert [(i["store_item_id"], i["quantity"], i["unit_price"]) for i in po["items"]] == [(item.id, 7, 20)]
    db.expire_all()
    row = db.get(StorePrePoReceipt, rec["id"])
    assert row.status == "po_created" and row.purchase_order_id == po["id"] and row.p2p_request_id == pr.id
    assert client.get(f"{PROC}/pending", headers=auth_header(buyer)).json() == []
    second = client.post(f"{PROC}/{rec['id']}/create-requisition", headers=auth_header(buyer))
    assert second.status_code == 409 and "not waiting for a PO" in second.json()["detail"]
    assert client.post(f"{STORE}/{rec['id']}/cancel", json={"reason": "x"}, headers=auth_header(keeper)).status_code == 409

    # Normal PO approval: the engine, then a Partner.
    _decide_all(client, db, "p2p_purchase_order", po["id"], [approver, partner])

    # GRN for the full quantity closes the receipt.
    loc = _store(db, "BPO5")
    body = client.get(f"/api/v1/p2p/purchase-orders/{po['id']}", headers=auth_header(buyer)).json()
    g = _grn(client, buyer, body, loc, 7)
    assert g.status_code == 200, g.text
    assert _inspect_all(client, buyer, g.json()).status_code == 200
    db.expire_all()
    assert db.get(StorePrePoReceipt, rec["id"]).status == "closed"


def test_future_received_date_is_refused(client, db):
    from datetime import timedelta
    keeper = _store_user(db, "bpo.keeper6@premnathrail.com")
    v, item = _vendor(db, "V-BPO6"), master_item(db, "Cap BPO", code="BPO-6", uom="Nos")
    body = _body(v, item)
    body["received_date"] = (date.today() + timedelta(days=2)).isoformat()
    r = client.post(STORE, json=body, headers=auth_header(keeper))
    assert r.status_code == 422 and "in the future" in r.json()["detail"]
    assert client.post(STORE, json=_body(v, item, delivery_challan_number="X" * 101), headers=auth_header(keeper)).status_code == 422


def test_create_po_needs_the_buyer_rule(client, db):
    from app.modules.main.models.role import Role
    keeper = _store_user(db, "bpo.keeper7@premnathrail.com")
    v, item = _vendor(db, "V-BPO7"), master_item(db, "Clip BPO", code="BPO-7", uom="Nos")
    rid = client.post(STORE, json=_body(v, item), headers=auth_header(keeper)).json()["id"]
    outsider = _purchaser(db, "bpo.buyer7@premnathrail.com")
    role = Role(name="Not a buyer", permissions=["p2p:purchase_requisitions:view", "p2p:purchase_orders:view", "p2p:purchase_orders:create"],
                assignee_rules={"p2p:purchase_requisitions.buyer": {"mode": "custom", "users": [keeper.id]}})
    db.add(role)
    db.commit()
    outsider.roles = [role]
    db.commit()
    r = client.post(f"{PROC}/{rid}/create-requisition", headers=auth_header(outsider))
    assert r.status_code == 403 and "Assign buyer to" in r.json()["detail"]
    db.expire_all()
    assert db.get(StorePrePoReceipt, rid).status == "pending_po"


def _make_po(client, db, tag, qty=7, workflow=True):
    """Receipt -> requisition -> Tally PO uploaded on it. `workflow` points PO approval at a fresh
    approver and Partner (the upload sends the PO straight into approval)."""
    if workflow:
        admin = make_user(db, f"bpo.wf.admin.{tag}@premnathrail.com", role="admin")
        approver = make_user(db, f"bpo.wf.approver.{tag}@premnathrail.com")
        make_user(db, f"bpo.wf.partner.{tag}@premnathrail.com", is_partner=True)
        set_po_workflow(db, [approver.id], admin, partner=True)
    keeper = _store_user(db, f"bpo.k.{tag}@premnathrail.com")
    v, item = _vendor(db, f"V-{tag}"), master_item(db, f"Item {tag}", code=f"BP-{tag}", uom="Nos")
    rec = client.post(STORE, json=_body(v, item, qty), headers=auth_header(keeper)).json()
    buyer = _purchaser(db, f"bpo.b.{tag}@premnathrail.com")
    out = client.post(f"{PROC}/{rec['id']}/create-requisition", headers=auth_header(buyer)).json()
    pr_id = db.get(StorePrePoReceipt, rec["id"]).p2p_request_id
    up = _upload_on(client, db, buyer, out["rfq"]["id"], pr_id, tally=f"TALLY-{tag}", unit_price=9)
    assert up.status_code == 200, up.text
    out["po"] = up.json()  # the PO the Tally upload made, next to the requisition's RFQ
    return keeper, buyer, rec, out


def test_receipt_uses_line_category_and_line_buyer(client, db):
    from app.modules.p2p.models.p2p_request import LINE_CATEGORY
    _k, _b, _rec, out = _make_po(client, db, "CAT")
    pr = db.get(P2PRequest, out["po"]["p2p_request_id"])
    assert pr.category_code == LINE_CATEGORY and pr.items[0].store_item_id


def test_rejected_po_sends_the_receipt_back_to_pending_and_a_new_requisition_can_be_made(client, db):
    from app.modules.organization.services import approval_engine as engine
    admin = make_user(db, "bpo.admin2@premnathrail.com", role="admin")
    approver = make_user(db, "bpo.approver2@premnathrail.com")
    make_user(db, "bpo.partner2@premnathrail.com", is_partner=True)
    set_po_workflow(db, [approver.id], admin, partner=True)
    keeper, buyer, rec, out = _make_po(client, db, "REJ", workflow=False)
    po = out["po"]
    assert po["status"] == "issued"
    req = engine.latest_request(db, "p2p_purchase_order", po["id"])
    r = client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "reject", "comment": "Too dear"},
                    headers=auth_header(approver))
    assert r.status_code == 200, r.text
    db.expire_all()
    row = db.get(StorePrePoReceipt, rec["id"])
    assert row.status == "pending_po" and row.purchase_order_id is None and row.p2p_request_id is None
    assert [p["id"] for p in client.get(f"{PROC}/pending", headers=auth_header(buyer)).json()] == [rec["id"]]
    again = client.post(f"{PROC}/{rec['id']}/create-requisition", headers=auth_header(buyer))
    assert again.status_code == 200, again.text


# ---------------------------------------------------------------- round 2: notification, hidden RFQ, files

def _sharepoint(monkeypatch):
    """Stub SharePoint so uploads / downloads run without a network."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site")

    async def _up(site, folder, f):
        return {"name": f.filename, "path": f"{folder}/{f.filename}", "webUrl": "http://x", "size": 3}

    async def _down(site, path):
        return b"abc", "application/pdf"

    monkeypatch.setattr("app.modules.p2p.pre_po.upload_file_to_sharepoint", _up, raising=False)
    monkeypatch.setattr("app.utils.sharepoint.upload_file_to_sharepoint", _up)
    monkeypatch.setattr("app.utils.sharepoint.download_file_content", _down)


def test_recording_a_receipt_notifies_procurement_and_line_buyers_once(client, db):
    from app.modules.main.models.notification import Notification
    from app.modules.main.models.role import Role
    keeper = _store_user(db, "bpo.keeper8@premnathrail.com")
    buyer = _purchaser(db, "bpo.buyer8@premnathrail.com")
    role = Role(name="Procurement notified", permissions=["p2p:purchase_orders:view", "p2p:purchase_orders:create"],
                notification_events={"p2p.pre_po_receipt_recorded": ["bell"]})
    db.add(role)
    db.commit()
    buyer.roles = [role]
    db.commit()
    v, item = _vendor(db, "V-BPO8"), master_item(db, "Seal BPO", code="BPO-8", uom="Nos")
    rec = client.post(STORE, json=_body(v, item, 4), headers=auth_header(keeper)).json()
    rows = db.query(Notification).filter_by(user_id=buyer.id, entity_type="store_pre_po_receipt", entity_id=rec["id"]).all()
    assert len(rows) == 1 and rec["receipt_number"] in rows[0].title and "make its PO" in rows[0].title
    # The recorder is never told about their own receipt.
    assert db.query(Notification).filter_by(user_id=keeper.id, entity_id=rec["id"], entity_type="store_pre_po_receipt").count() == 0


def test_the_internal_rfq_is_hidden_from_lists_but_open_by_id_and_by_po(client, db):
    keeper, buyer, rec, out = _make_po(client, db, "HID")
    assert out["rfq"]["rfq_number"]
    assert client.get(RFQS, headers=auth_header(buyer)).json() == []
    assert client.get(f"{RFQS}/{out['rfq']['id']}", headers=auth_header(buyer)).status_code == 200
    r = client.get(f"{PROC}/by-po/{out['po']['id']}", headers=auth_header(buyer))
    assert r.status_code == 200 and r.json()["id"] == rec["id"] and r.json()["po_number"] == out["po"]["po_number"]
    # An ordinary PO (no receipt) gives JSON null.
    other = db.get(StorePrePoReceipt, rec["id"])
    other.purchase_order_id = None
    db.commit()
    r = client.get(f"{PROC}/by-po/{out['po']['id']}", headers=auth_header(buyer))
    assert r.status_code == 200 and r.json() is None
    assert client.get(f"{PROC}/by-po/999999", headers=auth_header(buyer)).status_code == 404


def test_attach_download_delete_permissions(client, db, monkeypatch):
    _sharepoint(monkeypatch)
    keeper = _store_user(db, "bpo.keeper9@premnathrail.com")
    v, item = _vendor(db, "V-BPO9"), master_item(db, "Plug BPO", code="BPO-9", uom="Nos")
    rid = client.post(STORE, json=_body(v, item), headers=auth_header(keeper)).json()["id"]
    files = {"file": ("inv.pdf", b"abc", "application/pdf")}
    r = client.post(f"{STORE}/{rid}/attachments", data={"doc_type": "invoice"}, files=files, headers=auth_header(keeper))
    assert r.status_code == 200, r.text
    att = r.json()["attachments"][0]
    assert att["doc_type"] == "invoice" and att["uploaded_by_id"] == keeper.id and att["uploaded_by_name"]
    assert client.post(f"{STORE}/{rid}/attachments", data={"doc_type": "bogus"}, files=files,
                       headers=auth_header(keeper)).status_code == 400
    # Download: store viewer yes, outsider no.
    got = client.get(f"{STORE}/{rid}/attachments/{att['id']}/content", headers=auth_header(keeper))
    assert got.status_code == 200 and got.content == b"abc"
    nobody = make_user(db, "bpo.nobody9@premnathrail.com", assigned_apps=("hr",))
    assert client.get(f"{STORE}/{rid}/attachments/{att['id']}/content", headers=auth_header(nobody)).status_code == 403
    assert client.post(f"{STORE}/{rid}/attachments", data={"doc_type": "other"}, files=files, headers=auth_header(nobody)).status_code == 403
    assert client.get(f"{PROC}/{rid}/attachments/{att['id']}/content", headers=auth_header(nobody)).status_code == 403
    assert client.post(f"{PROC}/{rid}/attachments", data={"doc_type": "other"}, files=files, headers=auth_header(nobody)).status_code == 403
    # Procurement attaches the challan and opens the invoice.
    buyer = _purchaser(db, "bpo.buyer9@premnathrail.com")
    pr = client.post(f"{PROC}/{rid}/attachments", data={"doc_type": "challan"}, files=files, headers=auth_header(buyer))
    assert pr.status_code == 200 and {a["doc_type"] for a in pr.json()["attachments"]} == {"invoice", "challan"}
    assert client.get(f"{PROC}/{rid}/attachments/{att['id']}/content", headers=auth_header(buyer)).status_code == 200
    # Delete: only the uploader (another store keeper is refused with a real reason).
    other = _store_user(db, "bpo.other9@premnathrail.com")
    d = client.delete(f"{STORE}/{rid}/attachments/{att['id']}", headers=auth_header(other))
    assert d.status_code == 403
    from app.core.config import settings
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "organization")
    d = client.delete(f"{STORE}/{rid}/attachments/{att['id']}", headers=auth_header(other))
    assert d.status_code == 403 and "uploaded yourself" in d.json()["detail"]
    d = client.delete(f"{STORE}/{rid}/attachments/{att['id']}", headers=auth_header(keeper))
    assert d.status_code == 200 and [a["doc_type"] for a in d.json()["attachments"]] == ["challan"]
    # A cancelled receipt takes no more files.
    assert client.post(f"{STORE}/{rid}/cancel", json={"reason": "Returned"}, headers=auth_header(keeper)).status_code == 200
    late = client.post(f"{STORE}/{rid}/attachments", data={"doc_type": "other"}, files=files, headers=auth_header(keeper))
    assert late.status_code == 409 and "cancelled" in late.json()["detail"]
