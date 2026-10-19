"""Role "Assign to" rules (core/assignee_rules.py) enforced in Design,
Electrical and Hydraulic & Pneumatic: a person outside the rule is refused
on save with the real reason; someone inside it, and unchanged values,
still go through."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.role import Role
from app.modules.main.models.user import User


def _user(db, email, apps):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True, assigned_apps=list(apps))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _give_role(db, user, permissions, rules):
    role = Role(name=f"Narrow {user.id}", permissions=list(permissions), assignee_rules=rules)
    db.add(role)
    db.commit()
    user.roles = [role]
    db.commit()


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def test_electrical_lead_engineer_and_stage_owner_follow_the_rule(client, db):
    lead = _user(db, "lead@premnathrail.com", ("electrical",))
    other = _user(db, "other@premnathrail.com", ("electrical",))
    _give_role(db, lead, ["electrical:*:*"], {
        "electrical:jobs.lead_engineer": {"mode": "self"}, "electrical:jobs.stages": {"mode": "self"},
    })
    h = _auth(lead)

    r = client.post("/api/v1/electrical/jobs", json={"title": "RRV-450", "lead_engineer_id": other.id}, headers=h)
    assert r.status_code == 403, r.text
    assert "Assign lead engineer" in r.json()["detail"]

    r = client.post("/api/v1/electrical/jobs", json={"title": "RRV-450", "lead_engineer_id": lead.id}, headers=h)
    assert r.status_code == 200, r.text
    job = r.json()

    # Re-saving the same lead is not a change, so it is never re-checked.
    r = client.patch(f"/api/v1/electrical/jobs/{job['id']}", json={"lead_engineer_id": lead.id}, headers=h)
    assert r.status_code == 200, r.text
    r = client.patch(f"/api/v1/electrical/jobs/{job['id']}", json={"lead_engineer_id": other.id}, headers=h)
    assert r.status_code == 403

    r = client.patch(f"/api/v1/electrical/jobs/{job['id']}/stages/requirement", json={"assignee_id": other.id}, headers=h)
    assert r.status_code == 403
    assert "Assign stages to" in r.json()["detail"]
    r = client.patch(f"/api/v1/electrical/jobs/{job['id']}/stages/requirement", json={"assignee_id": lead.id}, headers=h)
    assert r.status_code == 200, r.text


def test_design_document_owner_and_checker_follow_the_rule(client, db):
    author = _user(db, "author@premnathrail.com", ("design",))
    mate = _user(db, "mate@premnathrail.com", ("design",))
    outsider = _user(db, "outsider@premnathrail.com", ("design",))
    _give_role(db, author, ["design:*:*"], {
        "design:documents.owner": {"mode": "custom", "users": [mate.id]},
        "design:documents.check_release": {"mode": "custom", "users": [mate.id]},
    })
    h = _auth(author)
    base = {"title": "Axle spec", "document_type": "specification"}

    r = client.post("/api/v1/design/documents", json={**base, "reviewer_id": outsider.id}, headers=h)
    assert r.status_code == 403
    assert "Name checker" in r.json()["detail"]
    r = client.post("/api/v1/design/documents", json={**base, "owner_id": outsider.id}, headers=h)
    assert r.status_code == 403
    assert "Set owner to" in r.json()["detail"]

    # Default owner (the creator) isn't a pick, so it isn't checked.
    r = client.post("/api/v1/design/documents", json={**base, "reviewer_id": mate.id}, headers=h)
    assert r.status_code == 201, r.text
    doc = r.json()
    r = client.patch(f"/api/v1/design/documents/{doc['id']}", json={"owner_id": outsider.id}, headers=h)
    assert r.status_code == 403
    r = client.patch(f"/api/v1/design/documents/{doc['id']}", json={"owner_id": mate.id}, headers=h)
    assert r.status_code == 200, r.text


def test_hydraulic_system_owner_follows_the_rule(client, db):
    eng = _user(db, "hyd@premnathrail.com", ("hydraulic",))
    other = _user(db, "hyd2@premnathrail.com", ("hydraulic",))
    _give_role(db, eng, ["hydraulic:*:*"], {"hydraulic:systems.owner": {"mode": "self"}})
    body = {"name": "Boom circuit", "system_type": "hydraulic", "owner_id": other.id}
    r = client.post("/api/v1/hydraulic/systems", json=body, headers=_auth(eng))
    assert r.status_code == 403
    assert "Set owner to" in r.json()["detail"]
    r = client.post("/api/v1/hydraulic/systems", json={**body, "owner_id": eng.id}, headers=_auth(eng))
    assert r.status_code == 200, r.text
