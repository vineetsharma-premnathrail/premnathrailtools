"""MM purchasing (2026-10-14): ME47/ME49 line quotations + comparison +
award, ME21N split of one PR into POs by vendor, ME22N amendment with
re-release, ME11/ME01/ME1P info records, source list and price history."""
import pytest

from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_catalog_item import VendorCatalogItem
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.models.rfq import RFQ
from app.tests.p2p_workflow_helpers import master_item, set_po_workflow
from app.tests.test_p2p_item_master_link import _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    _approve_pr, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header, make_user,
)

RFQS = "/api/v1/p2p/rfqs"
POS = "/api/v1/p2p/purchase-orders"
IR = "/api/v1/p2p/info-records"


def _vendor(db, code, name):
    v = Vendor(code=code, name=name, status="active", gst_registration_type="unregistered")
    db.add(v)
    db.commit()
    return v


def _decide_all(client, db, entity_type, entity_id, people):
    """Approve the current request stage by stage with whoever is pending."""
    for _ in range(6):
        req = engine.latest_request(db, entity_type, entity_id)
        db.refresh(req)
        if req.status != "pending":
            return req
        pending = [s.approver_id for s in req.steps if s.sequence == req.current_sequence and s.status == "pending"]
        who = next(p for p in people if p.id in pending)
        r = client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "approve", "comment": "OK"},
                        headers=auth_header(who))
        assert r.status_code == 200, r.text
        db.expire_all()
    return engine.latest_request(db, entity_type, entity_id)


@pytest.fixture
def setup(client, db):
    a = master_item(db, "Hydraulic pump MM", code="MM-A", uom="Nos")
    b = master_item(db, "Steel plate MM", code="MM-B", uom="Nos")
    requester = _requester(db, "mm.req@premnathrail.com")
    pr = _create_pr(client, requester, items=[
        {"store_item_id": a.id, "quantity": 10, "project_inhouse": "Project"},
        {"store_item_id": b.id, "quantity": 4, "project_inhouse": "Project"}])
    _approve_pr(client, pr)
    buyer = _purchaser(db, "mm.buyer@premnathrail.com")
    admin = make_user(db, "mm.admin@premnathrail.com", role="admin")
    po1 = make_user(db, "mm.poapp@premnathrail.com")
    partner = make_user(db, "mm.partner@premnathrail.com", is_partner=True)
    set_po_workflow(db, [po1.id], admin, partner=True)
    row = db.get(P2PRequest, pr["id"])
    for it in row.items:
        it.fulfillment_status = "sent_to_procurement"
    row.status = "vendor_quotations"
    rfq = RFQ(rfq_number=f"RFQ-MM-{pr['id']}", p2p_request_id=pr["id"], status="locked")
    db.add(rfq)
    db.commit()
    v1, v2 = _vendor(db, "V-MM1", "Alpha Hydraulics"), _vendor(db, "V-MM2", "Beta Steels")
    lines = {i.store_item_id: i.id for i in row.items}
    return {"pr": pr, "rfq": rfq, "buyer": buyer, "approvers": [po1, partner], "v1": v1, "v2": v2, "a": a, "b": b,
            "line_a": lines[a.id], "line_b": lines[b.id], "admin": admin}


def _quote(client, s, vendor, items, **kw):
    r = client.post(f"{RFQS}/{s['rfq'].id}/line-quotations", json={"vendor_id": vendor.id, "items": items, **kw},
                    headers=auth_header(s["buyer"]))
    assert r.status_code == 200, r.text
    return r.json()


def _quoted_and_awarded(client, s):
    q1 = _quote(client, s, s["v1"], [{"pr_item_id": s["line_a"], "unit_price": 100, "gst_rate": 18},
                                      {"pr_item_id": s["line_b"], "unit_price": 50, "gst_rate": 18}], freight_total=100)
    q2 = _quote(client, s, s["v2"], [{"pr_item_id": s["line_a"], "unit_price": 90, "gst_rate": 18, "delivery_days": 7},
                                      {"pr_item_id": s["line_b"], "unit_price": 70, "gst_rate": 18}])
    return q1, q2


def _qi(q, line):
    return next(i["id"] for i in q["items"] if i["pr_item_id"] == line)


def test_line_quotes_comparison_and_award_needs_reason_when_not_l1(client, db, setup):
    s = setup
    q1, q2 = _quoted_and_awarded(client, s)
    cmp = client.get(f"{RFQS}/{s['rfq'].id}/comparison", headers=auth_header(s["buyer"])).json()
    rows = {r["pr_item_id"]: r for r in cmp["lines"]}
    # A: V1 landed = 100 + freight share (100 x 1000/1200 / 10) = 108.33 > V2 90 → V2 is L1.
    assert rows[s["line_a"]]["l1_vendor_quotation_id"] == q2["id"]
    assert rows[s["line_b"]]["l1_vendor_quotation_id"] == q1["id"]
    cell = next(c for c in rows[s["line_a"]]["quotes"] if c["vendor_quotation_id"] == q1["id"])
    assert cell["landed_unit"] == pytest.approx(108.3333, abs=1e-3) and cell["rank"] == "L2"
    assert cmp["overall_l1_vendor_quotation_id"] == q2["id"]  # 1180 vs 1300
    # Duplicate vendor quote is refused.
    r = client.post(f"{RFQS}/{s['rfq'].id}/line-quotations", json={"vendor_id": s["v1"].id, "items": [
        {"pr_item_id": s["line_a"], "unit_price": 1}]}, headers=auth_header(s["buyer"]))
    assert r.status_code == 409
    # Awarding B to V2 (L2) without a reason is refused, with one it is fine.
    r = client.post(f"{RFQS}/{s['rfq'].id}/awards", json={"awards": [
        {"pr_item_id": s["line_b"], "vendor_quotation_item_id": _qi(q2, s["line_b"])}]}, headers=auth_header(s["buyer"]))
    assert r.status_code == 422 and "not L1" in r.json()["detail"]
    r = client.post(f"{RFQS}/{s['rfq'].id}/awards", json={"awards": [
        {"pr_item_id": s["line_b"], "vendor_quotation_item_id": _qi(q2, s["line_b"]), "reason": "Single-source delivery"}]},
        headers=auth_header(s["buyer"]))
    assert r.status_code == 200, r.text
    assert {x["pr_item_id"]: x["awarded_vendor_quotation_id"] for x in r.json()["lines"]}[s["line_b"]] == q2["id"]
    assert client.get(f"{RFQS}/{s['rfq'].id}/comparison/export", headers=auth_header(s["admin"])).status_code == 200


def _split(client, s, q1, q2):
    client.post(f"{RFQS}/{s['rfq'].id}/awards", json={"awards": [
        {"pr_item_id": s["line_a"], "vendor_quotation_item_id": _qi(q2, s["line_a"])},
        {"pr_item_id": s["line_b"], "vendor_quotation_item_id": _qi(q1, s["line_b"])}]}, headers=auth_header(s["buyer"]))
    prop = client.get(f"{RFQS}/{s['rfq'].id}/split-proposal", headers=auth_header(s["buyer"])).json()
    assert len(prop["groups"]) == 2 and prop["unawarded"] == []
    loc = _store(db_of(s), "MMS")
    groups = [{"vendor_id": g["vendor_id"], "vendor_quotation_id": g["vendor_quotation_id"],
               "lines": [{"pr_item_id": ln["pr_item_id"], "vendor_quotation_item_id": ln["vendor_quotation_item_id"]} for ln in g["lines"]]}
              for g in prop["groups"]]
    r = client.post(f"{RFQS}/{s['rfq'].id}/split-pos", json={"ship_to_location_id": loc.id, "pos": groups}, headers=auth_header(s["buyer"]))
    assert r.status_code == 200, r.text
    return {p["vendor_id"]: p for p in r.json()}, loc


def db_of(s):
    from sqlalchemy.orm import object_session
    return object_session(s["v1"])


def test_split_one_pr_into_pos_by_vendor_release_and_rollup(client, db, setup):
    s = setup
    q1, q2 = _quoted_and_awarded(client, s)
    # Over-ordering a PR line across groups is refused.
    r = client.post(f"{RFQS}/{s['rfq'].id}/split-pos", json={"pos": [
        {"vendor_id": s["v2"].id, "lines": [{"pr_item_id": s["line_a"], "quantity": 11, "vendor_quotation_item_id": _qi(q2, s["line_a"])}]}]},
        headers=auth_header(s["buyer"]))
    assert r.status_code == 409 and "more than is left" in r.json()["detail"]
    pos, _loc = _split(client, s, q1, q2)
    p_a, p_b = pos[s["v2"].id], pos[s["v1"].id]
    assert [i["pr_item_id"] for i in p_a["items"]] == [s["line_a"]] and p_a["items"][0]["unit_price"] == 90
    assert p_a["items"][0]["price_source"] == "quotation" and p_a["items"][0]["delivery_date"]
    assert p_b["items"][0]["unit_price"] == 50 and p_a["ship_to_location_id"]
    db.expire_all()
    assert db.get(P2PRequest, s["pr"]["id"]).status == "po_drafted"

    for p in (p_a, p_b):
        r = client.post(f"{RFQS}/{s['rfq'].id}/po-draft/{p['id']}/submit", headers=auth_header(s["buyer"]))
        assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(P2PRequest, s["pr"]["id"]).status == "po_raised"
    _decide_all(client, db, "p2p_purchase_order", p_a["id"], s["approvers"])
    db.expire_all()
    pr = db.get(P2PRequest, s["pr"]["id"])
    assert pr.status == "po_raised"  # the other PO is still in approval
    from app.modules.p2p.routes.goods_receipts import _po_approval_block_reason
    assert _po_approval_block_reason(db, db.get(P2PPurchaseOrder, p_a["id"])) is None  # this PO can be received
    assert _po_approval_block_reason(db, db.get(P2PPurchaseOrder, p_b["id"])) is not None
    _decide_all(client, db, "p2p_purchase_order", p_b["id"], s["approvers"])
    db.expire_all()
    pr = db.get(P2PRequest, s["pr"]["id"])
    assert pr.status == "po_approved" and pr.po_value == pytest.approx(900 * 1.18 + 200 * 1.18)
    # ME11: released prices became the info records.
    rec = db.query(VendorCatalogItem).filter_by(vendor_id=s["v2"].id, store_item_id=s["a"].id).one()
    assert rec.unit_price == 90 and rec.last_po_number == p_a["po_number"]
    hist = client.get(f"{IR}/price-history", params={"store_item_id": s["a"].id}, headers=auth_header(s["buyer"])).json()
    assert hist["last_price"] == 90 and hist["rows"][0]["po_number"] == p_a["po_number"]
    dp = client.get(f"{IR}/default-price", params={"vendor_id": s["v2"].id, "store_item_id": s["a"].id}, headers=auth_header(s["buyer"])).json()
    assert dp["unit_price"] == 90


def test_po_amendment_floors_rerelease_and_versions(client, db, setup):
    s = setup
    q1, q2 = _quoted_and_awarded(client, s)
    pos, loc = _split(client, s, q1, q2)
    p_a = pos[s["v2"].id]
    line = p_a["items"][0]["id"]
    # A draft PO isn't amended.
    r = client.post(f"{POS}/{p_a['id']}/amendments", json={"reason": "Vendor revised rate", "changes": [{"po_item_id": line, "unit_price": 85}]},
                    headers=auth_header(s["buyer"]))
    assert r.status_code == 409
    client.post(f"{RFQS}/{s['rfq'].id}/po-draft/{p_a['id']}/submit", headers=auth_header(s["buyer"]))
    _decide_all(client, db, "p2p_purchase_order", p_a["id"], s["approvers"])

    # Receive 6 of 10.
    from app.tests.test_p2p_item_master_link import _grn
    po_body = client.get(f"{POS}/{p_a['id']}", headers=auth_header(s["buyer"])).json()
    g = _grn(client, s["buyer"], po_body, loc, 6)
    assert g.status_code == 200, g.text

    r = client.post(f"{POS}/{p_a['id']}/amendments", json={"reason": "Reduce qty", "changes": [{"po_item_id": line, "quantity": 5}]},
                    headers=auth_header(s["buyer"]))
    assert r.status_code == 409 and "can't go below 6" in r.json()["detail"]
    r = client.post(f"{POS}/{p_a['id']}/amendments", json={"reason": "Drop line", "delete_po_item_ids": [line]}, headers=auth_header(s["buyer"]))
    assert r.status_code == 409 and "can't be deleted" in r.json()["detail"]
    r = client.post(f"{POS}/{p_a['id']}/amendments", json={"reason": "Nothing", "changes": [{"po_item_id": line, "quantity": 10}]},
                    headers=auth_header(s["buyer"]))
    assert r.status_code == 422

    r = client.post(f"{POS}/{p_a['id']}/amendments", json={
        "reason": "Vendor revised price per letter", "changes": [{"po_item_id": line, "quantity": 8, "unit_price": 85}]},
        headers=auth_header(s["buyer"]))
    assert r.status_code == 200, r.text
    am = r.json()
    assert am["status"] == "pending_approval" and am["amendment_no"] == 1 and am["warnings"]  # 6 already received at 90
    assert {(c["field"], c["new"]) for c in am["changes"]} == {("quantity", 8), ("unit_price", 85)}
    # Only one pending amendment at a time; the PO is unchanged until approval.
    assert client.post(f"{POS}/{p_a['id']}/amendments", json={"reason": "Another one", "changes": [{"po_item_id": line, "quantity": 9}]},
                       headers=auth_header(s["buyer"])).status_code == 409
    db.expire_all()
    assert db.get(P2PPurchaseOrder, p_a["id"]).items[0].quantity == 10

    req = _decide_all(client, db, "p2p_po_amendment", am["id"], s["approvers"])
    assert req.status == "approved" and req.workflow_key == "p2p.po_amendment"
    assert {st.stage_name for st in req.steps} == {"PO approvers", "Partner (final approval)"}  # same as the PO workflow
    db.expire_all()
    po = db.get(P2PPurchaseOrder, p_a["id"])
    assert po.amendment_no == 1 and po.items[0].quantity == 8 and po.items[0].unit_price == 85
    assert po.total_value == pytest.approx(8 * 85 * 1.18)
    rec = db.query(VendorCatalogItem).filter_by(vendor_id=s["v2"].id, store_item_id=s["a"].id).one()
    assert rec.unit_price == 85
    hist = client.get(f"{POS}/{p_a['id']}/amendments", headers=auth_header(s["buyer"])).json()
    assert hist[0]["status"] == "approved" and hist[0]["before"]["lines"][0]["quantity"] == 10
    versions = client.get(f"{POS}/{p_a['id']}/versions", headers=auth_header(s["buyer"])).json()
    assert [v["version"] for v in versions] == [0, 1] and versions[1]["snapshot"]["lines"][0]["unit_price"] == 85
    ctx = client.get(f"{POS}/{p_a['id']}/amendment-context", headers=auth_header(s["buyer"])).json()
    assert ctx["lines"][0]["min_quantity"] == 6 and ctx["can_amend"] is True


def test_source_list_and_info_record_keyed_by_item(client, db, setup):
    s = setup
    buyer, admin = s["buyer"], s["admin"]
    # Info record by vendor + item; a second one for the same pair is refused.
    r = client.post(IR, json={"vendor_id": s["v1"].id, "store_item_id": s["a"].id, "unit_price": 95, "min_order_qty": 5,
                              "lead_time_days": 10}, headers=auth_header(admin))
    assert r.status_code == 201, r.text
    assert client.post(IR, json={"vendor_id": s["v1"].id, "store_item_id": s["a"].id}, headers=auth_header(admin)).status_code == 409
    # An old name-only catalog line is linked once to its item, never by name match.
    old = VendorCatalogItem(vendor_id=s["v2"].id, item_name="steel plate", unit_price=60, currency="INR", is_active=True)
    db.add(old)
    db.commit()
    assert client.get(f"{IR}/default-price", params={"vendor_id": s["v2"].id, "store_item_id": s["b"].id},
                      headers=auth_header(buyer)).json()["unit_price"] is None
    assert client.post(f"{IR}/{old.id}/link", json={"store_item_id": s["b"].id}, headers=auth_header(admin)).status_code == 200
    assert client.post(f"{IR}/{old.id}/link", json={"store_item_id": s["a"].id}, headers=auth_header(admin)).status_code == 409
    assert client.get(f"{IR}/default-price", params={"vendor_id": s["v2"].id, "store_item_id": s["b"].id},
                      headers=auth_header(buyer)).json()["unit_price"] == 60

    # Source list: item A only from V1 → a split PO for A to V2 is refused.
    r = client.post(f"{IR}/source-list", json={"store_item_id": s["a"].id, "vendor_id": s["v1"].id, "is_fixed": True}, headers=auth_header(admin))
    assert r.status_code == 201, r.text
    r = client.post(f"{RFQS}/{s['rfq'].id}/split-pos", json={"pos": [
        {"vendor_id": s["v2"].id, "selection_reason": "No quotes recorded", "lines": [{"pr_item_id": s["line_a"]}]}]},
        headers=auth_header(buyer))
    assert r.status_code == 409 and "approved-vendor list" in r.json()["detail"]
    # V1 is allowed, and its price comes from the info record (no quote recorded).
    r = client.post(f"{RFQS}/{s['rfq'].id}/split-pos", json={"pos": [
        {"vendor_id": s["v1"].id, "lines": [{"pr_item_id": s["line_a"], "quantity": 6}]}]}, headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    line = r.json()[0]["items"][0]
    assert line["unit_price"] == 95 and line["price_source"] == "info_record" and line["quantity"] == 6
    fi = client.get(f"{IR}/for-item", params={"store_item_id": s["a"].id}, headers=auth_header(buyer)).json()
    assert fi["source_list"][0]["vendor_name"] == "Alpha Hydraulics" and fi["info_records"][0]["unit_price"] == 95
    # Remaining 4 of A + all of B still open for another PO.
    prop = client.get(f"{RFQS}/{s['rfq'].id}/split-proposal", headers=auth_header(buyer)).json()
    assert {u["pr_item_id"]: u["quantity"] for u in prop["unawarded"]} == {s["line_a"]: 4, s["line_b"]: 4}
    # Vendor lookup for an item is by Item Master id.
    hits = client.get("/api/v1/p2p/vendors/for-item", params={"store_item_id": s["a"].id}, headers=auth_header(buyer)).json()
    assert [h["vendor_name"] for h in hits] == ["Alpha Hydraulics"]


def test_item_overview_shows_every_vendor_without_typing_anything(client, db, setup):
    """Search an item → each vendor's last PO rate, last quote and current
    rate, straight from POs and quotations (no info record typed first)."""
    s = setup
    q1, q2 = _quoted_and_awarded(client, s)
    pos, _loc = _split(client, s, q1, q2)
    p_a = pos[s["v2"].id]
    client.post(f"{RFQS}/{s['rfq'].id}/po-draft/{p_a['id']}/submit", headers=auth_header(s["buyer"]))
    _decide_all(client, db, "p2p_purchase_order", p_a["id"], s["approvers"])
    # The release mirrored its rate into an info record — that is "last PO",
    # not a rate contract; setting a different rate on it makes it one.
    ov = client.get(f"{IR}/item-overview", params={"store_item_id": s["a"].id}, headers=auth_header(s["buyer"])).json()
    beta = next(v for v in ov["vendors"] if v["vendor_name"] == "Beta Steels")
    assert beta["contract"] is None and beta["record_id"] and beta["current_rate_source"] == "quote"
    client.patch(f"{IR}/{beta['record_id']}", json={"unit_price": 88}, headers=auth_header(s["admin"]))
    ov = client.get(f"{IR}/item-overview", params={"store_item_id": s["a"].id}, headers=auth_header(s["buyer"])).json()
    beta = next(v for v in ov["vendors"] if v["vendor_name"] == "Beta Steels")
    assert beta["contract"]["unit_price"] == 88 and beta["current_rate"] == 88
    # Drop the auto-made info records: the overview and the PO default price
    # must still come from the released PO itself (old POs had none).
    db.query(VendorCatalogItem).delete()
    db.commit()

    ov = client.get(f"{IR}/item-overview", params={"store_item_id": s["a"].id}, headers=auth_header(s["buyer"]))
    assert ov.status_code == 200, ov.text
    ov = ov.json()
    by = {v["vendor_name"]: v for v in ov["vendors"]}
    assert set(by) == {"Alpha Hydraulics", "Beta Steels"}
    beta, alpha = by["Beta Steels"], by["Alpha Hydraulics"]
    assert beta["last_po"]["unit_price"] == 90 and beta["last_po"]["po_number"] == p_a["po_number"] and beta["po_count"] == 1
    assert beta["last_quote"]["net_price"] == 90 and beta["last_quote"]["delivery_days"] == 7 and beta["lead_time_days"] == 7
    assert alpha["last_po"] is None and alpha["last_quote"]["net_price"] == 100 and alpha["current_rate_source"] == "quote"
    assert [v["vendor_name"] for v in ov["vendors"]] == ["Beta Steels", "Alpha Hydraulics"]  # cheapest first
    assert ov["summary"]["last_po"]["vendor_name"] == "Beta Steels" and ov["summary"]["best_current"]["rate"] == 90

    dp = client.get(f"{IR}/default-price", params={"vendor_id": s["v2"].id, "store_item_id": s["a"].id}, headers=auth_header(s["buyer"])).json()
    assert dp["unit_price"] == 90

    # A rate contract wins over the quote for "current rate".
    client.post(IR, json={"vendor_id": s["v1"].id, "store_item_id": s["a"].id, "unit_price": 85}, headers=auth_header(s["admin"]))
    ov = client.get(f"{IR}/item-overview", params={"store_item_id": s["a"].id}, headers=auth_header(s["buyer"])).json()
    assert ov["vendors"][0]["vendor_name"] == "Alpha Hydraulics" and ov["vendors"][0]["current_rate"] == 85
    assert ov["vendors"][0]["current_rate_source"] == "contract"
