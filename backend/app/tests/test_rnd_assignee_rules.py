"""Assign-to rules (core/assignee_rules.py) on the R&D pickers beyond tasks:
project lead & team (rnd:projects.team) and experiment 'Conducted by'
(rnd:experiments.conducted_by)."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.role import Role
from app.modules.main.models.user import User

BASE = "/api/v1/rnd"
GRANTS = ["rnd:projects:view", "rnd:projects:create", "rnd:projects:edit",
          "rnd:experiments:view", "rnd:experiments:create", "rnd:experiments:edit"]


def _user(db, email, rules=None):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True,
             assigned_apps=["rnd"], granular_permissions=[])
    db.add(u)
    db.commit()
    if rules is not None:
        role = Role(name=f"Role {email}", permissions=GRANTS, assignee_rules=rules)
        db.add(role)
        db.commit()
        u.roles = [role]
        db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _project(client, u):
    r = client.post(f"{BASE}/projects", headers=_h(u), json={"title": "Bogie", "objective": "Lighter", "origin": "new_development", "origin_note": "Proposed by R&D head", "attachment_count": 1})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_project_team_rule_blocks_outsiders_on_create_and_update(client, db):
    mate = _user(db, "mate@premnathrail.com")
    outsider = _user(db, "outsider@premnathrail.com")
    lead = _user(db, "lead@premnathrail.com", {"rnd:projects.team": {"mode": "custom", "users": [mate.id]}})

    r = client.post(f"{BASE}/projects", headers=_h(lead),
                    json={"title": "Bogie", "objective": "Lighter", "team_member_ids": [outsider.id], "origin": "new_development", "origin_note": "Proposed by R&D head", "attachment_count": 1})
    assert r.status_code == 403 and "Pick project lead & team" in r.json()["detail"]

    # Yourself as lead + an allowed member is fine.
    r = client.post(f"{BASE}/projects", headers=_h(lead),
                    json={"title": "Bogie", "objective": "Lighter", "lead_ids": [lead.id], "team_member_ids": [mate.id], "origin": "new_development", "origin_note": "Proposed by R&D head", "attachment_count": 1})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]

    r = client.patch(f"{BASE}/projects/{pid}", headers=_h(lead), json={"team_member_ids": [mate.id, outsider.id]})
    assert r.status_code == 403
    # Re-saving people already on the project is never refused.
    r = client.patch(f"{BASE}/projects/{pid}", headers=_h(lead), json={"team_member_ids": [mate.id], "title": "Bogie 2"})
    assert r.status_code == 200, r.text


def test_experiment_conducted_by_rule(client, db):
    mate = _user(db, "mate2@premnathrail.com")
    outsider = _user(db, "outsider2@premnathrail.com")
    eng = _user(db, "eng@premnathrail.com", {"rnd:experiments.conducted_by": {"mode": "custom", "users": [mate.id]}})
    pid = _project(client, eng)

    r = client.post(f"{BASE}/experiments", headers=_h(eng), json={"project_id": pid, "title": "Load test", "conducted_by_id": outsider.id})
    assert r.status_code == 403 and "Assign experiment to" in r.json()["detail"]
    r = client.post(f"{BASE}/experiments", headers=_h(eng), json={"project_id": pid, "title": "Load test"})
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    assert r.json()["conducted_by_id"] == eng.id

    assert client.patch(f"{BASE}/experiments/{eid}", headers=_h(eng), json={"conducted_by_id": outsider.id}).status_code == 403
    assert client.patch(f"{BASE}/experiments/{eid}", headers=_h(eng), json={"conducted_by_id": mate.id}).status_code == 200
    assert client.patch(f"{BASE}/experiments/{eid}", headers=_h(eng), json={"conducted_by_id": 999999}).status_code == 404


def test_no_rule_means_anyone(client, db):
    other = _user(db, "other3@premnathrail.com")
    eng = _user(db, "free@premnathrail.com", {})
    r = client.post(f"{BASE}/experiments", headers=_h(eng),
                    json={"project_id": _project(client, eng), "title": "T", "conducted_by_id": other.id})
    assert r.status_code == 200, r.text
