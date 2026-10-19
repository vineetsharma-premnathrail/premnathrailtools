"""Design review fixes, round 2 (2026-10-07): an approved ECN can't be
cancelled while revisions under it are still in flight, a cancelled
ECR-derived ECN can be replaced, and customer submissions stay hidden from
non-team viewers (document detail, reports, awaiting-customer lookup)."""
from datetime import date

import pytest

from app.tests.test_cov_design_support import (
    API, auth, create_doc, fake_sharepoint, make_team, make_user, release, released_doc, rev, set_team, to_approval, upload,
)

pytestmark = pytest.mark.usefixtures("fake_sharepoint")


@pytest.fixture
def team(db):
    t = make_team(db)
    t["prod"] = make_user(db, "fix2.prod@premnathrail.com", apps=("design", "production"))
    return t


def _set_board(client, team):
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head", "other": "designer"})


def _approved_direct_ecn(client, team, doc):
    ecn = client.post(f"{API}/change-notices", json={
        "title": "Gusset", "documents": [{"document_id": doc["id"]}], "approver_id": team["approver"].id,
    }, headers=auth(team["other"])).json()
    assert client.post(f"{API}/change-notices/{ecn['id']}/submit", headers=auth(team["other"])).status_code == 200
    r = client.post(f"{API}/change-notices/{ecn['id']}/approve", json={}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    return r.json()


def _approved_ecr(client, team, items):
    r = client.post(f"{API}/change-requests", json={
        "title": "Hole misaligned", "source": "production", "reason": "Bolt holes 2 mm off",
        "proposed_change": "Move holes", "items": items,
    }, headers=auth(team["prod"]))
    assert r.status_code == 201, r.text
    ecr = r.json()
    r = client.post(f"{API}/change-requests/{ecr['id']}/impact",
                    json={"impact_summary": "Two frames in WIP", "board_member_ids": [team["prod"].id]}, headers=auth(team["author"]))
    assert r.status_code == 200, r.text
    assert client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "approve"}, headers=auth(team["prod"])).status_code == 200
    r = client.post(f"{API}/change-requests/{ecr['id']}/decide", json={"decision": "approved"}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# 1. In-flight revisions block cancelling an approved ECN
# ---------------------------------------------------------------------------

def test_approved_ecn_cannot_be_cancelled_while_revision_in_review(client, team):
    doc = released_doc(client, team)
    ecn = _approved_direct_ecn(client, team, doc)
    d = client.post(f"{API}/documents/{doc['id']}/revisions", json={
        "change_summary": "Per ECN", "ecn_id": ecn["id"], "reviewer_id": team["checker"].id, "approver_id": team["approver"].id,
    }, headers=auth(team["author"])).json()
    r1 = rev(d, "R1")["id"]
    assert upload(client, team["author"], r1).status_code == 200
    assert client.post(f"{API}/revisions/{r1}/submit", json={}, headers=auth(team["author"])).status_code == 200

    detail = client.get(f"{API}/change-notices/{ecn['id']}", headers=auth(team["other"])).json()
    assert "cancel" not in detail["allowed_actions"]
    r = client.post(f"{API}/change-notices/{ecn['id']}/cancel", json={"reason": "Changed mind"}, headers=auth(team["other"]))
    assert r.status_code == 409, r.text
    assert f"{doc['doc_number']} R1 is in review" in r.json()["detail"] and "Recall" in r.json()["detail"]

    # The ECN stays approved, so the revision still releases under a live ECN.
    r = client.post(f"{API}/revisions/{r1}/review", json={"decision": "pass"}, headers=auth(team["checker"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/change-notices/{ecn['id']}/cancel", json={"reason": "Changed mind"}, headers=auth(team["other"]))
    assert r.status_code == 409 and "R1 is awaiting approval" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{r1}/approve", json={"decision": "pass"}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    assert client.get(f"{API}/change-notices/{ecn['id']}", headers=auth(team["other"])).json()["status"] in ("approved", "implemented")


def test_recalled_revision_unblocks_ecn_cancel(client, team):
    doc = released_doc(client, team)
    ecn = _approved_direct_ecn(client, team, doc)
    d = client.post(f"{API}/documents/{doc['id']}/revisions", json={
        "change_summary": "Per ECN", "ecn_id": ecn["id"], "reviewer_id": team["checker"].id, "approver_id": team["approver"].id,
    }, headers=auth(team["author"])).json()
    r1 = rev(d, "R1")["id"]
    to_approval(client, team, r1)
    r = client.post(f"{API}/change-notices/{ecn['id']}/cancel", json={"reason": "Drawing withdrawn"}, headers=auth(team["other"]))
    assert r.status_code == 409
    assert client.post(f"{API}/revisions/{r1}/recall", json={"comment": "ECN dropped"}, headers=auth(team["author"])).status_code == 200
    r = client.post(f"{API}/change-notices/{ecn['id']}/cancel", json={"reason": "Drawing withdrawn"}, headers=auth(team["other"]))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    # A draft can't be pushed back into review under the cancelled ECN.
    r = client.post(f"{API}/revisions/{r1}/submit", json={}, headers=auth(team["author"]))
    assert r.status_code in (400, 409)


# ---------------------------------------------------------------------------
# 2. A cancelled ECR-derived ECN can be replaced
# ---------------------------------------------------------------------------

def test_cancelled_ecn_from_ecr_can_be_replaced(client, team):
    _set_board(client, team)
    doc = released_doc(client, team)
    ecr = _approved_ecr(client, team, [{"document_id": doc["id"], "note": "Move holes"}])
    first = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={}, headers=auth(team["approver"]))
    assert first.status_code == 200, first.text
    first = first.json()

    r = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={}, headers=auth(team["approver"]))
    assert r.status_code == 409 and f"cancel {first['ecn_number']} first" in r.json()["detail"]

    r = client.post(f"{API}/change-notices/{first['id']}/cancel", json={"reason": "Wrong effectivity"}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    detail = client.get(f"{API}/change-requests/{ecr['id']}", headers=auth(team["approver"])).json()
    assert detail["ecn_id"] is None and "create_ecn" in detail["allowed_actions"]

    second = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={}, headers=auth(team["approver"]))
    assert second.status_code == 200, second.text
    detail = client.get(f"{API}/change-requests/{ecr['id']}", headers=auth(team["approver"])).json()
    assert detail["ecn_id"] == second.json()["id"] and "create_ecn" not in detail["allowed_actions"]


# ---------------------------------------------------------------------------
# 3. Customer submissions are Design-team only
# ---------------------------------------------------------------------------

def test_viewers_get_no_customer_submission_data(client, team):
    doc = create_doc(client, team, customer_approval_required=True)
    r0 = rev(doc, "R0")["id"]
    release(client, team, r0)  # internal approval → waiting on the customer
    _set_board(client, team)
    viewer, member = auth(team["prod"]), auth(team["author"])

    assert client.get(f"{API}/lookups/awaiting-customer", headers=viewer).json() == []
    assert any(o["id"] == r0 for o in client.get(f"{API}/lookups/awaiting-customer", headers=member).json())

    h = auth(team["admin"])
    sub = client.post(f"{API}/submissions", json={"customer_name": "RDSO", "lines": [{"revision_id": r0}]}, headers=h).json()
    sent = client.post(f"{API}/submissions/{sub['id']}/send", json={}, headers=h).json()
    r = client.post(f"{API}/submissions/{sub['id']}/response", json={
        "response_date": date.today().isoformat(), "lines": [{"line_id": sent["lines"][0]["id"], "response": "approved"}],
    }, headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/revisions/{r0}/release", json={}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text

    r = client.get(f"{API}/reports/customer-approvals", headers=viewer)
    assert r.status_code == 403 and "customer approval turnaround" in r.json()["detail"]
    assert client.get(f"{API}/reports/customer-approvals", headers=member).json()["submissions"]

    v = client.get(f"{API}/documents/{doc['id']}", headers=viewer)
    assert v.status_code == 200, v.text
    assert v.json()["viewer_only"] is True and v.json()["submissions"] == []
    assert len(client.get(f"{API}/documents/{doc['id']}", headers=member).json()["submissions"]) == 1
