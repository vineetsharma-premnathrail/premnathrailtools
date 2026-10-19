"""Assign-to rules (core/assignee_rules.py) on the HR pickers: safety
investigation lead, CAPA action owner and lifecycle checklist task owner."""
from datetime import timedelta

from app.modules.main.models.role import Role
from app.tests.test_cov_hr_lifecycle import LC, leaver_world, masters, raise_exit  # noqa: F401
from app.tests.test_cov_hr_support import TODAY, frozen_hr_clock, hdr  # noqa: F401
from app.tests.test_hr_safety_time_eval import EHS, S, _freeze_more, _report, ehs  # noqa: F401


def _give_role(db, user, permissions, rules):
    role = Role(name=f"Rule role {user.id}", permissions=list(permissions), assignee_rules=rules)
    db.add(role)
    db.commit()
    user.roles = [role]
    db.commit()


def test_safety_lead_and_capa_owner_follow_the_role_rule(client, db, ehs):
    w = ehs
    _give_role(db, w["officer"], EHS, {
        "hr:safety.investigation": {"mode": "custom", "users": [w["lead"].id]},
        "hr:safety.capa": {"mode": "custom", "users": [w["owner"].id]},
    })
    iid = _report(client, w["welder"], w["plant"]).json()["id"]
    r = client.post(f"{S}/incidents/{iid}/start-investigation", json={"investigation_lead_id": w["welder"].id}, headers=hdr(w["officer"]))
    assert r.status_code == 403 and "Investigation lead" in r.json()["detail"]
    r = client.post(f"{S}/incidents/{iid}/start-investigation", json={"investigation_lead_id": w["lead"].id}, headers=hdr(w["officer"]))
    assert r.status_code == 200, r.text

    due = (TODAY + timedelta(days=7)).isoformat()
    body = {"action_type": "corrective", "description": "Restore the interlock", "due_date": due}
    r = client.post(f"{S}/incidents/{iid}/actions", json={**body, "owner_id": w["welder"].id}, headers=hdr(w["officer"]))
    assert r.status_code == 403 and "CAPA action owner" in r.json()["detail"]
    r = client.post(f"{S}/incidents/{iid}/actions", json={**body, "owner_id": w["owner"].id}, headers=hdr(w["officer"]))
    assert r.status_code == 200, r.text
    action_id = r.json()["actions"][0]["id"]
    r = client.patch(f"{S}/incidents/{iid}/actions/{action_id}", json={"owner_id": w["welder"].id}, headers=hdr(w["officer"]))
    assert r.status_code == 403
    # Re-saving with the same owner is not a re-assignment.
    r = client.patch(f"{S}/incidents/{iid}/actions/{action_id}", json={"owner_id": w["owner"].id, "description": "Restore + lock bypass key"},
                     headers=hdr(w["officer"]))
    assert r.status_code == 200, r.text


def test_checklist_owner_follows_the_role_rule(client, db, leaver_world):
    w = leaver_world
    ev = raise_exit(client, w)
    _give_role(db, w["hr"], ["hr:lifecycle:view", "hr:lifecycle:create", "hr:lifecycle:edit"],
               {"hr:lifecycle.checklist": {"mode": "self"}})
    r = client.post(f"{LC}/events/{ev['id']}/items", json={"category": "it", "title": "Disable VPN", "owner_user_id": w["successor"].id},
                    headers=hdr(w["hr"]))
    assert r.status_code == 403 and "Checklist task owner" in r.json()["detail"]
    r = client.post(f"{LC}/events/{ev['id']}/items", json={"category": "it", "title": "Disable VPN", "owner_user_id": w["hr"].id},
                    headers=hdr(w["hr"]))
    assert r.status_code == 200, r.text
    r = client.patch(f"{LC}/items/{r.json()['id']}", json={"owner_user_id": w["successor"].id}, headers=hdr(w["hr"]))
    assert r.status_code == 403
