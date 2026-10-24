"""PO tracking (2026-10-24): one true lifecycle stage per PO (a PO sent for
approval is "issued" in its own status but is not an order yet), server-side
filters / paging with real totals, one row per split PO, and the daily overdue
reminder that only chases released POs with a balance on an open requisition."""
from datetime import date, timedelta

import pytest

from app.core.record_ref import decode_ref
from app.modules.main.models.notification import Notification
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.po_tracking import OPEN_STAGES, STAGES, stage_of
from app.modules.p2p.routes.po_reports import open_items
from app.tasks import po_overdue_reminders
from app.tests.test_mm_po_split_amend_quotes import (  # noqa: F401 — fixtures / helpers
    RFQS, _decide_all, _quoted_and_awarded, _split, setup,
)
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _approve_and_raise_po, _approve_po_as, _create_pr, _purchaser, _raise_po, _receive, _requester, _sqlite_number_series, auth_header,
)

REPORTS = "/api/v1/p2p/po-reports"
LONG_AGO = date.today() - timedelta(days=10)


@pytest.fixture(autouse=True)
def _no_outbound(monkeypatch):
    async def _no_mail(*a, **k):
        return True
    monkeypatch.setattr(po_overdue_reminders, "send_po_overdue_email", _no_mail)


def _tracking(client, user, **params):
    r = client.get(f"{REPORTS}/tracking", params=params, headers=auth_header(user))
    assert r.status_code == 200, r.text
    return r.json()


def _row(client, user, po_number):
    return next(r for r in _tracking(client, user, search=po_number)["rows"] if r["po_number"] == po_number)


def _overdue(db, po_number, days=10):
    po = db.query(P2PPurchaseOrder).filter_by(po_number=po_number).one()
    po.expected_delivery = date.today() - timedelta(days=days)
    db.commit()
    return po


def _reminders(db):
    db.expire_all()
    po_overdue_reminders._send_po_overdue_reminders(db)
    return db.query(Notification).filter(Notification.notification_type == po_overdue_reminders.OVERDUE).all()


# ── the stage rule ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("po_status,released,pr_status,stage", [
    ("draft", False, "po_drafted", "draft"),
    ("issued", False, "po_raised", "in_approval"),          # sent for approval: status says issued, it is not released
    ("issued", True, "po_approved", "with_vendor"),
    ("acknowledged", True, "po_approved", "with_vendor"),
    ("partially_fulfilled", True, "partially_received", "partly_received"),
    ("fulfilled", True, "received", "received"),
    ("fulfilled", True, "closed", "closed"),
    ("partially_fulfilled", True, "closed", "short_closed"),  # the requisition is what gets short-closed
    ("issued", True, "closed", "short_closed"),
    ("cancelled", False, "cancelled", "cancelled"),
    ("issued", True, None, "with_vendor"),
])
def test_stage_rule(po_status, released, pr_status, stage):
    assert stage_of(po_status, released, pr_status) == stage
    assert stage in STAGES


def test_only_released_unfinished_stages_are_open():
    assert OPEN_STAGES == ("with_vendor", "partly_received")


# ── tracking over real POs ──────────────────────────────────────────────────

def test_po_in_approval_is_not_overdue_and_not_reminded_until_released(client, db):
    requester = _requester(db, "trk.req1@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "trk.buyer1@premnathrail.com")
    _raise_po(client, db, pr, buyer)
    po = _overdue(db, "PO-REC")
    assert po.status == "issued"

    row = _row(client, buyer, po.po_number)
    assert row["stage"] == "in_approval" and row["is_overdue"] is False and row["days_to_due"] is None
    data = _tracking(client, buyer)
    assert data["counts"]["in_approval"] == 1 and data["overdue"] == 0 and data["open_value"] == 0
    assert _reminders(db) == []

    for approver in pr["_po_approvers"].values():
        assert _approve_po_as(client, pr, approver).status_code == 200
    row = _row(client, buyer, po.po_number)
    assert row["stage"] == "with_vendor" and row["is_overdue"] is True and row["days_to_due"] == -10
    assert _tracking(client, buyer)["overdue"] == 1 and _tracking(client, buyer)["open_value"] > 0
    sent = _reminders(db)
    assert [n.entity_id for n in sent] == [po.id]
    # Same day, second run: no second reminder.
    assert len(_reminders(db)) == 1


def test_partly_received_shows_progress_and_short_close_drops_out_of_open_and_reminders(client, db):
    requester = _requester(db, "trk.req2@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 10, "unit": "mtr", "project_inhouse": "Project"}])
    buyer = _purchaser(db, "trk.buyer2@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    assert _receive(client, pr["id"], buyer, 4).status_code == 200
    po = db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).one()
    _overdue(db, po.po_number, days=3)

    row = _row(client, buyer, po.po_number)
    assert row["stage"] == "partly_received" and row["received_pct"] == 40.0
    assert (row["ordered_qty"], row["delivered_qty"], row["unit"]) == (10, 4, "mtr")
    assert row["is_overdue"] and row["days_to_due"] == -3 and row["open_value"] == pytest.approx(600.0)
    assert row["p2p_number"] == pr["p2p_number"] and row["buyer_id"] == buyer.id
    assert len(_reminders(db)) == 1
    assert [r["po_number"] for r in open_items(db)] == [po.po_number]

    # Short-close the requisition: the balance is written off.
    closed = client.post(f"{BASE}/{pr['id']}/close", json={"reason": "Vendor discontinued the item"}, headers=auth_header(buyer))
    assert closed.status_code == 200, closed.text
    db.query(Notification).delete()
    db.commit()
    row = _row(client, buyer, po.po_number)
    assert row["stage"] == "short_closed" and row["is_overdue"] is False and row["days_to_due"] is None and row["open_value"] == 0
    data = _tracking(client, buyer)
    assert data["overdue"] == 0 and data["open_value"] == 0 and data["counts"]["short_closed"] == 1
    assert _reminders(db) == []
    assert open_items(db) == []
    line = open_items(db, open_only=False)[0]
    assert line["po_stage"] == "short_closed" and line["open_qty"] == 0 and line["open_value"] == 0 and line["short_closed_qty"] == 6
    assert client.get(f"{REPORTS}/open-items", params={"po_number": po.po_number}, headers=auth_header(buyer)).json()["total_open_value"] == 0


def test_received_and_closed_stages_and_cancelled_never_reminded(client, db):
    requester = _requester(db, "trk.req3@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Gasket", "quantity": 5, "unit": "nos", "project_inhouse": "Project"}])
    buyer = _purchaser(db, "trk.buyer3@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    assert _receive(client, pr["id"], buyer, 5).status_code == 200
    po = db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).one()
    _overdue(db, po.po_number)
    assert _row(client, buyer, po.po_number)["stage"] == "received"
    assert _reminders(db) == []
    assert client.post(f"{BASE}/{pr['id']}/close", headers=auth_header(buyer)).status_code == 200
    row = _row(client, buyer, po.po_number)
    assert row["stage"] == "closed" and row["received_pct"] == 100.0 and not row["is_overdue"]


def test_filters_sort_and_paging_are_server_side_with_real_totals(client, db):
    buyer = _purchaser(db, "trk.buyer4@premnathrail.com")
    for i in range(3):
        pr = _create_pr(client, _requester(db, f"trk.req4{i}@premnathrail.com"))
        _raise_po(client, db, pr, buyer, po_number=f"PO-T-{i + 1:03d}")
        if i < 2:  # the third stays in approval
            for approver in pr["_po_approvers"].values():
                assert _approve_po_as(client, pr, approver).status_code == 200
    for n, po in enumerate(db.query(P2PPurchaseOrder).order_by(P2PPurchaseOrder.id).all()):
        po.expected_delivery = date.today() + timedelta(days=[-5, 3, 20][n])
    db.commit()

    page = _tracking(client, buyer, limit=2)
    assert page["total"] == 3 and len(page["rows"]) == 2 and [r["po_number"] for r in page["rows"]] == ["PO-T-001", "PO-T-002"]
    assert _tracking(client, buyer, limit=2, skip=2)["rows"][0]["po_number"] == "PO-T-003"
    assert _tracking(client, buyer, limit=2, desc=True)["rows"][0]["po_number"] == "PO-T-003"
    by_stage = _tracking(client, buyer, stage="in_approval")
    assert by_stage["total"] == 1 and by_stage["counts"]["with_vendor"] == 2 and by_stage["all"] == 3
    assert [r["po_number"] for r in _tracking(client, buyer, overdue_only=True)["rows"]] == ["PO-T-001"]
    soon = _tracking(client, buyer, due_soon_only=True)
    assert [r["po_number"] for r in soon["rows"]] == ["PO-T-002"] and soon["rows"][0]["is_due_soon"]
    assert [r["po_number"] for r in _tracking(client, buyer, sort="urgency")["rows"]][:2] == ["PO-T-001", "PO-T-002"]
    assert _tracking(client, buyer, search="PO-T-002")["total"] == 1
    assert _tracking(client, buyer, search="no such thing")["total"] == 0
    assert _tracking(client, buyer, buyer_id=buyer.id)["total"] == 3
    assert _tracking(client, buyer, date_from=(date.today() + timedelta(days=1)).isoformat())["total"] == 0
    assert client.get(f"{REPORTS}/tracking", params={"stage": "bogus"}, headers=auth_header(buyer)).status_code == 422
    assert client.get(f"{REPORTS}/tracking", params={"sort": "bogus"}, headers=auth_header(buyer)).status_code == 422
    assert client.get(f"{REPORTS}/tracking", params={"date_from": "31-02-2026"}, headers=auth_header(buyer)).status_code == 422
    opts = client.get(f"{REPORTS}/tracking/filters", headers=auth_header(buyer)).json()
    assert [b["id"] for b in opts["buyers"]] == [buyer.id]


def test_tracking_needs_the_purchase_team(client, db):
    outsider = _requester(db, "trk.req5@premnathrail.com")
    assert client.get(f"{REPORTS}/tracking", headers=auth_header(outsider)).status_code == 403


def test_split_pos_are_separate_rows_with_their_own_vendor_stage_and_value(client, db, setup):  # noqa: F811
    s = setup
    q1, q2 = _quoted_and_awarded(client, s)
    pos, _loc = _split(client, s, q1, q2)
    p_a, p_b = pos[s["v2"].id], pos[s["v1"].id]
    for p in (p_a, p_b):
        assert client.post(f"{RFQS}/{s['rfq'].id}/po-draft/{p['id']}/submit", headers=auth_header(s["buyer"])).status_code == 200
    _decide_all(client, db, "p2p_purchase_order", p_a["id"], s["approvers"])
    db.expire_all()
    for po in db.query(P2PPurchaseOrder).all():
        po.expected_delivery = LONG_AGO
    db.commit()

    data = _tracking(client, s["buyer"])
    rows = {r["po_id"]: r for r in data["rows"]}
    assert set(rows) == {p_a["id"], p_b["id"]}
    a, b = rows[p_a["id"]], rows[p_b["id"]]
    assert (a["vendor_name"], a["stage"]) == ("Beta Steels", "with_vendor") and a["is_overdue"]
    assert (b["vendor_name"], b["stage"]) == ("Alpha Hydraulics", "in_approval") and not b["is_overdue"]
    assert a["p2p_request_id"] == b["p2p_request_id"] and a["total_value"] != b["total_value"]
    # Each row carries its own signed link (the frontend asks for them with X-Record-Refs).
    signed = client.get(f"{REPORTS}/tracking", headers={**auth_header(s["buyer"]), "X-Record-Refs": "1"}).json()["rows"]
    refs = {r["po_id"]: r["po_id_ref"] for r in signed}
    assert refs[p_a["id"]] != refs[p_b["id"]] and decode_ref(refs[p_a["id"]]) == p_a["id"]
    assert data["counts"]["with_vendor"] == 1 and data["counts"]["in_approval"] == 1 and data["overdue"] == 1
    # Only the released PO is chased.
    assert [n.entity_id for n in _reminders(db)] == [p_a["id"]]
    assert {r["po_id"] for r in open_items(db)} == {p_a["id"]}
