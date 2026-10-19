"""Purchase Requisition drafts and editing (2026-10-13): any requester can save
a PR as a private draft; the requester can edit a PR (draft, returned, in
approval or approved) until an RFQ is raised against it — editing one in or
past approval withdraws that approval."""
from app.modules.p2p.models.rfq import RFQ
from app.tests.p2p_workflow_helpers import link_items, set_pr_workflow
from app.tests.test_p2p_requests import (  # noqa: F401 — fixture re-export
    BASE, _approve_pr, _create_payload, _create_pr, _pr_approvers, _purchaser, _requester,
    _sqlite_number_series, auth_header,
)


def _draft(client, db, requester, **overrides):
    payload = link_items(db, _create_payload(save_as_draft=True, **overrides))
    r = client.post(BASE, json=payload, headers=auth_header(requester))
    assert r.status_code == 200, r.text
    return r.json()


def _edit_payload(db, pr, **overrides):
    body = _create_payload(**overrides)
    body = link_items(db, body)
    return body


def test_draft_skips_approval_and_light_validation(client, db):
    requester = _requester(db, "draft1@premnathrail.com")
    pr = _draft(client, db, requester, project_label="", project_type=None,
                items=[{"item_name": "Hydraulic Cylinder", "quantity": 2}])
    assert pr["status"] == "draft"
    assert pr["engine_approval"] is None


def test_draft_is_private_to_requester(client, db):
    requester = _requester(db, "draft2@premnathrail.com")
    buyer = _purchaser(db, "draftbuyer2@premnathrail.com")
    pr = _draft(client, db, requester)
    assert client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer)).status_code == 403
    assert pr["id"] not in [p["id"] for p in client.get(BASE, headers=auth_header(buyer)).json()]
    assert pr["id"] in [p["id"] for p in client.get(BASE, headers=auth_header(requester)).json()]
    detail = client.get(f"{BASE}/{pr['id']}", headers=auth_header(requester)).json()
    assert detail["can_edit"] is True


def test_incomplete_draft_cannot_be_submitted(client, db):
    requester = _requester(db, "draft3@premnathrail.com")
    pr = _draft(client, db, requester, project_label="")
    r = client.post(f"{BASE}/{pr['id']}/submit", headers=auth_header(requester))
    assert r.status_code == 400
    assert "the project" in r.json()["detail"]


def test_complete_draft_submits_into_approval(client, db):
    requester = _requester(db, "draft4@premnathrail.com")
    approvers = _pr_approvers(db)
    set_pr_workflow(db, [u.id for u in approvers.values()], requester)
    pr = _draft(client, db, requester)
    r = client.post(f"{BASE}/{pr['id']}/submit", headers=auth_header(requester))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "submitted"


def test_edit_draft_and_submit(client, db):
    requester = _requester(db, "draft5@premnathrail.com")
    approvers = _pr_approvers(db)
    set_pr_workflow(db, [u.id for u in approvers.values()], requester)
    pr = _draft(client, db, requester, category_code="RAW")
    body = _edit_payload(db, pr, category_code="ELE", project_label="Project Beta")
    r = client.put(f"{BASE}/{pr['id']}", json=body, headers=auth_header(requester))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "submitted"
    assert out["project_label"] == "Project Beta"
    # A draft's category can change — it is renumbered under the new one.
    assert out["p2p_number"].startswith("P2P-ELE-")


def test_edit_submitted_pr_withdraws_and_resubmits(client, db):
    requester = _requester(db, "edit1@premnathrail.com")
    pr = _create_pr(client, requester)
    body = _edit_payload(db, pr, items=[{"item_name": "Hydraulic Cylinder", "quantity": 5, "project_inhouse": "Inhouse"}])
    body["items"][0]["id"] = pr["items"][0]["id"]
    r = client.put(f"{BASE}/{pr['id']}", json=body, headers=auth_header(requester))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "submitted"
    assert out["items"][0]["id"] == pr["items"][0]["id"]  # line updated in place
    assert out["items"][0]["quantity"] == 5


def test_edit_approved_pr_goes_back_for_approval(client, db):
    requester = _requester(db, "edit2@premnathrail.com")
    pr = _create_pr(client, requester)
    assert _approve_pr(client, pr).json()["status"] == "approved"
    set_pr_workflow(db, [u.id for u in pr["_approvers"].values()], requester)
    r = client.put(f"{BASE}/{pr['id']}", json=_edit_payload(db, pr), headers=auth_header(requester))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "submitted"
    assert r.json()["approved_at"] is None


def test_category_locked_after_submit(client, db):
    requester = _requester(db, "edit3@premnathrail.com")
    pr = _create_pr(client, requester)
    r = client.put(f"{BASE}/{pr['id']}", json=_edit_payload(db, pr, category_code="ELE"), headers=auth_header(requester))
    assert r.status_code == 400
    assert "category" in r.json()["detail"]


def test_no_edit_once_rfq_raised(client, db):
    requester = _requester(db, "edit4@premnathrail.com")
    pr = _create_pr(client, requester)
    _approve_pr(client, pr)
    db.add(RFQ(rfq_number="RFQ-T-0001", p2p_request_id=pr["id"], status="draft"))
    db.commit()
    detail = client.get(f"{BASE}/{pr['id']}", headers=auth_header(requester)).json()
    assert detail["can_edit"] is False
    assert "RFQ-T-0001" in detail["edit_block_reason"]
    r = client.put(f"{BASE}/{pr['id']}", json=_edit_payload(db, pr), headers=auth_header(requester))
    assert r.status_code == 409
    assert "RFQ-T-0001" in r.json()["detail"]


def test_other_requester_cannot_edit(client, db):
    requester = _requester(db, "edit5@premnathrail.com")
    other = _requester(db, "edit5b@premnathrail.com")
    pr = _create_pr(client, requester)
    r = client.put(f"{BASE}/{pr['id']}", json=_edit_payload(db, pr), headers=auth_header(other))
    assert r.status_code == 403


def test_discard_draft_only(client, db):
    requester = _requester(db, "discard1@premnathrail.com")
    pr = _draft(client, db, requester)
    assert client.delete(f"{BASE}/{pr['id']}", headers=auth_header(requester)).status_code == 200
    assert client.get(f"{BASE}/{pr['id']}", headers=auth_header(requester)).status_code == 404
    live = _create_pr(client, requester)
    assert client.delete(f"{BASE}/{live['id']}", headers=auth_header(requester)).status_code == 409
