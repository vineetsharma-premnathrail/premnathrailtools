"""Design review fixes (2026-10-07): legacy direct-ECN gate, Teams on
approval requests, dead-end states (R1 after customer rejection, approved
ECN that can't finish), viewer visibility in reports/submissions,
discipline document types, BOM overdue reminders and request
project/milestone consistency."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.modules.design.models.bom import DesignBomRevision
from app.modules.main.models.notification import Notification
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.tests.test_cov_design_support import (
    API, auth, create_bom, create_doc, fake_sharepoint, item, make_team, make_user, release, released_doc, rev, set_team,
    to_approval, upload,
)

pytestmark = pytest.mark.usefixtures("fake_sharepoint")


@pytest.fixture
def team(db):
    t = make_team(db)
    t["prod"] = make_user(db, "fix.prod@premnathrail.com", apps=("design", "production"))
    return t


def _set_board(client, team):
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head", "other": "designer"})


# ---------------------------------------------------------------------------
# 1. Legacy direct ECN
# ---------------------------------------------------------------------------

def test_direct_ecn_is_team_only_and_approver_must_be_head(client, team):
    doc = released_doc(client, team)
    _set_board(client, team)
    body = {"title": "Thicker gusset", "documents": [{"document_id": doc["id"]}]}

    r = client.post(f"{API}/change-notices", json=body, headers=auth(team["prod"]))
    assert r.status_code == 403 and "raise an ECR (change request) instead" in r.json()["detail"]

    r = client.post(f"{API}/change-notices", json={**body, "approver_id": team["checker"].id}, headers=auth(team["author"]))
    assert r.status_code == 400 and "ECN approver must be the Design head" in r.json()["detail"]

    ecn = client.post(f"{API}/change-notices", json=body, headers=auth(team["author"])).json()
    r = client.patch(f"{API}/change-notices/{ecn['id']}", json={"approver_id": team["checker"].id}, headers=auth(team["author"]))
    assert r.status_code == 400 and "Design head" in r.json()["detail"]
    r = client.patch(f"{API}/change-notices/{ecn['id']}", json={"approver_id": team["approver"].id}, headers=auth(team["author"]))
    assert r.status_code == 200
    assert client.post(f"{API}/change-notices/{ecn['id']}/submit", headers=auth(team["author"])).status_code == 200


def test_submit_rechecks_approver_role(client, team):
    """An approver named before the team existed is re-checked on submit."""
    doc = released_doc(client, team)
    ecn = client.post(f"{API}/change-notices", json={
        "title": "Gusset", "documents": [{"document_id": doc["id"]}], "approver_id": team["checker"].id,
    }, headers=auth(team["author"])).json()
    _set_board(client, team)
    r = client.post(f"{API}/change-notices/{ecn['id']}/submit", headers=auth(team["author"]))
    assert r.status_code == 400 and "the ECN approver must be the Design head" in r.json()["detail"]


# ---------------------------------------------------------------------------
# 2. Teams on approval requests only
# ---------------------------------------------------------------------------

def test_approval_requests_go_to_teams(client, team, monkeypatch):
    calls: list[tuple[str, bool]] = []

    def record(db, user_id, title, message, notification_type, entity_type=None, entity_id=None, teams=False):
        calls.append((notification_type, teams))

    monkeypatch.setattr("app.modules.design.service.notify_user", record)
    # Check / approval requests now come from the central approval engine.
    monkeypatch.setattr("app.utils.notifications.notify_user", record)
    doc = create_doc(client, team)
    to_approval(client, team, rev(doc, "R0")["id"])
    r = client.post(f"{API}/revisions/{rev(doc, 'R0')['id']}/approve", json={"decision": "return", "comment": "Fix title block"},
                    headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    # Two approval requests (checker, then approver) go to Teams.
    assert [teams for kind, teams in calls if kind == "approval" and teams] == [True, True]
    # Returned / released notices stay bell-only.
    assert all(not teams for kind, teams in calls if kind != "approval")


# ---------------------------------------------------------------------------
# 3. Dead-end states
# ---------------------------------------------------------------------------

def test_r1_after_customer_rejection_can_be_discarded(client, team):
    doc = create_doc(client, team, customer_approval_required=True)
    r0 = rev(doc, "R0")["id"]
    release(client, team, r0)
    h = auth(team["admin"])
    sub = client.post(f"{API}/submissions", json={"customer_name": "ICF", "lines": [{"revision_id": r0}]}, headers=h).json()
    sent = client.post(f"{API}/submissions/{sub['id']}/send", json={}, headers=h).json()
    client.post(f"{API}/submissions/{sub['id']}/response", json={
        "response_date": date.today().isoformat(),
        "lines": [{"line_id": sent["lines"][0]["id"], "response": "rejected", "comment": "Wrong bolt grade"}],
    }, headers=h)
    d = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Bolt grade 8.8"}, headers=auth(team["author"])).json()
    r1 = rev(d, "R1")
    assert "discard_revision" in client.get(f"{API}/documents/{doc['id']}", headers=auth(team["author"])).json()["allowed_actions"]
    r = client.delete(f"{API}/revisions/{r1['id']}", headers=auth(team["author"]))
    assert r.status_code == 200, r.text
    assert [x["revision_label"] for x in r.json()["revisions"]] == ["R0"]


def _approved_direct_ecn(client, team, doc):
    ecn = client.post(f"{API}/change-notices", json={
        "title": "Gusset", "documents": [{"document_id": doc["id"]}], "approver_id": team["approver"].id,
    }, headers=auth(team["other"])).json()
    assert client.post(f"{API}/change-notices/{ecn['id']}/submit", headers=auth(team["other"])).status_code == 200
    r = client.post(f"{API}/change-notices/{ecn['id']}/approve", json={}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    return r.json()


def test_approved_ecn_can_be_cancelled_until_something_is_released(client, team):
    doc = released_doc(client, team)
    ecn = _approved_direct_ecn(client, team, doc)
    _set_board(client, team)
    d = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Per ECN", "ecn_id": ecn["id"]},
                    headers=auth(team["author"])).json()
    assert d["revisions"]
    # A designer who didn't raise it can't; the Design head can.
    r = client.post(f"{API}/change-notices/{ecn['id']}/cancel", json={"reason": "Drawing withdrawn"}, headers=auth(team["author"]))
    assert r.status_code == 403
    detail = client.get(f"{API}/change-notices/{ecn['id']}", headers=auth(team["approver"])).json()
    assert "cancel" in detail["allowed_actions"]
    r = client.post(f"{API}/change-notices/{ecn['id']}/cancel", json={"reason": "Drawing withdrawn"}, headers=auth(team["approver"]))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


def test_approved_ecn_with_released_revision_cannot_be_cancelled(client, team):
    doc = released_doc(client, team)
    ecn = _approved_direct_ecn(client, team, doc)
    d = client.post(f"{API}/documents/{doc['id']}/revisions", json={
        "change_summary": "Per ECN", "ecn_id": ecn["id"], "reviewer_id": team["checker"].id, "approver_id": team["approver"].id,
    }, headers=auth(team["author"])).json()
    release(client, team, rev(d, "R1")["id"])
    detail = client.get(f"{API}/change-notices/{ecn['id']}", headers=auth(team["other"])).json()
    assert "cancel" not in detail["allowed_actions"]
    r = client.post(f"{API}/change-notices/{ecn['id']}/cancel", json={"reason": "Changed mind"}, headers=auth(team["other"]))
    assert r.status_code == 409 and f"{doc['doc_number']} R1 is already released" in r.json()["detail"]


# ---------------------------------------------------------------------------
# 4. Viewer visibility in reports / submissions
# ---------------------------------------------------------------------------

def test_viewers_see_only_released_in_reports_and_no_submissions(client, team):
    released = released_doc(client, team, title="Released one")
    draft = create_doc(client, team, title="Draft one")
    _set_board(client, team)
    viewer = auth(team["prod"])

    csv = client.get(f"{API}/reports/master-document-list", headers=viewer).text
    assert released["doc_number"] in csv and draft["doc_number"] not in csv
    team_csv = client.get(f"{API}/reports/master-document-list", headers=auth(team["author"])).text
    assert draft["doc_number"] in team_csv

    summary = client.get(f"{API}/reports/summary", headers=viewer).json()
    assert sum(row["count"] for row in summary["by_status"]) == 1

    r = client.get(f"{API}/reports/revision-history", params={"document_id": draft["id"]}, headers=viewer)
    assert r.status_code == 404 and "Design team" in r.json()["detail"]
    client.post(f"{API}/documents/{released['id']}/revisions", json={"change_summary": "WIP"}, headers=auth(team["author"]))
    hist = client.get(f"{API}/reports/revision-history", params={"document_id": released["id"]}, headers=viewer).json()
    assert [x["revision_label"] for x in hist["revisions"]] == ["R0"]

    r = client.get(f"{API}/submissions", headers=viewer)
    assert r.status_code == 403 and "see customer submissions" in r.json()["detail"]
    assert client.get(f"{API}/submissions", headers=auth(team["author"])).status_code == 200


# ---------------------------------------------------------------------------
# 5. Discipline document types
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("doc_type,prefix", [
    ("wiring_diagram", "WD-"), ("harness_drawing", "HRN-"), ("hydraulic_circuit", "HYC-"),
    ("pneumatic_circuit", "PNC-"), ("panel_layout", "PNL-"),
])
def test_discipline_document_types(client, team, doc_type, prefix):
    doc = create_doc(client, team, document_type=doc_type, discipline="electrical")
    assert doc["doc_number"].startswith(prefix)


# ---------------------------------------------------------------------------
# 6. BOM overdue reminders + dashboard
# ---------------------------------------------------------------------------

def test_bom_stuck_in_review_gets_reminder_and_dashboard_flag(client, db, team):
    from app.tasks.design_reminders import run_design_reminders

    product, part = item(db, "FIX-ASM-01"), item(db, "FIX-PRT-01")
    r = create_bom(client, team, product, [{"store_item_id": part.id, "quantity": 2}])
    assert r.status_code == 201, r.text
    bom = r.json()
    rev_id = bom["revisions"][0]["id"]
    r = client.post(f"{API}/boms/revisions/{rev_id}/submit",
                    json={"reviewer_id": team["checker"].id, "approver_id": team["approver"].id}, headers=auth(team["author"]))
    assert r.status_code == 200, r.text
    row = db.query(DesignBomRevision).filter(DesignBomRevision.id == rev_id).first()
    row.submitted_at = datetime.now(timezone.utc) - timedelta(days=10)
    db.commit()

    dash = client.get(f"{API}/dashboard", headers=auth(team["author"])).json()
    assert any(t.get("bom_id") == bom["id"] for t in dash["overdue"]) and dash["overdue_in_workflow"] >= 1

    db.expire_all()
    assert run_design_reminders(db, date.today()) >= 1
    db.commit()
    assert db.query(Notification).filter(
        Notification.user_id == team["checker"].id, Notification.entity_type == "design_bom", Notification.entity_id == bom["id"],
        Notification.notification_type == "design_review_overdue",
    ).count() == 1


# ---------------------------------------------------------------------------
# 7. Request project / milestone consistency
# ---------------------------------------------------------------------------

def test_request_milestone_must_match_project(client, db, team):
    p1 = PmProject(project_code="FIX-P1", name="Project one")
    p2 = PmProject(project_code="FIX-P2", name="Project two")
    db.add_all([p1, p2])
    db.flush()
    m1 = PmProjectMilestone(project_id=p1.id, title="Design freeze", target_date=date.today() + timedelta(days=30))
    db.add(m1)
    db.commit()
    h = auth(team["author"])
    base = {"title": "Frame redesign", "requirement": "New frame for RRV"}

    r = client.post(f"{API}/requests", json={**base, "pm_milestone_id": m1.id}, headers=h)
    assert r.status_code == 400 and "pick the project first" in r.json()["detail"]
    r = client.post(f"{API}/requests", json={**base, "pm_project_id": p1.id, "pm_milestone_id": m1.id}, headers=h)
    assert r.status_code == 201, r.text
    req = r.json()

    r = client.patch(f"{API}/requests/{req['id']}", json={"pm_project_id": p2.id}, headers=h)
    assert r.status_code == 400 and "belongs to a different project" in r.json()["detail"]
    r = client.patch(f"{API}/requests/{req['id']}", json={"pm_project_id": p2.id, "pm_milestone_id": None}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["pm_milestone_id"] is None
