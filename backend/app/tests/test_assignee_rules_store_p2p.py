"""Assign-to rules (core/assignee_rules.py) on the Store and Procurement
pickers: the approving Store Manager named on a stock adjustment
(store:adjustments.approver) and on a physical count's differences
(store:adjustments.cycle_count), and the buyer of an approved requisition
(p2p:purchase_requisitions.buyer)."""
from app.modules.main.models.role import Role
from app.tests.test_cov_controls_store import API, _h, _seed_stock, _user, env  # noqa: F401 — env is a fixture
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE as PR_BASE, _approve_pr, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header,
)


def _give_role(db, user, grants, rules):
    role = Role(name=f"Role {user.email}", permissions=grants, assignee_rules=rules)
    db.add(role)
    db.commit()
    user.roles = [role]
    db.commit()
    db.refresh(user)


def _adjust(client, env, approver):
    return client.post(f"{API}/stock-adjustments", json={
        "location_id": env["loc"].id, "approved_by_id": approver.id, "reason": "Cycle count",
        "items": [{"item_id": env["item"].id, "actual_quantity": 4}],
    }, headers=_h(env["keeper"]))


def test_adjustment_approver_rule(client, db, env):
    other_manager = _user(db, "c09.manager2@premnathrail.com", is_store_manager=True)
    _give_role(db, env["keeper"], ["store:adjustments:view", "store:adjustments:create"],
               {"store:adjustments.approver": {"mode": "custom", "users": [env["manager"].id]}})
    _seed_stock(client, env, 20)

    r = _adjust(client, env, other_manager)
    assert r.status_code == 403 and "Send stock adjustments to" in r.json()["detail"]
    assert _adjust(client, env, env["manager"]).status_code == 200


def test_count_differences_approver_rule(client, db, env):
    other_manager = _user(db, "c09.manager3@premnathrail.com", is_store_manager=True)
    _give_role(db, env["keeper"], ["store:adjustments:view", "store:adjustments:create"],
               {"store:adjustments.cycle_count": {"mode": "custom", "users": [env["manager"].id]}})
    _seed_stock(client, env, 3)
    count = client.post(f"{API}/physical-counts", json={"location_id": env["loc"].id}, headers=_h(env["keeper"])).json()
    client.put(f"{API}/physical-counts/{count['id']}/counts",
               json={"lines": [{"line_id": count["items"][0]["id"], "counted_quantity": 1}]}, headers=_h(env["keeper"]))

    r = client.post(f"{API}/physical-counts/{count['id']}/submit", json={"approver_id": other_manager.id}, headers=_h(env["keeper"]))
    assert r.status_code == 403 and "Send count differences to" in r.json()["detail"]
    r = client.post(f"{API}/physical-counts/{count['id']}/submit", json={"approver_id": env["manager"].id}, headers=_h(env["keeper"]))
    assert r.status_code == 200, r.text


def test_assign_buyer_rule(client, db):
    requester = _requester(db, "ar.req@premnathrail.com")
    pr = _create_pr(client, requester)
    manager = _purchaser(db, "ar.manager@premnathrail.com")
    allowed = _purchaser(db, "ar.buyer1@premnathrail.com")
    outsider = _purchaser(db, "ar.buyer2@premnathrail.com")
    _give_role(db, manager, ["p2p:purchase_requisitions:view", "p2p:purchase_requisitions:edit"],
               {"p2p:purchase_requisitions.buyer": {"mode": "custom", "users": [allowed.id]}})
    _approve_pr(client, pr)

    r = client.post(f"{PR_BASE}/{pr['id']}/assign-buyer", json={"assigned_buyer_id": outsider.id}, headers=auth_header(manager))
    assert r.status_code == 403 and "Assign buyer to" in r.json()["detail"]
    r = client.post(f"{PR_BASE}/{pr['id']}/assign-buyer", json={"assigned_buyer_id": allowed.id}, headers=auth_header(manager))
    assert r.status_code == 200, r.text
    assert r.json()["assigned_buyer_id"] == allowed.id
