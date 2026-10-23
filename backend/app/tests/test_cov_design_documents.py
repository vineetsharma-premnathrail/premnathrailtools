"""Coverage: Design document register — <TYPE>-<YEAR>-NNNN numbering, R0/R1/R2
revisions, segregation (author != checker != approver) incl. team roles,
Design-head-only release, the customer approval gate, viewer limits,
Permission Matrix 403s and real error messages."""
from datetime import date, timedelta

import pytest

from app.tests.test_cov_design_support import (
    API, YEAR, auth, create_doc, fake_sharepoint, make_team, make_user, rev, release, released_doc, set_team,
    to_approval, upload,
)

pytestmark = pytest.mark.usefixtures("fake_sharepoint")


@pytest.fixture
def team(db):
    return make_team(db)


# ---------------------------------------------------------------------------
# Numbering
# ---------------------------------------------------------------------------

def test_numbering_is_per_type_per_year(client, team):
    ga1 = create_doc(client, team)
    ga2 = create_doc(client, team, title="Second GA")
    dwg = create_doc(client, team, title="Bracket", document_type="part_drawing")
    spc = create_doc(client, team, title="Axle spec", document_type="specification")
    other = create_doc(client, team, title="Misc note", document_type="other")
    assert ga1["doc_number"] == f"GA-{YEAR}-0001"
    assert ga2["doc_number"] == f"GA-{YEAR}-0002"
    assert dwg["doc_number"] == f"DWG-{YEAR}-0001"
    assert spc["doc_number"] == f"SPC-{YEAR}-0001"
    assert other["doc_number"] == f"DOC-{YEAR}-0001"


def test_deleted_document_number_is_never_reused(client, team):
    first = create_doc(client, team)
    assert client.delete(f"{API}/documents/{first['id']}", headers=auth(team["author"])).status_code == 200
    nxt = create_doc(client, team, title="Replacement")
    assert nxt["doc_number"] == f"GA-{YEAR}-0002"


def test_invalid_type_and_discipline_name_the_valid_choices(client, team):
    h = auth(team["author"])
    r = client.post(f"{API}/documents", json={"title": "X drawing", "document_type": "blueprint"}, headers=h)
    assert r.status_code == 400
    assert "'blueprint' isn't a valid document type" in r.json()["detail"] and "ga_drawing" in r.json()["detail"]
    r = client.post(f"{API}/documents", json={"title": "X drawing", "document_type": "ga_drawing", "discipline": "plumbing"}, headers=h)
    assert r.status_code == 400 and "valid discipline" in r.json()["detail"] and "mechanical" in r.json()["detail"]


def test_r0_is_initial_issue_and_custom_summary_kept(client, team):
    doc = create_doc(client, team, change_summary="First issue for tender")
    r0 = rev(doc, "R0")
    assert r0["change_summary"] == "First issue for tender" and r0["status"] == "draft"
    assert doc["open_revision_label"] == "R0" and doc["pending_with_name"] == "cov.author"


# ---------------------------------------------------------------------------
# Revisions R0 → R1 → R2
# ---------------------------------------------------------------------------

def test_three_revisions_supersede_in_order(client, team):
    detail = released_doc(client, team)
    doc_id = detail["id"]
    for label in ("R1", "R2"):
        r = client.post(f"{API}/documents/{doc_id}/revisions", json={
            "change_summary": f"Change for {label}", "reviewer_id": team["checker"].id, "approver_id": team["approver"].id,
        }, headers=auth(team["author"]))
        assert r.status_code == 201, r.text
        assert rev(r.json(), label)["status"] == "draft"
        detail = release(client, team, rev(r.json(), label)["id"])
    statuses = {x["revision_label"]: x["status"] for x in detail["revisions"]}
    assert statuses == {"R0": "superseded", "R1": "superseded", "R2": "released"}
    assert detail["released_revision_label"] == "R2"
    # Newest revision first on the detail page.
    assert [x["revision_label"] for x in detail["revisions"]] == ["R2", "R1", "R0"]


def test_r1_change_summary_cannot_be_blanked(client, team):
    detail = released_doc(client, team)
    d = client.post(f"{API}/documents/{detail['id']}/revisions", json={"change_summary": "Gusset change"}, headers=auth(team["author"])).json()
    r1 = rev(d, "R1")["id"]
    r = client.patch(f"{API}/revisions/{r1}", json={"change_summary": "   "}, headers=auth(team["author"]))
    assert r.status_code == 400 and "R1 needs a change summary" in r.json()["detail"]


def test_new_revision_requires_three_char_summary(client, team):
    detail = released_doc(client, team)
    r = client.post(f"{API}/documents/{detail['id']}/revisions", json={"change_summary": "x"}, headers=auth(team["author"]))
    assert r.status_code == 422


def test_new_revision_ecn_must_list_document(client, team):
    detail = released_doc(client, team)
    other = released_doc(client, team, title="Other drawing")
    h = auth(team["other"])
    ecn = client.post(f"{API}/change-notices", json={
        "title": "Change other only", "approver_id": team["approver"].id, "documents": [{"document_id": other["id"]}],
    }, headers=h).json()
    client.post(f"{API}/change-notices/{ecn['id']}/submit", headers=h)
    client.post(f"{API}/change-notices/{ecn['id']}/approve", json={}, headers=auth(team["approver"]))
    r = client.post(f"{API}/documents/{detail['id']}/revisions", json={"change_summary": "Under wrong ECN", "ecn_id": ecn["id"]}, headers=auth(team["author"]))
    assert r.status_code == 400 and "doesn't list" in r.json()["detail"] and detail["doc_number"] in r.json()["detail"]
    r = client.post(f"{API}/documents/{detail['id']}/revisions", json={"change_summary": "Missing ECN", "ecn_id": 9999}, headers=auth(team["author"]))
    assert r.status_code == 400 and "ECN #9999 wasn't found" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Segregation of duties
# ---------------------------------------------------------------------------

def test_checker_cannot_also_approve_and_author_cannot_approve(client, team):
    doc = create_doc(client, team)
    rid = rev(doc, "R0")["id"]
    to_approval(client, team, rid)
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "pass"}, headers=auth(team["checker"]))
    assert r.status_code == 403 and "You checked" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "pass"}, headers=auth(team["author"]))
    assert r.status_code == 403 and "You wrote" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "pass"}, headers=auth(team["other"]))
    assert r.status_code == 403 and "waiting on cov.approver" in r.json()["detail"]


def test_approver_return_needs_comment_and_resets_signatures(client, team):
    doc = create_doc(client, team)
    rid = rev(doc, "R0")["id"]
    to_approval(client, team, rid)
    h = auth(team["approver"])
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "return", "comment": "  "}, headers=h)
    assert r.status_code == 400 and "Say what needs fixing" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "return", "comment": "Section A-A missing"}, headers=h)
    assert r.status_code == 200
    r0 = rev(r.json(), "R0")
    assert r0["status"] == "draft" and r0["returned_count"] == 1 and r0["approval_comment"] == "Section A-A missing"
    r = client.post(f"{API}/revisions/{rid}/submit", json={}, headers=auth(team["author"]))
    r0 = rev(r.json(), "R0")
    assert r0["status"] == "in_review" and r0["reviewed_by_id"] is None and r0["approval_comment"] is None


def test_signatory_must_exist_and_be_active(client, db, team):
    gone = make_user(db, "cov.left@premnathrail.com", active=False)
    h = auth(team["author"])
    r = client.post(f"{API}/documents", json={"title": "Axle spec", "document_type": "specification", "reviewer_id": gone.id}, headers=h)
    assert r.status_code == 400 and "deactivated" in r.json()["detail"] and "checker" in r.json()["detail"]
    r = client.post(f"{API}/documents", json={"title": "Axle spec", "document_type": "specification", "approver_id": 99999}, headers=h)
    assert r.status_code == 400 and "user #99999" in r.json()["detail"] and "no longer exists" in r.json()["detail"]


def test_team_roles_restrict_checker_and_approver(client, team):
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head"})
    h = auth(team["author"])
    base = {"title": "Bracket", "document_type": "part_drawing"}
    # Checker must be a reviewer or head.
    r = client.post(f"{API}/documents", json={**base, "reviewer_id": team["other"].id}, headers=h)
    assert r.status_code == 400 and "not on the Design team" in r.json()["detail"] and "reviewer or the Design head" in r.json()["detail"]
    # Approver (who releases) must be the head.
    r = client.post(f"{API}/documents", json={**base, "reviewer_id": team["approver"].id, "approver_id": team["checker"].id}, headers=h)
    assert r.status_code == 400 and "is a reviewer" in r.json()["detail"] and "the Design head" in r.json()["detail"]
    # An admin may sign without being on the team.
    r = client.post(f"{API}/documents", json={**base, "reviewer_id": team["checker"].id, "approver_id": team["admin"].id}, headers=h)
    assert r.status_code == 201, r.text


def test_head_releases_with_team_configured(client, team):
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head"})
    doc = create_doc(client, team)
    detail = release(client, team, rev(doc, "R0")["id"])
    r0 = rev(detail, "R0")
    assert detail["display_status"] == "released" and r0["approved_by_name"] == "cov.approver"
    assert r0["released_by_id"] is None  # approver released it themselves


def test_team_change_after_draft_blocks_submit_to_non_head(client, team):
    doc = create_doc(client, team)  # approver named before the team existed
    rid = rev(doc, "R0")["id"]
    set_team(client, team, {"author": "designer", "checker": "reviewer", "other": "head"})
    assert upload(client, team["author"], rid).status_code == 200
    r = client.post(f"{API}/revisions/{rid}/submit", json={}, headers=auth(team["author"]))
    assert r.status_code == 400 and "not on the Design team" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Customer approval gate
# ---------------------------------------------------------------------------

def _customer_approved(client, team, doc):
    r0 = rev(doc, "R0")["id"]
    h = auth(team["admin"])
    sub = client.post(f"{API}/submissions", json={"customer_name": "RDSO", "lines": [{"revision_id": r0}]}, headers=h).json()
    sent = client.post(f"{API}/submissions/{sub['id']}/send", json={}, headers=h).json()
    r = client.post(f"{API}/submissions/{sub['id']}/response", json={
        "response_date": date.today().isoformat(), "lines": [{"line_id": sent["lines"][0]["id"], "response": "approved"}],
    }, headers=h)
    assert r.status_code == 200, r.text
    return r0


def test_customer_gate_release_rights(client, team):
    doc = create_doc(client, team, customer_approval_required=True)
    r0 = rev(doc, "R0")["id"]
    # Not approved yet → nothing to release.
    r = client.post(f"{API}/revisions/{r0}/release", json={}, headers=auth(team["approver"]))
    assert r.status_code == 409 and "only an approved revision waiting on the customer" in r.json()["detail"]
    release(client, team, r0)
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head"})
    _customer_approved(client, team, doc)
    # A reviewer who isn't the approver or head can't release.
    r = client.post(f"{API}/revisions/{r0}/release", json={}, headers=auth(team["checker"]))
    assert r.status_code == 403 and "Only the Design head" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{r0}/release", json={"comment": "Customer OK"}, headers=auth(team["approver"]))
    assert r.status_code == 200 and r.json()["display_status"] == "released"


def test_approved_awaiting_customer_cannot_be_deleted_or_revised(client, team):
    doc = create_doc(client, team, customer_approval_required=True)
    detail = release(client, team, rev(doc, "R0")["id"])
    assert detail["display_status"] == "approved"
    r = client.delete(f"{API}/documents/{doc['id']}", headers=auth(team["author"]))
    assert r.status_code == 409 and "sent towards the customer" in r.json()["detail"]
    r = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Too soon"}, headers=auth(team["author"]))
    assert r.status_code == 409 and "R0 is already open" in r.json()["detail"]


def test_submission_rules(client, team):
    plain = create_doc(client, team, title="Draft only")
    h = auth(team["admin"])
    r = client.post(f"{API}/submissions", json={"customer_name": "ICF", "lines": [{"revision_id": rev(plain, "R0")["id"]}]}, headers=h)
    assert r.status_code == 400 and "only revisions approved internally" in r.json()["detail"]
    r = client.post(f"{API}/submissions", json={"lines": []}, headers=h)
    assert r.status_code == 400 and "type the customer's name" in r.json()["detail"]

    doc = create_doc(client, team, customer_approval_required=True)
    r0 = rev(doc, "R0")["id"]
    release(client, team, r0)
    r = client.post(f"{API}/submissions", json={"customer_name": "ICF", "lines": [{"revision_id": r0}, {"revision_id": r0}]}, headers=h)
    assert r.status_code == 400 and "listed twice" in r.json()["detail"]

    sub = client.post(f"{API}/submissions", json={"customer_name": "ICF", "lines": [{"revision_id": r0}]}, headers=h).json()
    future = (date.today() + timedelta(days=2)).isoformat()
    r = client.post(f"{API}/submissions/{sub['id']}/send", json={"sent_date": future}, headers=h)
    assert r.status_code == 400 and "can't be in the future" in r.json()["detail"]
    sent = client.post(f"{API}/submissions/{sub['id']}/send", json={}, headers=h).json()
    line_id = sent["lines"][0]["id"]
    r = client.post(f"{API}/submissions/{sub['id']}/response", json={"response_date": future, "lines": [{"line_id": line_id, "response": "approved"}]}, headers=h)
    assert r.status_code == 400 and "can't be in the future" in r.json()["detail"]
    today = date.today().isoformat()
    r = client.post(f"{API}/submissions/{sub['id']}/response", json={"response_date": today, "lines": [{"line_id": line_id, "response": "pending"}]}, headers=h)
    assert r.status_code == 400 and "isn't a customer verdict" in r.json()["detail"]
    r = client.post(f"{API}/submissions/{sub['id']}/response", json={"response_date": today, "lines": [{"line_id": line_id, "response": "rejected"}]}, headers=h)
    assert r.status_code == 400 and "Write down the customer's comments" in r.json()["detail"]


def test_only_head_sends_submission_when_team_set(client, team):
    doc = create_doc(client, team, customer_approval_required=True)
    r0 = rev(doc, "R0")["id"]
    release(client, team, r0)
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head"})
    sub = client.post(f"{API}/submissions", json={"customer_name": "ICF", "lines": [{"revision_id": r0}]}, headers=auth(team["author"]))
    assert sub.status_code == 201, sub.text
    r = client.post(f"{API}/submissions/{sub.json()['id']}/send", json={}, headers=auth(team["author"]))
    assert r.status_code == 403 and "Only the Design head sends" in r.json()["detail"]


def test_customer_approved_r1_supersedes_released_r0(client, team):
    detail = released_doc(client, team, customer_approval_required=False)
    client.patch(f"{API}/documents/{detail['id']}", json={"customer_approval_required": True}, headers=auth(team["author"]))
    d = client.post(f"{API}/documents/{detail['id']}/revisions", json={
        "change_summary": "Customer-driven change", "reviewer_id": team["checker"].id, "approver_id": team["approver"].id,
    }, headers=auth(team["author"])).json()
    r1 = rev(d, "R1")["id"]
    d = release(client, team, r1)
    assert d["display_status"] == "revising" and rev(d, "R0")["status"] == "released"
    h = auth(team["admin"])
    sub = client.post(f"{API}/submissions", json={"customer_name": "RDSO", "lines": [{"revision_id": r1}]}, headers=h).json()
    sent = client.post(f"{API}/submissions/{sub['id']}/send", json={}, headers=h).json()
    client.post(f"{API}/submissions/{sub['id']}/response", json={
        "response_date": date.today().isoformat(), "lines": [{"line_id": sent["lines"][0]["id"], "response": "approved"}],
    }, headers=h)
    r = client.post(f"{API}/revisions/{r1}/release", json={}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    assert rev(r.json(), "R0")["status"] == "superseded" and r.json()["released_revision_label"] == "R1"


# ---------------------------------------------------------------------------
# Viewers, app access, Permission Matrix
# ---------------------------------------------------------------------------

def test_viewer_limits(client, db, team):
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head"})
    viewer = make_user(db, "cov.prod@premnathrail.com", apps=("design", "production"))
    draft = create_doc(client, team, title="Unreleased")
    upload(client, team["author"], rev(draft, "R0")["id"])
    file_id = rev(client.get(f"{API}/documents/{draft['id']}", headers=auth(team["author"])).json(), "R0")["files"][0]["id"]
    h = auth(viewer)
    r = client.get(f"{API}/revisions/files/{file_id}/content", headers=h)
    assert r.status_code == 403 and "only open to the Design team" in r.json()["detail"]
    r = client.post(f"{API}/documents/{draft['id']}/comments", json={"comment": "Peek"}, headers=h)
    assert r.status_code == 404 and "isn't released yet" in r.json()["detail"]

    released = released_doc(client, team, title="Released one")
    r = client.post(f"{API}/documents/{released['id']}/revisions", json={"change_summary": "Viewer tries"}, headers=h)
    assert r.status_code == 403 and "Only members of the Design team can start a new revision" in r.json()["detail"]
    r = client.post(f"{API}/documents/{released['id']}/comments", json={"comment": "Hole too close to edge"}, headers=h)
    assert r.status_code == 200 and r.json()["events"][0]["comment"] == "Hole too close to edge"


def test_module_access_required_for_writes(client, db, team):
    outsider = make_user(db, "cov.crm@premnathrail.com", apps=("crm",))
    r = client.post(f"{API}/documents", json={"title": "Sneaky", "document_type": "ga_drawing"}, headers=auth(outsider))
    assert r.status_code == 403 and "You can't open the Design" in r.json()["detail"]
    assert client.get(f"{API}/boms", headers=auth(outsider)).status_code == 403
    assert client.get(f"{API}/change-notices", headers=auth(outsider)).status_code == 403


def test_permission_matrix_gates_register_tabs(client, db, team):
    boms_only = make_user(db, "cov.matrix@premnathrail.com", grants=["design:boms:view"])
    h = auth(boms_only)
    r = client.get(f"{API}/documents", headers=h)
    assert r.status_code == 403 and "design:documents" in r.json()["detail"]
    assert client.get(f"{API}/dashboard", headers=h).status_code == 403
    assert client.get(f"{API}/change-notices", headers=h).status_code == 403
    assert client.get(f"{API}/reports/summary", headers=h).status_code == 403
    assert client.get(f"{API}/boms", headers=h).status_code == 200

    docs_user = make_user(db, "cov.matrix2@premnathrail.com", grants=["design:documents:view"])
    assert client.get(f"{API}/documents", headers=auth(docs_user)).status_code == 200
    # Untouched by the matrix → unrestricted; admin always passes.
    assert client.get(f"{API}/documents", headers=auth(team["other"])).status_code == 200
    assert client.get(f"{API}/boms", headers=auth(team["admin"])).status_code == 200


def test_owner_change_needs_design_access_and_title_not_empty(client, db, team):
    doc = create_doc(client, team)
    crm = make_user(db, "cov.crm2@premnathrail.com", apps=("crm",))
    h = auth(team["author"])
    r = client.patch(f"{API}/documents/{doc['id']}", json={"owner_id": crm.id}, headers=h)
    assert r.status_code == 400 and "doesn't have access to the Design module" in r.json()["detail"]
    r = client.patch(f"{API}/documents/{doc['id']}", json={"owner_id": None}, headers=h)
    assert r.status_code == 400 and "must have an owner" in r.json()["detail"]
    r = client.patch(f"{API}/documents/{doc['id']}", json={"store_item_id": 4242}, headers=h)
    assert r.status_code == 400 and "Store item #4242 wasn't found" in r.json()["detail"]
    r = client.patch(f"{API}/documents/{doc['id']}", json={"title": "Edited"}, headers=auth(team["checker"]))
    assert r.status_code == 403 and "Only the owner" in r.json()["detail"]


def test_missing_revision_and_document_are_404_with_reason(client, team):
    r = client.get(f"{API}/documents/987654", headers=auth(team["author"]))
    assert r.status_code == 404 and "#987654 not found" in r.json()["detail"]
    r = client.post(f"{API}/revisions/987654/submit", json={}, headers=auth(team["author"]))
    assert r.status_code == 404 and "Revision #987654 not found" in r.json()["detail"]
