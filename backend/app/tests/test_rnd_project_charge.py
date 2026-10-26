"""New development purchases are charged to an R&D project (2026-10-26): the
PR carries rnd_project_id, Finance's internal order for the project is opened
on first use (once) and also filled on the PR, so the PO inherits it."""
from datetime import date

from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.rnd.internal_order_link import ensure_internal_order_for_rnd_project
from app.modules.rnd.models.project import RndProject
from app.tests.p2p_workflow_helpers import master_item, set_pr_workflow
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _create_payload, _create_pr, _pr_approvers, _purchaser, _raise_po, _requester, _sqlite_number_series, auth_header,
)


def _project(db, number="RND-2026-0801", title="Wagon prototype", **over):
    p = RndProject(project_number=number, title=title, objective="Build it", budget_amount=250000,
                   start_date=date(2026, 11, 1), target_end_date=date(2027, 3, 31),
                   **{"lead_ids": [], "team_member_ids": [], **over})
    db.add(p)
    db.commit()
    return p


def _post(client, db, requester, item, **over):
    set_pr_workflow(db, [u.id for u in _pr_approvers(db).values()], requester)
    body = _create_payload(project_label=None, project_type=None, category_code="RAW", purpose="development",
                           items=[{"store_item_id": item.id, "quantity": 3, "project_inhouse": "Project"}])
    body.update(over)
    return client.post(BASE, json=body, headers=auth_header(requester))


def test_pr_carries_project_and_one_internal_order_is_reused(client, db):
    proj = _project(db)
    item = master_item(db, "Steel plate", code="DEV-SP-01")
    req = _requester(db, "rndcharge.req1@premnathrail.com")
    assert db.query(InternalOrder).count() == 0  # nothing until something is charged

    r1 = _post(client, db, req, item, account_assignment="rnd_project", rnd_project_id=proj.id)
    assert r1.status_code == 200, r1.text
    body = r1.json()
    assert body["rnd_project_id"] == proj.id and body["rnd_project_label"] == "RND-2026-0801 — Wagon prototype"
    assert body["account_assignment"] == "rnd_project" and body["project_type"] == "new"
    assert body["items"][0]["project_inhouse"] == "Inhouse"
    r2 = _post(client, db, req, item, account_assignment="rnd_project", rnd_project_id=proj.id)
    assert r2.status_code == 200, r2.text

    ios = db.query(InternalOrder).all()
    assert len(ios) == 1
    io = ios[0]
    assert io.code == "IO-RND-2026-0801" and io.order_type == "development" and io.status == "open"
    assert io.name == "RND-2026-0801 — Wagon prototype" and io.budgeted_amount == 250000
    assert io.start_date == date(2026, 11, 1) and io.end_date == date(2027, 3, 31)
    assert body["internal_order_id"] == io.id == r2.json()["internal_order_id"]
    db.expire_all()
    assert db.get(RndProject, proj.id).internal_order_id == io.id


def test_ensure_is_idempotent(db):
    proj = _project(db, number="RND-2026-0802")
    first = ensure_internal_order_for_rnd_project(db, proj)
    assert ensure_internal_order_for_rnd_project(db, proj) == first
    assert db.query(InternalOrder).count() == 1


def test_kind_only_for_development_and_other_purposes_unchanged(client, db):
    proj = _project(db, number="RND-2026-0803")
    item = master_item(db, "Bolt", code="DEV-BT-01")
    req = _requester(db, "rndcharge.req2@premnathrail.com")
    r = _post(client, db, req, item, purpose="capital", category_code="CAP", account_assignment="rnd_project", rnd_project_id=proj.id)
    assert r.status_code == 400 and "can't be charged to a R&D project" in r.json()["detail"], r.text
    r = _post(client, db, req, item, purpose="stock", category_code="HWC", account_assignment="rnd_project", rnd_project_id=proj.id)
    assert r.status_code == 400, r.text
    # Development with nothing picked says what to pick.
    r = _post(client, db, req, item)
    assert r.status_code == 400 and "R&D project this development belongs to" in r.json()["detail"], r.text
    # Missing id for the kind.
    r = _post(client, db, req, item, account_assignment="rnd_project")
    assert r.status_code == 422 and "pick the r&d project" in r.json()["detail"].lower(), r.text
    # An internal order is a valid alternative only if an admin allows it; by default it is refused.
    io = InternalOrder(code="DEV-1", name="Old job", order_type="capital", status="open")
    db.add(io)
    db.commit()
    r = _post(client, db, req, item, account_assignment="internal_order", internal_order_id=io.id)
    assert r.status_code == 400 and "R&D project" in r.json()["detail"], r.text
    assert db.query(P2PRequest).count() == 0


def test_closed_cancelled_handed_over_or_missing_project_refused(client, db):
    item = master_item(db, "Nut", code="DEV-NT-01")
    req = _requester(db, "rndcharge.req3@premnathrail.com")
    for n, over, word in (("0804", {"status": "cancelled"}, "cancelled"), ("0805", {"stage": "closed"}, "closed"),
                          ("0806", {"stage": "handover"}, "handed over")):
        proj = _project(db, number=f"RND-2026-{n}", **over)
        r = _post(client, db, req, item, account_assignment="rnd_project", rnd_project_id=proj.id)
        assert r.status_code == 422 and f"is {word}" in r.json()["detail"] and "Pick an open R&D project" in r.json()["detail"], r.text
    r = _post(client, db, req, item, account_assignment="rnd_project", rnd_project_id=99999)
    assert r.status_code == 422 and "no longer exists" in r.json()["detail"], r.text
    assert db.query(InternalOrder).count() == 0


def test_options_list_open_projects_id_and_label_only(client, db):
    _project(db, number="RND-2026-0807", title="Open one")
    _project(db, number="RND-2026-0808", title="Cancelled one", status="cancelled")
    _project(db, number="RND-2026-0809", title="Closed one", stage="closed")
    req = _requester(db, "rndcharge.req4@premnathrail.com")
    url = "/api/v1/p2p/account-assignment/options"
    out = client.get(url, params={"kind": "rnd_project"}, headers=auth_header(req)).json()
    assert out["kind"] == "rnd_project" and out["label"] == "R&D project"
    assert out["options"] == [{"id": out["options"][0]["id"], "label": "RND-2026-0807 — Open one"}]
    assert client.get(url, params={"kind": "rnd_project", "search": "nothing-here"}, headers=auth_header(req)).json()["options"] == []
    assert len(client.get(url, params={"kind": "rnd_project", "search": "open"}, headers=auth_header(req)).json()["options"]) == 1
    # Permission denied without the p2p app.
    from app.tests.test_p2p_requests import make_user
    outsider = make_user(db, "rndcharge.out@premnathrail.com", assigned_apps=("crm",))
    assert client.get(url, params={"kind": "rnd_project"}, headers=auth_header(outsider)).status_code == 403


def test_po_inherits_the_internal_order(client, db):
    proj = _project(db, number="RND-2026-0810")
    buyer = _purchaser(db, "rndcharge.buyer@premnathrail.com")
    req = _requester(db, "rndcharge.req5@premnathrail.com")
    pr = _create_pr(client, req, purpose="development", category_code="RAW", project_label=None, project_type=None,
                    account_assignment="rnd_project", rnd_project_id=proj.id,
                    items=[{"item_name": "Steel plate", "quantity": 2, "unit": "pcs", "project_inhouse": "Inhouse"}])
    _raise_po(client, db, pr, buyer, po_number="PO-DEV-1")
    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.po_number == "PO-DEV-1").one()
    assert po.internal_order_id == pr["internal_order_id"] and po.internal_order_id is not None


def test_draft_resubmit_refuses_project_closed_meanwhile(client, db):
    proj = _project(db, number="RND-2026-0811")
    item = master_item(db, "Pin", code="DEV-PN-01")
    req = _requester(db, "rndcharge.req6@premnathrail.com")
    r = _post(client, db, req, item, account_assignment="rnd_project", rnd_project_id=proj.id, save_as_draft=True)
    assert r.status_code == 200, r.text
    proj.stage = "closed"
    db.commit()
    r2 = client.post(f"{BASE}/{r.json()['id']}/submit", headers=auth_header(req))
    assert r2.status_code == 400 and "is closed" in r2.json()["detail"], r2.text


def test_purposes_meta_lists_rnd_project_for_development(client, db):
    req = _requester(db, "rndcharge.req7@premnathrail.com")
    meta = {p["code"]: p for p in client.get(f"{BASE}/meta", headers=auth_header(req)).json()["purposes"]}
    dev = meta["development"]
    assert list(dev["charged_to_kinds"])[:1] == ["rnd_project"]
    assert dev["charged_required"] is True


def test_budget_and_dates_sync_to_the_internal_order(client, db):
    from app.tests.test_cov_crm_quotations_rnd import auth, make_user
    from app.tests.test_rnd_requirement_work import make_rnd_head
    head = make_user(db, "rndcharge.head@premnathrail.com", apps=("rnd",))
    make_rnd_head(db, head)
    proj = _project(db, number="RND-2026-0812", lead_ids=[head.id], lead_id=head.id)
    ensure_internal_order_for_rnd_project(db, proj)
    db.commit()
    r = client.patch(f"/api/v1/rnd/projects/{proj.id}", json={"budget_amount": 400000, "target_end_date": "2027-06-30"}, headers=auth(head))
    assert r.status_code == 200, r.text
    db.expire_all()
    io = db.get(InternalOrder, db.get(RndProject, proj.id).internal_order_id)
    assert io.budgeted_amount == 400000 and io.end_date == date(2027, 6, 30)
