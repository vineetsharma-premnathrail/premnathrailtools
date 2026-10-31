"""Per-line buyer on a purchase requisition (owner decision 2026-10-27): the PR
form has no header category; each line's Item Master item type picks that
line's buyer (Procurement > Settings > Buyer for each item type), and numbers
run P2P-[YEAR]-[NNNN]."""
import re


from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.role import Role
from app.modules.p2p.models.p2p_request import LINE_CATEGORY
from app.tests.p2p_workflow_helpers import master_item, set_pr_workflow
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _pr_approvers, _purchaser, _requester, _sqlite_number_series, auth_header, make_user,
)

NUMBER = re.compile(r"^P2P-\d{4}-\d{4}$")


def _set_buyer(db, item_type, user):
    db.add(ModuleSetting(module_key="p2p", key=f"buyer_type_{item_type}", value=user.id))
    db.commit()


def _setup(db, tag):
    """Two buyers (material -> A, service -> B), a requester, two typed items."""
    a = _purchaser(db, f"lb.a.{tag}@premnathrail.com")
    b = _purchaser(db, f"lb.b.{tag}@premnathrail.com")
    _set_buyer(db, "material", a)
    _set_buyer(db, "service", b)
    req = _requester(db, f"lb.req.{tag}@premnathrail.com")
    mat = master_item(db, f"LB steel plate {tag}", item_type="material")
    svc = master_item(db, f"LB hardening job {tag}", item_type="service")
    set_pr_workflow(db, [u.id for u in _pr_approvers(db).values()], req)
    return a, b, req, mat, svc


def _body(items, **over):
    body = {"purpose": "department", "priority": "standard", "approvers": {},
            "items": [{"store_item_id": i.id, "quantity": 2, "project_inhouse": "Inhouse"} for i in items]}
    body.update(over)
    return body


def _create(client, req, items, **over):
    return client.post(BASE, json=_body(items, **over), headers=auth_header(req))


def test_create_without_category_resolves_each_line_buyer(client, db):
    a, b, req, mat, svc = _setup(db, "t1")
    r = _create(client, req, [mat, svc])
    assert r.status_code == 200, r.text
    pr = r.json()
    assert NUMBER.match(pr["p2p_number"]), pr["p2p_number"]
    assert pr["category_code"] == LINE_CATEGORY == "ITM"
    assert [i["buyer_id"] for i in pr["items"]] == [a.id, b.id]
    assert [i["buyer_name"] for i in pr["items"]] == [a.name, b.name]
    assert pr["assigned_buyer_id"] == a.id
    assert pr["requirement_type"]  # purpose default (stock) fills it


def test_second_requisition_takes_next_number(client, db):
    a, b, req, mat, svc = _setup(db, "t2")
    n1 = _create(client, req, [mat]).json()["p2p_number"]
    n2 = _create(client, req, [svc]).json()["p2p_number"]
    assert NUMBER.match(n1) and NUMBER.match(n2)
    assert n1[:-4] == n2[:-4] and int(n2[-4:]) == int(n1[-4:]) + 1


def test_editing_a_draft_re_resolves_changed_line_only(client, db):
    a, b, req, mat, svc = _setup(db, "t3")
    r = _create(client, req, [mat, svc], save_as_draft=True)
    assert r.status_code == 200, r.text
    pr = r.json()
    assert [i["buyer_id"] for i in pr["items"]] == [a.id, b.id]
    # Line 2 changes from a service to a material; line 1 is unchanged.
    mat2 = master_item(db, "LB second plate t3", item_type="material")
    r = client.put(f"{BASE}/{pr['id']}", json=_body([mat, mat2], save_as_draft=True), headers=auth_header(req))
    assert r.status_code == 200, r.text
    assert [i["buyer_id"] for i in r.json()["items"]] == [a.id, a.id]
    # And back: line 2 to a service again goes to B, the header buyer stays line 1's.
    r = client.put(f"{BASE}/{pr['id']}", json=_body([mat, svc], save_as_draft=True), headers=auth_header(req))
    assert [i["buyer_id"] for i in r.json()["items"]] == [a.id, b.id]
    assert r.json()["assigned_buyer_id"] == a.id


def _narrow_to_assigned(db, *users, apps):
    role = Role(name=f"P2P own+assigned lb {users[0].id}", permissions=["p2p:*:*", "store:grn:*"], data_scopes={"p2p": "assigned"})
    db.add(role)
    db.commit()
    for u in users:
        u.assigned_apps = list(apps)
        u.granular_permissions = []
        u.roles = [role]
    db.commit()


def test_assigned_scope_covers_a_line_buyer_only(client, db):
    a, b, req, mat, svc = _setup(db, "t4")
    pr = _create(client, req, [mat, svc]).json()
    other = _purchaser(db, "lb.other.t4@premnathrail.com")
    _narrow_to_assigned(db, b, other, apps=("p2p", "purchase"))
    # B buys only line 2 (not the header buyer): sees it.
    r = client.get(f"{BASE}/{pr['id']}", headers=auth_header(b))
    assert r.status_code == 200, r.text
    assert pr["id"] in [p["id"] for p in client.get(BASE, headers=auth_header(b)).json()]
    # An unrelated Purchase user with the same scope does not.
    r = client.get(f"{BASE}/{pr['id']}", headers=auth_header(other))
    assert r.status_code == 403, r.text
    assert pr["id"] not in [p["id"] for p in client.get(BASE, headers=auth_header(other)).json()]


def test_line_buyer_outside_purchase_team_can_open_the_requisition(client, db):
    a, b, req, mat, svc = _setup(db, "t4b")
    pr = _create(client, req, [mat, svc]).json()
    _narrow_to_assigned(db, b, apps=("p2p",))
    assert pr["id"] in [p["id"] for p in client.get(BASE, headers=auth_header(b)).json()]
    r = client.get(f"{BASE}/{pr['id']}", headers=auth_header(b))
    assert r.status_code == 200, r.text


def test_legacy_category_requisition_keeps_old_number_and_no_line_buyer(client, db):
    a, b, req, mat, svc = _setup(db, "t5")
    r = _create(client, req, [mat], category_code="HWC")
    assert r.status_code == 200, r.text
    pr = r.json()
    assert re.match(r"^P2P-HWC-\d{4}-\d{4}$", pr["p2p_number"]), pr["p2p_number"]
    assert pr["category_code"] == "HWC"
    assert pr["items"][0]["buyer_id"] is None


def test_settings_list_buyer_for_each_item_type(client, db):
    admin = make_user(db, "lb.admin@premnathrail.com", role="admin")
    r = client.get("/api/v1/p2p/settings", headers=auth_header(admin))
    assert r.status_code == 200, r.text
    d = r.json()
    keys = {s["key"] for s in d["specs"] if s["group"] == "line_buyers"}
    assert keys == {f"buyer_type_{t}" for t in ("material", "consumable", "tool_equipment", "service", "asset", "other")}
    assert "line_buyers" in [g["key"] for g in d["groups"]]
    assert all(k in d["values"] for k in keys)


# ── Multi-buyer split (2026-10-31): every line has its own buyer once approved ──

def test_approval_gives_lines_without_a_buyer_the_main_buyer(client, db):
    from app.modules.p2p.models.p2p_request import P2PRequest

    a, b, req, mat, svc = _setup(db, "t6")
    approver = make_user(db, "lb.appr.t6@premnathrail.com", assigned_apps=("p2p",))
    set_pr_workflow(db, [approver.id], req)
    # A requisition with no category of its own and an item type that has no buyer: the line has none.
    other = master_item(db, "LB tool t6", item_type="tool_equipment")
    r = _create(client, req, [other])
    assert r.status_code == 200, r.text
    pr = r.json()
    assert pr["items"][0]["buyer_id"] is None
    row = db.get(P2PRequest, pr["id"])
    row.assigned_buyer_id = b.id  # the main buyer (what the Purchase head picks)
    db.commit()

    r = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "ok"}, headers=auth_header(approver))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"
    assert [i["buyer_id"] for i in r.json()["items"]] == [b.id]
    assert [i["buyer_name"] for i in r.json()["items"]] == [b.name]
    # New line fields exist and start empty.
    item = r.json()["items"][0]
    assert item["short_closed_qty"] == 0 and item["short_closed_reason"] is None and item["short_closed_by_name"] is None


def test_assign_buyer_works_at_any_procurement_stage_and_fills_open_lines(client, db):
    from app.modules.p2p.models.p2p_request import P2PRequest

    a, b, req, mat, svc = _setup(db, "t7")
    head = make_user(db, "lb.head.t7@premnathrail.com", assigned_apps=("purchase",))
    approver = make_user(db, "lb.appr.t7@premnathrail.com", assigned_apps=("p2p",))
    set_pr_workflow(db, [approver.id], req)
    other = master_item(db, "LB tool t7", item_type="tool_equipment")
    pr = _create(client, req, [other]).json()
    assert client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "ok"}, headers=auth_header(approver)).status_code == 200
    # The RFQ of another buyer is already out: the requisition is at vendor_quotations.
    row = db.get(P2PRequest, pr["id"])
    row.status = "vendor_quotations"
    db.commit()

    r = client.post(f"{BASE}/{pr['id']}/assign-buyer", json={"assigned_buyer_id": a.id}, headers=auth_header(head))
    assert r.status_code == 200, r.text
    assert r.json()["assigned_buyer_id"] == a.id
    assert [i["buyer_id"] for i in r.json()["items"]] == [a.id]  # the line had no buyer: it follows the main buyer
    # Not with procurement (draft / closed): refused with the way forward.
    row = db.get(P2PRequest, pr["id"])
    row.status = "closed"
    db.commit()
    r = client.post(f"{BASE}/{pr['id']}/assign-buyer", json={"assigned_buyer_id": b.id}, headers=auth_header(head))
    assert r.status_code == 409 and "with procurement" in r.json()["detail"] and "Move to another buyer" in r.json()["detail"]
