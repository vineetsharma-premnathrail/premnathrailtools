"""End-to-end tests for the Design module: document → R0 check/approve →
release → R1 supersedes R0, the four-eyes rules, returns/recall, draft-only
file changes, obsolete/delete guards, and the ECN flow through to
implementation. SharePoint is replaced by an in-memory store."""
import json

import pytest

from app.auth.jwt_handler import create_access_token
from app.core.config import settings
from app.modules.main.models.user import User
from app.utils.sharepoint import _verify_magic_bytes

API = "/api/v1/design"
PDF = b"%PDF-1.7 test drawing"


@pytest.fixture(autouse=True)
def fake_sharepoint(monkeypatch):
    store: dict[str, bytes] = {}

    async def upload(site_id, folder_path, upload_file):
        data = upload_file.file.read()
        path = f"{folder_path}/{upload_file.filename}"
        store[path] = data
        return {"name": upload_file.filename, "path": path, "webUrl": f"https://sp.example/{path}", "size": len(data)}

    async def download(site_id, file_path):
        return store[file_path], "application/octet-stream"

    async def delete(site_id, file_path):
        store.pop(file_path, None)

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "test-site")
    monkeypatch.setattr("app.modules.design.routes.revisions.upload_file_to_sharepoint", upload)
    monkeypatch.setattr("app.modules.design.routes.revisions.download_file_content", download)
    monkeypatch.setattr("app.modules.design.routes.revisions.delete_file_from_sharepoint", delete)
    monkeypatch.setattr("app.modules.design.routes.documents.delete_file_from_sharepoint", delete)
    return store


def make_user(db, email, apps=("design",), role="user"):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@pytest.fixture
def team(db):
    return {
        "author": make_user(db, "author@premnathrail.com"),
        "checker": make_user(db, "checker@premnathrail.com"),
        "approver": make_user(db, "approver@premnathrail.com"),
        "other": make_user(db, "other@premnathrail.com"),
        "admin": make_user(db, "admin@premnathrail.com", role="admin"),
    }


def create_doc(client, team, **extra):
    body = {
        "title": "Bogie frame GA", "document_type": "ga_drawing", "discipline": "mechanical",
        "reviewer_id": team["checker"].id, "approver_id": team["approver"].id, **extra,
    }
    r = client.post(f"{API}/documents", json=body, headers=auth(team["author"]))
    assert r.status_code == 201, r.text
    return r.json()


def upload(client, user, revision_id, name="frame.pdf", data=PDF, role="primary"):
    return client.post(
        f"{API}/revisions/{revision_id}/files", headers=auth(user),
        files=[("files", (name, data, "application/pdf"))], data={"file_role": role},
    )


def release(client, team, revision_id):
    """Upload → submit → check → approve one draft revision."""
    assert upload(client, team["author"], revision_id).status_code == 200
    r = client.post(f"{API}/revisions/{revision_id}/submit", json={}, headers=auth(team["author"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/revisions/{revision_id}/review", json={"decision": "pass"}, headers=auth(team["checker"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/revisions/{revision_id}/approve", json={"decision": "pass", "comment": "OK for manufacture"}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    return r.json()


def rev(detail, label):
    return next(r for r in detail["revisions"] if r["revision_label"] == label)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def test_full_lifecycle_r0_release_then_r1_supersedes(client, team):
    doc = create_doc(client, team)
    assert doc["doc_number"].startswith("GA-") and doc["doc_number"].endswith("-0001")
    assert doc["display_status"] == "draft"
    r0 = rev(doc, "R0")
    assert r0["status"] == "draft" and r0["change_summary"] == "Initial issue"

    detail = release(client, team, r0["id"])
    assert detail["display_status"] == "released"
    assert detail["released_revision_label"] == "R0"
    r0 = rev(detail, "R0")
    assert r0["reviewed_by_name"] == "checker" and r0["approved_by_name"] == "approver"
    assert r0["approval_comment"] == "OK for manufacture"

    r = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Gusset thickened to 12 mm"}, headers=auth(team["author"]))
    assert r.status_code == 201, r.text
    detail = r.json()
    assert detail["display_status"] == "revising"
    r1 = rev(detail, "R1")
    assert r1["status"] == "draft"
    # Signatories aren't carried over — name them on the new revision.
    r = client.patch(f"{API}/revisions/{r1['id']}", json={"reviewer_id": team["checker"].id, "approver_id": team["approver"].id}, headers=auth(team["author"]))
    assert r.status_code == 200, r.text

    detail = release(client, team, r1["id"])
    assert detail["released_revision_label"] == "R1"
    assert rev(detail, "R0")["status"] == "superseded"
    assert rev(detail, "R0")["superseded_at"]
    actions = [e["action"] for e in detail["events"]]
    for expected in ("created", "submitted", "review_passed", "approved_released", "revision_started", "superseded"):
        assert expected in actions
    # Released R0's files are still retrievable after it's superseded.
    file_id = rev(detail, "R0")["files"][0]["id"]
    r = client.get(f"{API}/revisions/files/{file_id}/content", headers=auth(team["other"]))
    assert r.status_code == 200 and r.content == PDF
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.headers["content-disposition"].startswith("inline")


def test_cad_file_served_as_download(client, team):
    doc = create_doc(client, team)
    r = upload(client, team["author"], rev(doc, "R0")["id"], name="frame.dwg", data=b"AC1032 fake dwg", role="native")
    assert r.status_code == 200, r.text
    f = rev(r.json(), "R0")["files"][0]
    assert f["file_role"] == "native"
    resp = client.get(f"{API}/revisions/files/{f['id']}/content", headers=auth(team["author"]))
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("attachment")
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_cad_signatures():
    assert _verify_magic_bytes("frame.dwg", "application/octet-stream", b"AC1027\x00\x00")
    assert not _verify_magic_bytes("frame.dwg", "application/octet-stream", b"MZ\x90\x00 exe")
    assert _verify_magic_bytes("part.step", "application/octet-stream", b"ISO-10303-21;\nHEADER")
    assert not _verify_magic_bytes("part.stp", "application/octet-stream", b"<html>")
    assert _verify_magic_bytes("model.stl", "application/octet-stream", b"solid anything")


# ---------------------------------------------------------------------------
# Four-eyes rules
# ---------------------------------------------------------------------------

def test_signatory_rules(client, team):
    base = {"title": "Axle spec", "document_type": "specification"}
    h = auth(team["author"])
    r = client.post(f"{API}/documents", json={**base, "reviewer_id": team["checker"].id, "approver_id": team["checker"].id}, headers=h)
    assert r.status_code == 400 and "two different people" in r.json()["detail"]
    r = client.post(f"{API}/documents", json={**base, "reviewer_id": team["author"].id}, headers=h)
    assert r.status_code == 400 and "can't also be its checker" in r.json()["detail"]
    r = client.post(f"{API}/documents", json={**base, "approver_id": team["author"].id}, headers=h)
    assert r.status_code == 400 and "can't also approve" in r.json()["detail"]


def test_signatory_must_have_design_app(client, db, team):
    outsider = make_user(db, "crm-only@premnathrail.com", apps=("crm",))
    r = client.post(f"{API}/documents", json={"title": "Axle spec", "document_type": "specification", "reviewer_id": outsider.id}, headers=auth(team["author"]))
    assert r.status_code == 400
    assert "doesn't have access to the Design module" in r.json()["detail"]


def test_only_named_people_decide(client, team):
    doc = create_doc(client, team)
    rid = rev(doc, "R0")["id"]
    upload(client, team["author"], rid)
    client.post(f"{API}/revisions/{rid}/submit", json={}, headers=auth(team["author"]))

    r = client.post(f"{API}/revisions/{rid}/review", json={"decision": "pass"}, headers=auth(team["author"]))
    assert r.status_code == 403 and "You wrote" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{rid}/review", json={"decision": "pass"}, headers=auth(team["approver"]))
    assert r.status_code == 403 and "named approver" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{rid}/review", json={"decision": "pass"}, headers=auth(team["other"]))
    assert r.status_code == 403 and "checker" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "pass"}, headers=auth(team["approver"]))
    assert r.status_code == 409 and "not awaiting approval" in r.json()["detail"]

    # Admin stands in for the checker…
    r = client.post(f"{API}/revisions/{rid}/review", json={"decision": "pass"}, headers=auth(team["admin"]))
    assert r.status_code == 200, r.text
    # …so the admin can't also approve it.
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "pass"}, headers=auth(team["admin"]))
    assert r.status_code == 403 and "You checked" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "pass"}, headers=auth(team["approver"]))
    assert r.status_code == 200
    assert r.json()["display_status"] == "released"


def test_double_approve_is_409(client, team):
    doc = create_doc(client, team)
    rid = rev(doc, "R0")["id"]
    release(client, team, rid)
    r = client.post(f"{API}/revisions/{rid}/approve", json={"decision": "pass"}, headers=auth(team["approver"]))
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Submit / return / recall / files
# ---------------------------------------------------------------------------

def test_submit_needs_files_and_signatories(client, team):
    r = client.post(f"{API}/documents", json={"title": "Loose drawing", "document_type": "part_drawing"}, headers=auth(team["author"]))
    doc = r.json()
    rid = rev(doc, "R0")["id"]
    r = client.post(f"{API}/revisions/{rid}/submit", json={}, headers=auth(team["author"]))
    assert r.status_code == 400 and "a checker and an approver" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{rid}/submit", json={"reviewer_id": team["checker"].id, "approver_id": team["approver"].id}, headers=auth(team["author"]))
    assert r.status_code == 400 and "no files" in r.json()["detail"]
    upload(client, team["author"], rid)
    r = client.post(f"{API}/revisions/{rid}/submit", json={"reviewer_id": team["checker"].id, "approver_id": team["approver"].id}, headers=auth(team["author"]))
    assert r.status_code == 200
    assert rev(r.json(), "R0")["status"] == "in_review"


def test_return_requires_comment_and_lands_in_my_tasks(client, team):
    doc = create_doc(client, team)
    rid = rev(doc, "R0")["id"]
    upload(client, team["author"], rid)
    client.post(f"{API}/revisions/{rid}/submit", json={}, headers=auth(team["author"]))

    tasks = client.get(f"{API}/my-tasks", headers=auth(team["checker"])).json()
    assert [t["revision_id"] for t in tasks["to_review"]] == [rid]

    r = client.post(f"{API}/revisions/{rid}/review", json={"decision": "return"}, headers=auth(team["checker"]))
    assert r.status_code == 400 and "what needs fixing" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{rid}/review", json={"decision": "return", "comment": "Weld symbols missing"}, headers=auth(team["checker"]))
    assert r.status_code == 200
    r0 = rev(r.json(), "R0")
    assert r0["status"] == "draft" and r0["returned_count"] == 1

    tasks = client.get(f"{API}/my-tasks", headers=auth(team["author"])).json()
    assert tasks["returned_to_me"][0]["comment"] == "Weld symbols missing"

    # Resubmit → fresh cycle, previous check cleared.
    r = client.post(f"{API}/revisions/{rid}/submit", json={}, headers=auth(team["author"]))
    r0 = rev(r.json(), "R0")
    assert r0["status"] == "in_review" and r0["reviewed_by_id"] is None


def test_recall_and_files_locked_outside_draft(client, team, fake_sharepoint):
    doc = create_doc(client, team)
    rid = rev(doc, "R0")["id"]
    upload(client, team["author"], rid)
    r = upload(client, team["author"], rid)
    assert r.status_code == 409 and "already has a file named" in r.json()["detail"]

    client.post(f"{API}/revisions/{rid}/submit", json={}, headers=auth(team["author"]))
    r = upload(client, team["author"], rid, name="extra.pdf")
    assert r.status_code == 409 and "Recall it to draft first" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{rid}/recall", json={}, headers=auth(team["other"]))
    assert r.status_code == 403
    r = client.post(f"{API}/revisions/{rid}/recall", json={"comment": "Forgot a sheet"}, headers=auth(team["author"]))
    assert r.status_code == 200 and rev(r.json(), "R0")["status"] == "draft"

    file_id = rev(r.json(), "R0")["files"][0]["id"]
    r = client.delete(f"{API}/revisions/{rid}/files/{file_id}", headers=auth(team["author"]))
    assert r.status_code == 200 and rev(r.json(), "R0")["files"] == []
    assert not fake_sharepoint


def test_allowed_actions_follow_the_rules(client, team):
    doc = create_doc(client, team)
    assert {"edit", "edit_revision", "manage_files", "submit", "delete"} <= set(doc["allowed_actions"])
    other_view = client.get(f"{API}/documents/{doc['id']}", headers=auth(team["other"])).json()
    assert "submit" not in other_view["allowed_actions"] and "edit" not in other_view["allowed_actions"]

    rid = rev(doc, "R0")["id"]
    upload(client, team["author"], rid)
    client.post(f"{API}/revisions/{rid}/submit", json={}, headers=auth(team["author"]))
    checker_view = client.get(f"{API}/documents/{doc['id']}", headers=auth(team["checker"])).json()
    assert "review" in checker_view["allowed_actions"]
    author_view = client.get(f"{API}/documents/{doc['id']}", headers=auth(team["author"])).json()
    assert "review" not in author_view["allowed_actions"] and "recall" in author_view["allowed_actions"]


# ---------------------------------------------------------------------------
# Revision guards, obsolete, delete
# ---------------------------------------------------------------------------

def test_one_open_revision_and_release_first(client, team):
    doc = create_doc(client, team)
    r = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Too early"}, headers=auth(team["author"]))
    assert r.status_code == 409 and "already open" in r.json()["detail"]
    release(client, team, rev(doc, "R0")["id"])
    assert client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "First change"}, headers=auth(team["author"])).status_code == 201
    r = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Second change"}, headers=auth(team["author"]))
    assert r.status_code == 409 and "R1 is already open" in r.json()["detail"]


def test_discarded_draft_frees_its_label(client, team):
    doc = create_doc(client, team)
    release(client, team, rev(doc, "R0")["id"])
    detail = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Try one"}, headers=auth(team["author"])).json()
    r = client.delete(f"{API}/revisions/{rev(detail, 'R1')['id']}", headers=auth(team["author"]))
    assert r.status_code == 200
    assert [x["revision_label"] for x in r.json()["revisions"]] == ["R0"]
    detail = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Try two"}, headers=auth(team["author"])).json()
    assert rev(detail, "R1")["change_summary"] == "Try two"


def test_first_revision_cannot_be_discarded(client, team):
    doc = create_doc(client, team)
    r = client.delete(f"{API}/revisions/{rev(doc, 'R0')['id']}", headers=auth(team["author"]))
    assert r.status_code == 409 and "delete the document instead" in r.json()["detail"]


def test_delete_and_obsolete_guards(client, team):
    draft = create_doc(client, team, title="Scrap idea")
    r = client.post(f"{API}/documents/{draft['id']}/obsolete", json={"reason": "Not needed"}, headers=auth(team["author"]))
    assert r.status_code == 409 and "delete it instead" in r.json()["detail"]
    assert client.delete(f"{API}/documents/{draft['id']}", headers=auth(team["other"])).status_code == 403
    assert client.delete(f"{API}/documents/{draft['id']}", headers=auth(team["author"])).status_code == 200
    assert client.get(f"{API}/documents/{draft['id']}", headers=auth(team["author"])).status_code == 404

    doc = create_doc(client, team)
    release(client, team, rev(doc, "R0")["id"])
    r = client.delete(f"{API}/documents/{doc['id']}", headers=auth(team["author"]))
    assert r.status_code == 409 and "Mark it obsolete instead" in r.json()["detail"]
    r = client.post(f"{API}/documents/{doc['id']}/obsolete", json={"reason": "Replaced by new frame"}, headers=auth(team["checker"]))
    assert r.status_code == 403
    r = client.post(f"{API}/documents/{doc['id']}/obsolete", json={"reason": "Replaced by new frame"}, headers=auth(team["author"]))
    assert r.status_code == 200 and r.json()["display_status"] == "obsolete"
    r = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Revive"}, headers=auth(team["author"]))
    assert r.status_code == 409 and "obsolete" in r.json()["detail"]
    r = client.patch(f"{API}/documents/{doc['id']}", json={"title": "New title"}, headers=auth(team["author"]))
    assert r.status_code == 409
    assert client.post(f"{API}/documents/{doc['id']}/reactivate", headers=auth(team["author"])).status_code == 403
    r = client.post(f"{API}/documents/{doc['id']}/reactivate", headers=auth(team["admin"]))
    assert r.status_code == 200 and r.json()["display_status"] == "released"


def test_update_details_and_register_filters(client, team):
    doc = create_doc(client, team)
    r = client.patch(f"{API}/documents/{doc['id']}", json={"title": "Bogie frame GA — Type B", "discipline": "structural"}, headers=auth(team["author"]))
    assert r.status_code == 200
    assert r.json()["title"] == "Bogie frame GA — Type B"
    assert r.json()["events"][0]["action"] == "details_updated"
    r = client.patch(f"{API}/documents/{doc['id']}", json={"discipline": "plumbing"}, headers=auth(team["author"]))
    assert r.status_code == 400 and "valid discipline" in r.json()["detail"]
    create_doc(client, team, title="Brake schematic", document_type="schematic", discipline="hydraulic")

    rows = client.get(f"{API}/documents", params={"discipline": "hydraulic"}, headers=auth(team["other"])).json()
    assert [d["title"] for d in rows] == ["Brake schematic"]
    rows = client.get(f"{API}/documents", params={"search": "type b"}, headers=auth(team["other"])).json()
    assert len(rows) == 1 and rows[0]["pending_with_name"] == "author"
    rows = client.get(f"{API}/documents", params={"status": "released"}, headers=auth(team["other"])).json()
    assert rows == []


# ---------------------------------------------------------------------------
# ECN
# ---------------------------------------------------------------------------

def test_ecn_flow_through_implementation(client, db, team):
    make_user(db, "prod@premnathrail.com", apps=("production",))
    doc = create_doc(client, team)
    release(client, team, rev(doc, "R0")["id"])
    raiser, h = team["other"], auth(team["other"])

    r = client.post(f"{API}/change-notices", json={
        "title": "Increase gusset thickness", "reason": "quality_issue", "priority": "high",
        "documents": [{"document_id": doc["id"], "change_description": "Gusset 10 → 12 mm"}],
    }, headers=h)
    assert r.status_code == 201, r.text
    ecn = r.json()
    assert ecn["ecn_number"].startswith("ECN-") and ecn["status"] == "draft"

    r = client.post(f"{API}/change-notices/{ecn['id']}/submit", headers=h)
    assert r.status_code == 400 and "Name an approver" in r.json()["detail"]
    r = client.patch(f"{API}/change-notices/{ecn['id']}", json={"approver_id": raiser.id}, headers=h)
    assert r.status_code == 400
    client.patch(f"{API}/change-notices/{ecn['id']}", json={"approver_id": team["approver"].id}, headers=h)
    assert client.post(f"{API}/change-notices/{ecn['id']}/submit", headers=h).status_code == 200

    # Can't raise a revision under an ECN that isn't approved yet.
    r = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Per ECN", "ecn_id": ecn["id"]}, headers=auth(team["author"]))
    assert r.status_code == 400 and "approved" in r.json()["detail"]

    assert client.post(f"{API}/change-notices/{ecn['id']}/approve", json={}, headers=h).status_code == 403
    r = client.post(f"{API}/change-notices/{ecn['id']}/approve", json={"comment": "Go ahead"}, headers=auth(team["approver"]))
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert client.get(f"{API}/documents/{doc['id']}", headers=auth(team["author"])).json()["open_ecns"][0]["id"] == ecn["id"]

    r = client.post(f"{API}/change-notices/{ecn['id']}/implement", headers=h)
    assert r.status_code == 409 and doc["doc_number"] in r.json()["detail"] and "no revision raised yet" in r.json()["detail"]

    detail = client.post(f"{API}/documents/{doc['id']}/revisions", json={
        "change_summary": "Gusset thickened per ECN", "ecn_id": ecn["id"],
        "reviewer_id": team["checker"].id, "approver_id": team["approver"].id,
    }, headers=auth(team["author"])).json()
    r1 = rev(detail, "R1")
    assert r1["ecn_number"] == ecn["ecn_number"]
    r = client.post(f"{API}/change-notices/{ecn['id']}/implement", headers=h)
    assert r.status_code == 409 and "R1 is draft" in r.json()["detail"]

    release(client, team, r1["id"])
    r = client.post(f"{API}/change-notices/{ecn['id']}/implement", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "implemented"
    assert body["documents"][0]["implementation_status"] == "released"
    assert body["released_count"] == 1
    assert "document_released" in [e["action"] for e in body["events"]]


def test_ecn_reject_needs_reason_and_cancel(client, team):
    doc = create_doc(client, team)
    h = auth(team["other"])
    ecn = client.post(f"{API}/change-notices", json={
        "title": "Cheaper bracket", "reason": "cost_reduction", "approver_id": team["approver"].id,
        "documents": [{"document_id": doc["id"]}],
    }, headers=h).json()
    client.post(f"{API}/change-notices/{ecn['id']}/submit", headers=h)
    r = client.post(f"{API}/change-notices/{ecn['id']}/reject", json={}, headers=auth(team["approver"]))
    assert r.status_code == 400
    r = client.post(f"{API}/change-notices/{ecn['id']}/reject", json={"comment": "Fatigue risk"}, headers=auth(team["approver"]))
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    r = client.post(f"{API}/change-notices/{ecn['id']}/cancel", json={"reason": "Changed mind"}, headers=h)
    assert r.status_code == 409

    ecn2 = client.post(f"{API}/change-notices", json={"title": "Another idea", "documents": []}, headers=h).json()
    r = client.post(f"{API}/change-notices/{ecn2['id']}/submit", headers=h)
    assert r.status_code == 400 and "affected documents" in r.json()["detail"]
    r = client.post(f"{API}/change-notices/{ecn2['id']}/cancel", json={"reason": "Duplicate"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert client.delete(f"{API}/change-notices/{ecn2['id']}", headers=h).status_code == 409


# ---------------------------------------------------------------------------
# Dashboard, reports, lookups, access
# ---------------------------------------------------------------------------

def test_dashboard_reports_and_export(client, team):
    doc = create_doc(client, team)
    release(client, team, rev(doc, "R0")["id"])
    other = create_doc(client, team, title="Hydraulic schematic", document_type="schematic")
    upload(client, team["author"], rev(other, "R0")["id"])
    client.post(f"{API}/revisions/{rev(other, 'R0')['id']}/submit", json={}, headers=auth(team["author"]))

    dash = client.get(f"{API}/dashboard", headers=auth(team["checker"])).json()
    assert dash["active_documents"] == 2
    assert dash["released_documents"] == 1
    assert dash["in_review"] == 1
    assert dash["released_this_month"] == 1
    assert dash["waiting_on_me"] == 1
    assert dash["recent_releases"][0]["doc_number"] == doc["doc_number"]

    summary = client.get(f"{API}/reports/summary", headers=auth(team["other"])).json()
    assert summary["total_revisions_released"] == 1
    assert len(summary["releases_by_month"]) == 12

    r = client.get(f"{API}/reports/master-document-list", headers=auth(team["other"]))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    text = r.content.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("Doc Number,Title")
    assert doc["doc_number"] in text and "checker" in text


def test_release_is_on_the_audit_trail(client, db, team):
    from app.modules.main.models.audit_log import AuditLog

    doc = create_doc(client, team)
    rid = rev(doc, "R0")["id"]
    release(client, team, rid)
    db.expire_all()
    # Revisions are audited as children of their document (parent_attr in
    # audit_registry), so every status move shows on the document's trail.
    logs = db.query(AuditLog).filter(AuditLog.entity_type == "design_document", AuditLog.entity_id == doc["id"]).all()
    assert "created" in {a.action for a in logs}
    moves = [(json.loads(a.new_value or "{}").get("status"), a.performed_by_id) for a in logs if a.action == "revision_updated"]
    assert {s for s, _ in moves} >= {"in_review", "in_approval", "released"}
    assert ("released", team["approver"].id) in moves


def test_lookup_users_only_design_holders(client, db, team):
    make_user(db, "crm-only@premnathrail.com", apps=("crm",))
    emails = {u["extra"] for u in client.get(f"{API}/lookups/users", headers=auth(team["author"])).json()}
    assert "author@premnathrail.com" in emails and "crm-only@premnathrail.com" not in emails


def test_requires_design_app(client, db):
    outsider = make_user(db, "crm@premnathrail.com", apps=("crm",))
    assert client.get(f"{API}/documents", headers=auth(outsider)).status_code == 403
    assert client.get(f"{API}/dashboard", headers=auth(outsider)).status_code == 403
