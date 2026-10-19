"""Design feature permissions (core/features/design.py, modules/design/features.py).

Keep current access: the feature gate applies only to users who hold the
tab's View. A change-board voter without the Changes tab keeps voting
(only the record-level rule "you're on this ECR's board" applies); a voter
whose role holds the Changes tab but was customised without the vote
feature gets a real 403."""
import re
from pathlib import Path

import pytest

from app.core.permission_registry import all_permission_ids, feature_id
from app.tests.test_cov_design_changes import _ecr
from app.tests.test_cov_design_support import API, auth, fake_sharepoint, make_team, make_user, released_doc, set_team  # noqa: F401

pytestmark = pytest.mark.usefixtures("fake_sharepoint")


@pytest.fixture
def board(client, db):
    team = make_team(db)
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head"})
    return team


def _impact(client, team, ecr_id, board_ids):
    r = client.post(f"{API}/change-requests/{ecr_id}/impact",
                    json={"impact_summary": "Two frames in WIP", "board_member_ids": board_ids}, headers=auth(team["author"]))
    assert r.status_code == 200, r.text


def test_board_voter_without_changes_tab_can_still_vote(client, db, board):
    team = board
    # Holds the Design app through the Drawings tab only — no Changes tab.
    voter = make_user(db, "feat.voter@premnathrail.com", grants=["design:documents:view"])
    team["prod"] = voter
    doc = released_doc(client, team)
    ecr = _ecr(client, team, [{"document_id": doc["id"]}], who="author").json()
    _impact(client, team, ecr["id"], [voter.id])
    r = client.get(f"{API}/change-requests/{ecr['id']}", headers=auth(voter))
    assert r.status_code == 200, r.text
    assert "vote" in r.json()["allowed_actions"]
    assert r.json()["board_members"], "board stays visible without the tab (no feature gate)"
    r = client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "approve"}, headers=auth(voter))
    assert r.status_code == 200, r.text


def test_customised_role_without_vote_feature_gets_real_403(client, db, board):
    team = board
    # Holds the Changes tab, customised to the impact feature only.
    voter = make_user(db, "feat.novote@premnathrail.com",
                      grants=["design:change_notices:view", "design:change_notices.ecr_impact:view"])
    doc = released_doc(client, team)
    ecr = _ecr(client, team, [{"document_id": doc["id"]}], who="author").json()
    _impact(client, team, ecr["id"], [voter.id])
    r = client.get(f"{API}/change-requests/{ecr['id']}", headers=auth(voter))
    assert r.status_code == 200 and "vote" not in r.json()["allowed_actions"]
    assert r.json()["board_members"] == []
    r = client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "approve"}, headers=auth(voter))
    assert r.status_code == 403
    assert "design:change_notices.ecr_vote:submit" in r.json()["detail"]


def test_cost_impact_hidden_and_kept_without_sensitive_feature(client, db, board):
    team = board
    doc = released_doc(client, team)
    ecr = _ecr(client, team, [{"document_id": doc["id"]}], who="author").json()
    r = client.post(f"{API}/change-requests/{ecr['id']}/impact",
                    json={"impact_summary": "Rework", "impact_cost": 25000, "board_member_ids": []}, headers=auth(team["author"]))
    assert r.status_code == 200 and r.json()["impact_cost"] == 25000
    viewer = make_user(db, "feat.nocost@premnathrail.com",
                       grants=["design:change_notices:view", "design:change_notices.ecr_vote:view"])
    r = client.get(f"{API}/change-requests/{ecr['id']}", headers=auth(viewer))
    assert r.status_code == 200 and r.json()["impact_cost"] is None
    listed = client.get(f"{API}/change-requests", headers=auth(viewer)).json()
    assert all(e["impact_cost"] is None for e in listed)


def test_every_literal_design_feature_call_is_declared():
    """Design routes call ensure_design_feature / has(user, "<tab>", "<feature>", "<action>")
    instead of the core helpers, so check their literals here."""
    declared = all_permission_ids()
    root = Path(__file__).resolve().parents[1] / "modules" / "design"
    pat = re.compile(r'(?:ensure_design_feature|has)\(\s*\w+,\s*"(\w+)",\s*"(\w+)"(?:,\s*"(\w+)")?\)')
    found = 0
    for path in root.rglob("*.py"):
        for tab, feat, action in pat.findall(path.read_text(encoding="utf-8")):
            found += 1
            fid = feature_id("design", tab, feat, action or "view")
            assert fid in declared, f"{path.name}: {fid} is not declared in core/features/design.py"
    assert found > 40


def test_ecr_raised_reaches_subscribed_role_not_heads_twice(client, db, board):
    """Role-based notice (core/events/design.py): a member of a role
    subscribed to design.ecr_raised who holds the impact feature hears about a
    new ECR; the Design head (told directly) isn't notified twice."""
    from app.modules.main.models.notification import Notification
    from app.modules.main.models.role import Role

    team = board
    role = Role(name="ECR impact checkers", permissions=["design:change_notices:view", "design:change_notices:edit",
                                                         "design:documents:view"],
                notification_events={"design.ecr_raised": ["bell"]})
    db.add(role)
    db.flush()
    checker = make_user(db, "feat.impact@premnathrail.com")
    checker.roles = [role]
    team["approver"].roles = [role]  # the head — already notified directly
    db.commit()
    set_team(client, {**team, "impact": checker}, {"author": "designer", "checker": "reviewer", "approver": "head", "impact": "designer"})
    doc = released_doc(client, team)
    ecr = _ecr(client, team, [{"document_id": doc["id"]}], who="author")
    assert ecr.status_code == 201, ecr.text
    rows = db.query(Notification).filter(Notification.entity_type == "design_ecr", Notification.entity_id == ecr.json()["id"]).all()
    by_user = {}
    for n in rows:
        by_user.setdefault(n.user_id, []).append(n.title)
    assert checker.id in by_user, by_user
    assert len(by_user.get(team["approver"].id, [])) == 1, by_user
