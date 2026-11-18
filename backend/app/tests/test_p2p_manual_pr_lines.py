"""Manual (typed) PR lines, 2026-11-18 — "for now" while the Item Master fills up:

  * a PR line may be typed by hand (type + category + name + technical details +
    unit) instead of picked from the Item Master; it has no store_item_id and its
    technical details ride in its name ("Name — details") so the buyer, RFQ, PO
    and GRN all show them;
  * the GRN refuses such a line until Store gives it an item code; sending the
    item on the GRN line links the PO line and the PR line, then the stock posts
    against that item as usual."""
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrderItem
from app.modules.store.models.category import StoreItemCategory
from app.modules.store.models.stock_balance import StoreStockBalance
from app.tests.p2p_workflow_helpers import master_item, set_pr_workflow
from app.tests.test_p2p_item_master_link import _po_for, _store
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _approve_and_raise_po, _create_payload, _pr_approvers, _purchaser, _requester, _sqlite_number_series, auth_header,
)
from app.tests.test_quality_phase1 import make_user

GRN = "/api/v1/p2p/goods-receipts"
_n = iter(range(1, 10_000))


def _category(db, name="Hydraulic Manual", code="HYM", item_type="material"):
    cat = db.query(StoreItemCategory).filter_by(code=code).first()
    if cat is None:
        cat = StoreItemCategory(name=name, code=code, item_type=item_type, is_active=True)
        db.add(cat)
        db.commit()
    return cat


def _manual_line(**over):
    line = {"item_name": "Socket M/F", "specification": "3/8 BSP, 350 bar", "item_type": "material",
            "category": "Hydraulic Manual", "unit": "NOS", "make": "Parker", "quantity": 4, "project_inhouse": "Project"}
    line.update(over)
    return line


def _post_pr(client, db, requester, items):
    """Raise a PR as given (no auto-linking of lines), approvers set up like _create_pr."""
    approvers = _pr_approvers(db)
    po_approvers = {role: make_user(db, f"po.{role}.man{next(_n)}@premnathrail.com", assigned_apps=("p2p",))
                    for role in ("rnd_manager", "purchase_manager", "production_manager")}
    set_pr_workflow(db, [u.id for u in approvers.values()], requester)
    return client.post(BASE, json=_create_payload(items=items), headers=auth_header(requester)), approvers, po_approvers


def test_a_typed_line_is_saved_without_an_item_code_and_keeps_its_details(client, db):
    _category(db)
    requester = _requester(db, "req.manual1@premnathrail.com")
    resp, _a, _p = _post_pr(client, db, requester, [_manual_line()])
    assert resp.status_code == 200, resp.text
    line = resp.json()["items"][0]
    assert line["store_item_id"] is None
    assert line["item_name"] == "Socket M/F — 3/8 BSP, 350 bar"
    assert line["unit"] == "NOS" and line["category"] == "Hydraulic Manual" and line["make"] == "Parker"


def test_a_typed_line_needs_category_name_and_unit(client, db):
    _category(db)
    requester = _requester(db, "req.manual2@premnathrail.com")
    for over, words in [({"category": ""}, "type the category"), ({"unit": ""}, "unit"),
                        ({"item_name": ""}, "type the item name")]:
        resp, _a, _p = _post_pr(client, db, requester, [_manual_line(**over)])
        assert resp.status_code == 422, (over, resp.text)
        assert words in resp.json()["detail"], (over, resp.json()["detail"])


def test_a_typed_line_needs_no_type_and_takes_any_typed_category(client, db):
    # 2026-11-18 (owner): no Item Type on the PR for now and the category is typed
    # by hand. A typed category matching an Item Master one (any case) takes its
    # exact name; any other text is kept as typed.
    _category(db)
    requester = _requester(db, "req.manual4@premnathrail.com")
    resp, _a, _p = _post_pr(client, db, requester, [_manual_line(item_type="", category="hydraulic manual"),
                                                    _manual_line(item_type="", category="Brand New Group")])
    assert resp.status_code == 200, resp.text
    cats = sorted(i["category"] for i in resp.json()["items"])
    assert cats == ["Brand New Group", "Hydraulic Manual"]


def test_grn_refuses_a_typed_line_until_it_gets_an_item_code_then_links_and_posts(client, db):
    _category(db)
    requester = _requester(db, "req.manual3@premnathrail.com")
    resp, approvers, po_approvers = _post_pr(client, db, requester, [_manual_line()])
    assert resp.status_code == 200, resp.text
    pr = {**resp.json(), "_approvers": approvers, "_po_approvers": po_approvers}
    buyer = _purchaser(db, "buyer.manual3@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    po = _po_for(client, buyer, pr["id"])
    assert po["items"][0]["store_item_id"] is None
    loc = _store(db, "MAN3")
    line = {"po_item_id": po["items"][0]["id"], "received_quantity": 4}

    refused = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id, "items": [line]}, headers=auth_header(buyer))
    assert refused.status_code == 409, refused.text
    assert "New item code" in refused.json()["detail"]

    # The receivable list offers the PR line's category to pre-fill the quick-add popup.
    pending = client.get(f"{GRN}/pending-purchase-orders", headers=auth_header(buyer)).json()
    row = next(p for p in pending if p["id"] == po["id"])["items"][0]
    assert row["pr_item_category"] == "Hydraulic Manual"

    item = master_item(db, "Socket M/F 3/8", code="MAN-0001", uom="NOS", item_type="material", category="Hydraulic Manual")
    db.commit()
    ok = client.post(GRN, json={"purchase_order_id": po["id"], "store_location_id": loc.id,
                                "items": [{**line, "store_item_id": item.id}]}, headers=auth_header(buyer))
    assert ok.status_code == 200, ok.text
    db.expire_all()
    assert db.get(P2PPurchaseOrderItem, po["items"][0]["id"]).store_item_id == item.id
    pr_line = db.query(P2PRequestItem).filter_by(p2p_request_id=pr["id"]).one()
    assert pr_line.store_item_id == item.id
    assert pr_line.item_name == "Socket M/F — 3/8 BSP, 350 bar"  # the typed request stays as asked
    bal = db.query(StoreStockBalance).filter_by(item_id=item.id, location_id=loc.id).one()
    assert bal.on_hand_qty == 4  # not flagged for a quality check: straight into Free stock
