"""Design on the central approval engine + data scope: drawing revision
submit → check → approve → released, checker ≠ approver, returns, recall,
the review-checklist guard on the central endpoint, in-flight revisions
finishing on the old path, ECN approval, and data scope on drawings."""
import pytest

from app.modules.design.approvals import DOC_ENTITY, DOC_KEY, ECN_ENTITY, migrate_design_submit_cancel_grants
from app.modules.design.models.document import DesignDocumentRevision
from app.modules.design.models.library import DesignChecklist, DesignChecklistItem
from app.modules.main.models.role import Role
from app.modules.organization.services import approval_engine as engine
from app.tests.test_cov_design_support import API, auth, create_doc, fake_sharepoint, make_team, make_user, rev, upload  # noqa: F401  (fixture)

pytestmark = pytest.mark.usefixtures("fake_sharepoint")
APPROVALS = "/api/v1/approvals"


@pytest.fixture
def team(db):
    return make_team(db)


def _submit(client, team, doc):
    rid = rev(doc, "R0")["id"]
    assert upload(client, team["author"], rid).status_code == 200
    r = client.post(f"{API}/revisions/{rid}/submit", json={}, headers=auth(team["author"]))
    assert r.status_code == 200, r.text
    return rid, r.json()


def test_drawing_revision_submit_check_approve_release(client, db, team):
    doc = create_doc(client, team)
    rid, detail = _submit(client, team, doc)
    assert rev(detail, "R0")["status"] == "in_review" and detail["approval_engine"] is True

    req = engine.latest_request(db, DOC_ENTITY, doc["id"])
    assert req.workflow_key == DOC_KEY and req.status == "pending"
    assert [(s.stage_name, s.approver_id) for s in req.steps] == [("Check", team["checker"].id), ("Approval", team["approver"].id)]
    # The checker sees the check action; the approver doesn't yet.
    assert "review" in client.get(f"{API}/documents/{doc['id']}", headers=auth(team["checker"])).json()["allowed_actions"]
    assert "approve" not in client.get(f"{API}/documents/{doc['id']}", headers=auth(team["approver"])).json()["allowed_actions"]

    # Check passed from the central approval endpoint (My Approvals / ApprovalPanel).
    r = client.post(f"{APPROVALS}/requests/{req.id}/decide", json={"decision": "approve", "comment": "Checked"}, headers=auth(team["checker"]))
    assert r.status_code == 200, r.text
    d = client.get(f"{API}/documents/{doc['id']}", headers=auth(team["approver"])).json()
    r0 = rev(d, "R0")
    assert r0["status"] == "in_approval" and r0["reviewed_by_id"] == team["checker"].id and r0["review_comment"] == "Checked"
    assert "approve" in d["allowed_actions"]

    # Approval through the module route (it delegates to the engine).
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "pass", "comment": "OK"}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    r0 = rev(r.json(), "R0")
    assert r0["status"] == "released" and r0["approved_by_id"] == team["approver"].id
    assert r.json()["display_status"] == "released"
    db.expire_all()
    assert engine.latest_request(db, DOC_ENTITY, doc["id"]).status == "approved"


def test_checker_and_approver_must_differ(client, db, team):
    # Same person named twice is refused at submission…
    doc = create_doc(client, team, approver_id=None)
    rid = rev(doc, "R0")["id"]
    assert upload(client, team["author"], rid).status_code == 200
    r = client.post(f"{API}/revisions/{rid}/submit", json={"approver_id": team["checker"].id}, headers=auth(team["author"]))
    assert r.status_code == 400 and "two different people" in r.json()["detail"]

    # …and nobody signs twice, not even an admin standing in at both stages.
    doc2 = create_doc(client, team)
    rid2, _ = _submit(client, team, doc2)
    req = engine.latest_request(db, DOC_ENTITY, doc2["id"])
    admin = auth(team["admin"])
    assert client.post(f"{APPROVALS}/requests/{req.id}/decide", json={"decision": "approve", "comment": "Checker away"}, headers=admin).status_code == 200
    r = client.post(f"{APPROVALS}/requests/{req.id}/decide", json={"decision": "approve", "comment": "Approver away"}, headers=admin)
    assert r.status_code == 403 and ("You checked" in r.json()["detail"] or "different person" in r.json()["detail"])
    # The checker can't take the approval stage either.
    r = client.post(f"{API}/revisions/{rid2}/approve", json={"decision": "pass"}, headers=auth(team["checker"]))
    assert r.status_code == 403
    r = client.post(f"{API}/revisions/{rid2}/approve", json={"decision": "pass"}, headers=auth(team["approver"]))
    assert r.status_code == 200 and rev(r.json(), "R0")["status"] == "released"


def test_return_and_recall_go_back_to_draft(client, db, team):
    doc = create_doc(client, team)
    rid, _ = _submit(client, team, doc)
    r = client.post(f"{API}/revisions/{rid}/review", json={"decision": "return"}, headers=auth(team["checker"]))
    assert r.status_code == 400
    r = client.post(f"{API}/revisions/{rid}/review", json={"decision": "return", "comment": "Weld symbols missing"}, headers=auth(team["checker"]))
    assert r.status_code == 200, r.text
    r0 = rev(r.json(), "R0")
    assert r0["status"] == "draft" and r0["returned_count"] == 1 and r0["review_comment"] == "Weld symbols missing"
    db.expire_all()
    assert engine.latest_request(db, DOC_ENTITY, doc["id"]).status == "returned"

    # Resubmit, then withdraw it: the engine request is cancelled, the revision is a draft again.
    r = client.post(f"{API}/revisions/{rid}/submit", json={}, headers=auth(team["author"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/revisions/{rid}/recall", json={"comment": "Wrong sheet"}, headers=auth(team["author"]))
    assert r.status_code == 200, r.text
    assert rev(r.json(), "R0")["status"] == "draft"
    db.expire_all()
    req = engine.latest_request(db, DOC_ENTITY, doc["id"])
    assert req.status == "cancelled" and req.revision == 2


def test_checklist_must_be_answered_on_the_design_page(client, db, team):
    cl = DesignChecklist(name="GA check", document_type="ga_drawing", discipline=None, is_active=True)
    cl.items = [DesignChecklistItem(sort_order=1, text="Title block complete")]
    db.add(cl)
    db.commit()
    doc = create_doc(client, team)
    rid, _ = _submit(client, team, doc)
    req = engine.latest_request(db, DOC_ENTITY, doc["id"])
    r = client.post(f"{APPROVALS}/requests/{req.id}/decide", json={"decision": "approve"}, headers=auth(team["checker"]))
    assert r.status_code == 409 and "checklist" in r.json()["detail"]
    db.rollback()  # the test client shares one session; a real request's session is discarded
    item_id = cl.items[0].id
    r = client.post(f"{API}/revisions/{rid}/review", headers=auth(team["checker"]),
                    json={"decision": "pass", "checklist": [{"checklist_item_id": item_id, "result": "ok"}]})
    assert r.status_code == 200, r.text
    assert rev(r.json(), "R0")["status"] == "in_approval"


def test_in_flight_revision_finishes_on_the_old_path(client, db, team):
    """Submitted before the cut-over: no engine request — the module routes
    still check and approve it."""
    doc = create_doc(client, team)
    rid = rev(doc, "R0")["id"]
    assert upload(client, team["author"], rid).status_code == 200
    row = db.get(DesignDocumentRevision, rid)
    row.status = "in_review"
    db.commit()
    assert engine.latest_request(db, DOC_ENTITY, doc["id"]) is None
    r = client.post(f"{API}/revisions/{rid}/review", json={"decision": "pass"}, headers=auth(team["checker"]))
    assert r.status_code == 200 and rev(r.json(), "R0")["status"] == "in_approval"
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "pass"}, headers=auth(team["approver"]))
    assert r.status_code == 200 and rev(r.json(), "R0")["status"] == "released"
    assert engine.latest_request(db, DOC_ENTITY, doc["id"]) is None


def test_legacy_ecn_approval_through_engine(client, db, team):
    doc = create_doc(client, team)
    rid, _ = _submit(client, team, doc)
    client.post(f"{API}/revisions/{rid}/review", json={"decision": "pass"}, headers=auth(team["checker"]))
    client.post(f"{API}/revisions/{rid}/approve", json={"decision": "pass"}, headers=auth(team["approver"]))
    ecn = client.post(f"{API}/change-notices", json={
        "title": "Gusset", "documents": [{"document_id": doc["id"]}], "approver_id": team["approver"].id,
    }, headers=auth(team["author"]))
    assert ecn.status_code == 201, ecn.text
    eid = ecn.json()["id"]
    r = client.post(f"{API}/change-notices/{eid}/submit", headers=auth(team["author"]))
    assert r.status_code == 200 and r.json()["approval_engine"] is True
    r = client.post(f"{API}/change-notices/{eid}/approve", json={"comment": "Go"}, headers=auth(team["other"]))
    assert r.status_code == 403
    req = engine.latest_request(db, ECN_ENTITY, eid)
    r = client.post(f"{APPROVALS}/requests/{req.id}/decide", json={"decision": "approve", "comment": "Go ahead"}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    d = client.get(f"{API}/change-notices/{eid}", headers=auth(team["author"])).json()
    assert d["status"] == "approved" and d["decided_by_id"] == team["approver"].id


def test_drawing_data_scope(client, db, team):
    mine = create_doc(client, team)
    theirs = create_doc(client, team, author="other", reviewer_id=team["checker"].id)
    role = Role(name="Design – own", permissions=["design:*:*"], data_scopes={"design": "own"})
    db.add(role)
    db.commit()
    author = db.merge(team["author"])
    author.roles = [role]
    db.commit()
    rows = client.get(f"{API}/documents", headers=auth(team["author"])).json()
    assert [d["id"] for d in rows] == [mine["id"]]
    r = client.get(f"{API}/documents/{theirs['id']}", headers=auth(team["author"]))
    assert r.status_code == 403 and "Own records" in r.json()["detail"]
    # The checker named on both sees both through "assigned" once widened to it.
    checker_role = Role(name="Design – assigned", permissions=["design:*:*"], data_scopes={"design": "assigned"})
    db.add(checker_role)
    db.commit()
    checker = db.merge(team["checker"])
    checker.roles = [checker_role]
    db.commit()
    assert {d["id"] for d in client.get(f"{API}/documents", headers=auth(team["checker"])).json()} == {mine["id"], theirs["id"]}


def test_submit_cancel_grant_migration(db):
    role = Role(name="Drafting", permissions=["design:documents:view", "design:documents:create"])
    db.add(role)
    user = make_user(db, "grant.user@premnathrail.com", grants=["design:boms:create"])
    db.commit()
    migrate_design_submit_cancel_grants(db.connection())
    db.commit()
    db.expire_all()
    assert {"design:documents:submit", "design:documents:cancel"} <= set(db.get(Role, role.id).permissions)
    assert {"design:boms:submit", "design:boms:cancel"} <= set(db.get(type(user), user.id).granular_permissions)


def test_rnd_project_data_scope(client, db):
    from app.tests.test_rnd_projects import BASE as RND, auth_header, create_project
    from app.tests.test_rnd_projects import make_user as rnd_user

    owner = rnd_user(db, "rnd.owner@premnathrail.com")
    member = rnd_user(db, "rnd.member@premnathrail.com")
    other = rnd_user(db, "rnd.other@premnathrail.com")
    mine = create_project(client, auth_header(owner), team_member_ids=[member.id])
    theirs = create_project(client, auth_header(other), title="Other bogie")
    own = Role(name="R&D – own", permissions=["rnd:*:*"], data_scopes={"rnd": "own"})
    assigned = Role(name="R&D – assigned", permissions=["rnd:*:*"], data_scopes={"rnd": "assigned"})
    db.add_all([own, assigned])
    db.commit()
    owner.roles = [own]
    member.roles = [assigned]
    db.commit()
    assert [p["id"] for p in client.get(f"{RND}/projects", headers=auth_header(owner)).json()] == [mine["id"]]
    r = client.get(f"{RND}/projects/{theirs['id']}", headers=auth_header(owner))
    assert r.status_code == 403 and "R&D project" in r.json()["detail"]
    # A team member sees the project through "assigned".
    assert [p["id"] for p in client.get(f"{RND}/projects", headers=auth_header(member)).json()] == [mine["id"]]
