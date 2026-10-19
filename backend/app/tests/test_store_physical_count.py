"""Physical stock count (2026-10-11): freeze → count → recount → submit →
differences approved as one Stock Adjustment by a Store Manager."""
import pytest

from app.modules.store.models.physical_count import StorePhysicalCount
from app.tests.test_cov_controls_store import API, _h, _on_hand, _seed_stock, env  # noqa: F401 — env is a fixture

PC = f"{API}/physical-counts"


def _start(client, env):
    r = client.post(PC, json={"location_id": env["loc"].id}, headers=_h(env["keeper"]))
    assert r.status_code == 201, r.text
    return r.json()


def test_count_freezes_items_then_differences_post_only_after_manager_approval(client, db, env):
    _seed_stock(client, env, 20)
    count = _start(client, env)
    assert count["count_number"].startswith("PC-") and count["status"] == "counting" and count["lines_total"] == 1
    line = count["items"][0]

    # Frozen: no movement for the counted item at this store while counting.
    with pytest.raises(ValueError, match="being physically counted"):
        _seed_stock(client, env, 1)
    db.rollback()
    # Any document posting (here a Material Issue) is refused the same way.
    moved = client.post(f"{API}/material-issues", json={
        "location_id": env["loc"].id, "issue_type": "production", "items": [{"item_id": env["item"].id, "quantity": 1}],
    }, headers=_h(env["keeper"]))
    assert moved.status_code in (409, 422) and "being physically counted" in moved.json()["detail"], moved.text

    # Can't submit with uncounted lines.
    early = client.post(f"{PC}/{count['id']}/submit", json={"approver_id": env["manager"].id}, headers=_h(env["keeper"]))
    assert early.status_code == 422 and "aren't counted yet" in early.json()["detail"]

    # First count 17, recount 18 — the first count is kept.
    client.put(f"{PC}/{count['id']}/counts", json={"lines": [{"line_id": line["id"], "counted_quantity": 17}]}, headers=_h(env["keeper"]))
    r = client.put(f"{PC}/{count['id']}/counts", json={"lines": [{"line_id": line["id"], "counted_quantity": 18, "remarks": "Recounted rack B"}]},
                   headers=_h(env["keeper"]))
    got = r.json()["items"][0]
    assert (got["first_counted_quantity"], got["counted_quantity"], got["count_rounds"]) == (17, 18, 2)

    sub = client.post(f"{PC}/{count['id']}/submit", json={"approver_id": env["manager"].id}, headers=_h(env["keeper"]))
    assert sub.status_code == 200, sub.text
    body = sub.json()
    assert body["status"] == "submitted" and body["adjustment_number"]
    assert _on_hand(db, env) == 20  # nothing posted before approval

    ok = client.post(f"{API}/stock-adjustments/{body['adjustment_id']}/approve", headers=_h(env["manager"]))
    assert ok.status_code == 200, ok.text
    assert _on_hand(db, env) == 18
    db.expire_all()
    assert db.get(StorePhysicalCount, count["id"]).status == "posted"


def test_count_without_differences_closes_at_once_and_cancel_lifts_freeze(client, db, env):
    _seed_stock(client, env, 5)
    count = _start(client, env)
    client.put(f"{PC}/{count['id']}/counts", json={"lines": [{"line_id": count["items"][0]["id"], "counted_quantity": 5}]},
               headers=_h(env["keeper"]))
    done = client.post(f"{PC}/{count['id']}/submit", json={"approver_id": env["manager"].id}, headers=_h(env["keeper"]))
    assert done.status_code == 200 and done.json()["status"] == "posted" and done.json()["adjustment_id"] is None

    second = _start(client, env)
    dup = client.post(PC, json={"location_id": env["loc"].id}, headers=_h(env["keeper"]))
    assert dup.status_code == 409 and second["count_number"] in dup.json()["detail"]
    no_reason = client.post(f"{PC}/{second['id']}/cancel", json={"reason": " "}, headers=_h(env["keeper"]))
    assert no_reason.status_code == 422
    cancelled = client.post(f"{PC}/{second['id']}/cancel", json={"reason": "Started on the wrong store"}, headers=_h(env["keeper"]))
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    _seed_stock(client, env, 1)  # freeze lifted
    assert _on_hand(db, env) == 6


def test_submit_needs_a_store_manager_other_than_yourself(client, db, env):
    _seed_stock(client, env, 3)
    count = _start(client, env)
    client.put(f"{PC}/{count['id']}/counts", json={"lines": [{"line_id": count["items"][0]["id"], "counted_quantity": 1}]},
               headers=_h(env["keeper"]))
    own = client.post(f"{PC}/{count['id']}/submit", json={"approver_id": env["keeper"].id}, headers=_h(env["keeper"]))
    assert own.status_code == 400
    clerk = client.post(f"{PC}/{count['id']}/submit", json={"approver_id": env["clerk"].id}, headers=_h(env["keeper"]))
    assert clerk.status_code == 400 and "Store Manager" in clerk.json()["detail"]
