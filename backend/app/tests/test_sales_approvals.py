"""
Sales on the central authorization framework: orders and amendments routed by
the approval engine (default stages = the old Sales Head → Director → Partner
chain by value or non-standard terms), four-eyes (creator / submitter / sales
owner excluded, one person per stage), decisions through the central
/approvals endpoints (ApprovalPanel), legacy in-flight orders finishing on the
old chain, the old amount-limit settings moving into the workflow, and the
Sales data scope.
"""
from datetime import datetime, timedelta, timezone

from app.modules.crm.models.inquiry import Inquiry, Quotation, QuotationLineItem
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.organization.models.approval import ApprovalWorkflow
from app.modules.organization.services import approval_engine as engine
from app.modules.sales import approvals as sap
from app.modules.sales.models.approval import SalesApproval
from app.modules.sales.models.order import SalesOrder
from app.tests.test_sales import (
    BASE, TODAY, attach_po, confirm, create_order, hdr, make_user, payload_from_prefill, setup_customer, setup_people,
)

APPROVALS = "/api/v1/approvals"


def _inquiry(db, org, price, n):
    """Another won inquiry of the same customer, quoted at `price` per vehicle (1 vehicle)."""
    inq = Inquiry(universal_id=f"INQ-A-{n:02d}", org_id=org.id, product="RRV-10T", quantity=1, current_stage="Order Received")
    db.add(inq)
    db.commit()
    q = Quotation(inquiry_id=inq.id, quot_number=f"QT-A-{n:02d}", customer_response="Accepted", status="accepted", created_at=datetime.now(timezone.utc))
    db.add(q)
    db.commit()
    db.add(QuotationLineItem(quotation_id=q.id, description="RRV 10T", model_number="RRV-10T", quantity=1, unit_price=price, gst_percent=18))
    db.commit()
    return inq


def _submitted(client, db, maker, inq, **over):
    so = create_order(client, db, maker, inq, **over)
    attach_po(db, so["id"])
    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 200, r.text
    return r.json()


def _stages(db, so_id, entity="sales_order"):
    return [s.stage_name for s in engine.latest_request(db, entity, so_id).steps]


def _decide(client, user, so_id, decision="approve", comment=None, entity="sales_order"):
    req = client.get(f"{APPROVALS}/entity/{entity}/{so_id}", headers=hdr(user)).json()["current"]
    return client.post(f"{APPROVALS}/requests/{req['id']}/decide", json={"decision": decision, "comment": comment}, headers=hdr(user))


def test_amount_limits_pick_the_stages(client, db):
    maker, head, director, partner = setup_people(db, partner=True)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)  # ₹11.8 L
    small = _submitted(client, db, maker, inq)
    assert small["approval_via_engine"] and _stages(db, small["id"]) == ["Sales Head"]

    inq2 = _inquiry(db, _org, 5000000, 2)  # ₹59 L > ₹50 L
    mid = _submitted(client, db, maker, inq2, customer_po_number="PO-MID")
    assert _stages(db, mid["id"]) == ["Sales Head", "Director"]

    inq3 = _inquiry(db, _org, 20000000, 3)  # ₹2.36 Cr > ₹2 Cr
    big = _submitted(client, db, maker, inq3, customer_po_number="PO-BIG")
    assert _stages(db, big["id"]) == ["Sales Head", "Director", "Partner"]

    # Decided through the central endpoints (what ApprovalPanel calls).
    assert _decide(client, partner, big["id"]).status_code == 403  # not their stage yet
    for u in (head, director, partner):
        r = _decide(client, u, big["id"])
        assert r.status_code == 200, r.text
    so = client.get(f"{BASE}/orders/{big['id']}", headers=hdr(maker)).json()
    assert so["status"] == "confirmed" and so["so_number"].startswith("SO/") and so["confirmed_by_id"] == partner.id


def test_four_eyes_creator_owner_and_distinct_people(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    # The Sales Head owns the order → they are excluded; nobody else can take the stage.
    so = create_order(client, db, maker, inq, sales_owner_id=head.id)
    attach_po(db, so["id"])
    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 422 and any("Sales Head" in m for m in r.json()["detail"])
    assert db.get(SalesOrder, so["id"]).status == "draft"

    # One person holding both Sales Head and Director can't approve both stages.
    db.get(SalesOrder, so["id"]).sales_owner_id = maker.id
    head.is_director = True
    director.is_director = False
    db.commit()
    inq2 = _inquiry(db, _org, 5000000, 2)
    so2 = create_order(client, db, maker, inq2, customer_po_number="PO-2")
    attach_po(db, so2["id"])
    r = client.post(f"{BASE}/orders/{so2['id']}/submit", headers=hdr(maker))
    assert r.status_code == 422 and any("different people" in m for m in r.json()["detail"])

    # The submitter can never decide their own order.
    director.is_director = True
    db.commit()
    r = client.post(f"{BASE}/orders/{so2['id']}/submit", headers=hdr(maker))
    assert r.status_code == 200, r.text
    assert _decide(client, maker, so2["id"]).status_code == 403
    assert _decide(client, head, so2["id"]).status_code == 200
    r = _decide(client, head, so2["id"])
    assert r.status_code == 403  # already approved the Sales Head stage
    assert _decide(client, director, so2["id"]).status_code == 200
    assert db.get(SalesOrder, so2["id"]).status == "confirmed"


def test_return_resubmit_and_withdraw(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = _submitted(client, db, maker, inq)
    assert _decide(client, head, so["id"], "return").status_code == 422  # a return needs a comment
    assert _decide(client, head, so["id"], "return", "Attach the LOA").status_code == 200
    detail = client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker)).json()
    assert detail["status"] == "draft" and detail["return_comment"] == "Attach the LOA"

    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 200 and engine.latest_request(db, "sales_order", so["id"]).revision == 2
    req = engine.latest_request(db, "sales_order", so["id"])
    r = client.post(f"{APPROVALS}/requests/{req.id}/cancel", json={"reason": "Customer revising PO"}, headers=hdr(maker))
    assert r.status_code == 200
    assert db.get(SalesOrder, so["id"]).status == "draft"

    # Reject through the engine cancels the order and its delivery rows.
    client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert _decide(client, head, so["id"], "reject", "Price below cost").status_code == 200
    db.expire_all()
    so_row = db.get(SalesOrder, so["id"])
    assert so_row.status == "cancelled" and "Price below cost" in so_row.cancel_reason
    assert all(r.status == "cancelled" for r in so_row.schedules)


def test_cancelling_a_pending_order_withdraws_its_request(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = _submitted(client, db, maker, inq)
    r = client.post(f"{BASE}/orders/{so['id']}/cancel", json={"reason": "Customer withdrew the PO"}, headers=hdr(maker))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert engine.latest_request(db, "sales_order", so["id"]).status == "cancelled"


def test_amendment_through_engine(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    body = payload_from_prefill(client, hdr(maker), inq)
    so = confirm(client, db, client.post(f"{BASE}/orders", json=body, headers=hdr(maker)).json(), maker, head, director)
    r = client.post(f"{BASE}/orders/{so['id']}/amendments", json={"reason": "Customer adds 9 vehicles"}, headers=hdr(maker))
    a = r.json()
    lines = a["proposed"]["lines"]
    lines[0]["quantity"] = 10  # +₹1.06 Cr → Director too
    sched = a["proposed"]["schedule"] + [{"line_number": 1, "quantity": 1, "contract_delivery_date": str(TODAY + timedelta(days=200 + i))}
                                         for i in range(9)]
    r = client.patch(f"{BASE}/amendments/{a['id']}", json={"lines": lines, "schedule": sched}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    r = client.post(f"{BASE}/amendments/{a['id']}/submit", headers=hdr(maker))
    assert r.status_code == 200, r.text
    assert _stages(db, a["id"], "sales_amendment") == ["Sales Head", "Director"]
    assert _decide(client, head, a["id"], entity="sales_amendment").status_code == 200
    assert _decide(client, director, a["id"], entity="sales_amendment").status_code == 200
    detail = client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker)).json()
    assert detail["amendment_no"] == 1 and detail["lines"][0]["quantity"] == 10


def test_legacy_in_flight_order_finishes_on_old_chain(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = create_order(client, db, maker, inq)
    attach_po(db, so["id"])
    row = db.get(SalesOrder, so["id"])  # submitted before the move: no engine request
    row.status, row.required_approval_level, row.approval_round = "pending_approval", "sales_head", 1
    row.submitted_by_id = maker.id
    db.commit()
    detail = client.get(f"{BASE}/orders/{so['id']}", headers=hdr(head)).json()
    assert detail["approval_via_engine"] is False and detail["next_approval_level"] == "sales_head" and detail["can"]["approve"]
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    assert db.query(SalesApproval).filter(SalesApproval.entity_id == so["id"]).count() == 1
    assert engine.latest_request(db, "sales_order", so["id"]) is None


def test_old_limit_settings_move_into_the_workflow(client, db):
    maker, head, director, _ = setup_people(db)
    db.add(ModuleSetting(module_key="sales", key="approval_limit_sales_head", value=100000))
    db.commit()
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)  # ₹11.8 L > the custom ₹1 L limit
    so = _submitted(client, db, maker, inq)
    assert _stages(db, so["id"]) == ["Sales Head", "Director"]
    assert db.query(ModuleSetting).filter(ModuleSetting.key == "approval_limit_sales_head").count() == 0
    wf = db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == sap.ORDER_KEY).one()
    director_stage = next(s for s in wf.stages if s.name == "Director")
    assert director_stage.conditions == [{"field": "amount", "op": "gt", "value": 100000.0}]
    partner_stage = next(s for s in wf.stages if s.name == "Partner")
    assert partner_stage.conditions[0]["value"] == sap.DEFAULT_LIMIT_DIRECTOR


def test_sales_data_scope(client, db):
    maker, head, director, _ = setup_people(db)
    other = make_user(db, "other.rep@premnathrail.com")
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    mine = create_order(client, db, maker, inq)
    inq2 = _inquiry(db, _org, 1000000, 2)
    theirs = create_order(client, db, other, inq2, customer_po_number="PO-OTHER")
    maker.data_access_scopes = {"sales": "own"}
    head.data_access_scopes = {"sales": "own"}
    db.commit()

    ids = [o["id"] for o in client.get(f"{BASE}/orders", headers=hdr(maker)).json()]
    assert ids == [mine["id"]]
    r = client.get(f"{BASE}/orders/{theirs['id']}", headers=hdr(maker))
    assert r.status_code == 403 and "Own records" in r.json()["detail"]
    assert client.get(f"{BASE}/orders/{theirs['id']}/amendments", headers=hdr(maker)).status_code == 403
    assert client.get(f"{BASE}/attachments", params={"entity_type": "sales_order", "entity_id": theirs["id"]},
                      headers=hdr(maker)).status_code == 403

    # The Sales Head with an "own" scope still sees the order they must approve.
    attach_po(db, mine["id"])
    client.post(f"{BASE}/orders/{mine['id']}/submit", headers=hdr(maker))
    assert client.get(f"{BASE}/orders/{mine['id']}", headers=hdr(head)).status_code == 200
    assert [o["id"] for o in client.get(f"{BASE}/orders", headers=hdr(head)).json()] == [mine["id"]]
    dash = client.get(f"{BASE}/dashboard", headers=hdr(head)).json()
    assert [a["id"] for a in dash["approvals_waiting_for_me"]] == [mine["id"]]
    assert dash["approvals_waiting_for_me"][0]["stage"] == "Sales Head"
