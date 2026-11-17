"""
Tests for the R&D module's project lifecycle (backend/app/modules/rnd/routes/
projects.py, dashboard.py): numbering, stage gates (feasibility → handover →
closed), the Budget & costs switch and the delete guard.
"""
from app.modules.main.models.user import User
from app.auth.jwt_handler import create_access_token

BASE = "/api/v1/rnd"


def make_user(db, email, assigned_apps=None, role="user", granular_permissions=None):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=assigned_apps if assigned_apps is not None else ["rnd"],
        granular_permissions=granular_permissions or [],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def create_project(client, headers, **overrides):
    payload = {"title": "Rail grinder bogie", "objective": "Lighter bogie frame", "budget_amount": 100000, "origin": "new_project", "origin_note": "Proposed by R&D head", "attachment_count": 1, **overrides}
    response = client.post(f"{BASE}/projects", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_projects_require_rnd_app(client, db):
    user = make_user(db, "no-rnd@premnathrail.com", assigned_apps=["erp"])
    assert client.get(f"{BASE}/projects", headers=auth_header(user)).status_code == 403


def test_projects_tab_restricted_by_permission_matrix(client, db):
    # Granted only the Engineering Tools tab — projects must be blocked.
    user = make_user(db, "tools-only@premnathrail.com", granular_permissions=["rnd:all:view"])
    assert client.get(f"{BASE}/projects", headers=auth_header(user)).status_code == 403


def test_create_project_numbers_and_defaults(client, db):
    h = auth_header(make_user(db, "rnd1@premnathrail.com"))
    p1 = create_project(client, h)
    p2 = create_project(client, h, title="Second")
    assert p1["project_number"].startswith("RND-") and p1["project_number"].endswith("-0001")
    assert p2["project_number"].endswith("-0002")
    assert p1["stage"] == "initiation" and p1["status"] == "active"


def test_create_project_rejects_target_before_start(client, db):
    h = auth_header(make_user(db, "rnd2@premnathrail.com"))
    response = client.post(
        f"{BASE}/projects",
        json={"title": "X", "objective": "Y", "start_date": "2026-10-10", "target_end_date": "2026-10-01", "origin": "new_project", "origin_note": "Proposed by R&D head", "attachment_count": 1},
        headers=h,
    )
    assert response.status_code == 400
    assert "before the start date" in response.json()["detail"]


def test_stage_gates(client, db):
    h = auth_header(make_user(db, "rnd3@premnathrail.com"))
    p = create_project(client, h)
    pid = p["id"]

    # Handover blocked without a feasibility recommendation.
    r = client.post(f"{BASE}/projects/{pid}/stage", json={"stage": "handover"}, headers=h)
    assert r.status_code == 400 and "feasibility" in r.json()["detail"].lower()

    # No-Go blocks it too.
    client.put(f"{BASE}/projects/{pid}/feasibility", json={"recommendation": "no_go"}, headers=h)
    r = client.post(f"{BASE}/projects/{pid}/stage", json={"stage": "handover"}, headers=h)
    assert r.status_code == 400 and "No-Go" in r.json()["detail"]

    # Go unlocks handover.
    client.put(f"{BASE}/projects/{pid}/feasibility", json={"recommendation": "go"}, headers=h)
    r = client.post(f"{BASE}/projects/{pid}/stage", json={"stage": "handover"}, headers=h)
    assert r.status_code == 200 and r.json()["stage"] == "handover"
    assert r.json()["handed_over_at"] is not None

    # Close blocked until the handover checklist is complete.
    r = client.post(f"{BASE}/projects/{pid}/stage", json={"stage": "closed"}, headers=h)
    assert r.status_code == 400 and "Approved BOM" in r.json()["detail"]
    client.patch(f"{BASE}/projects/{pid}", json={
        "handover_specs_final": True, "handover_bom_approved": True,
        "handover_process_documented": True, "handover_quality_standards": True,
    }, headers=h)
    r = client.post(f"{BASE}/projects/{pid}/stage", json={"stage": "closed"}, headers=h)
    assert r.status_code == 200 and r.json()["actual_end_date"] is not None

    # Moving backwards is always allowed.
    r = client.post(f"{BASE}/projects/{pid}/stage", json={"stage": "research"}, headers=h)
    assert r.status_code == 200


def test_feasibility_computes_unit_cost_and_margin(client, db):
    h = auth_header(make_user(db, "rnd4@premnathrail.com"))
    pid = create_project(client, h)["id"]
    r = client.put(f"{BASE}/projects/{pid}/feasibility", json={
        "material_cost": 600, "labour_cost": 200, "overhead_cost": 200, "target_selling_price": 1250,
        "costing_rating": "feasible",
    }, headers=h)
    assert r.status_code == 200
    assert r.json()["estimated_unit_cost"] == 1000
    assert r.json()["estimated_margin_pct"] == 20.0
    bad = client.put(f"{BASE}/projects/{pid}/feasibility", json={"sourcing_rating": "maybe"}, headers=h)
    assert bad.status_code == 400


def test_project_delete_guard_and_soft_delete(client, db):
    h = auth_header(make_user(db, "rnd6@premnathrail.com"))
    pid = create_project(client, h)["id"]
    r = client.delete(f"{BASE}/projects/{pid}", headers=h)
    assert r.status_code == 200
    assert client.get(f"{BASE}/projects/{pid}", headers=h).status_code == 404


def test_project_response_has_no_experiment_or_prototype_fields(client, db):
    h = auth_header(make_user(db, "rnd5@premnathrail.com"))
    pid = create_project(client, h)["id"]
    for body in (create_project(client, h, title="Again"), client.get(f"{BASE}/projects/{pid}", headers=h).json()):
        for gone in ("actual_cost", "experiment_count", "prototype_count", "experiments", "prototypes"):
            assert gone not in body, gone


def test_dashboard_summary(client, db):
    h = auth_header(make_user(db, "rnd7@premnathrail.com"))
    create_project(client, h)

    r = client.get(f"{BASE}/dashboard", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert set(data) == {"requirements", "projects", "recent_projects"}
    assert data["projects"]["active"] == 1 and data["projects"]["by_stage"]["initiation"] == 1
    assert [p["title"] for p in data["recent_projects"]] == ["Rail grinder bogie"]


def test_budget_card_follows_budget_and_costs_switch(client, db):
    owner = auth_header(make_user(db, "rnd8@premnathrail.com"))
    pid = create_project(client, owner)["id"]
    # Customised role without the Budget & costs switch, no edit -> the budget is hidden with a flag.
    viewer = auth_header(make_user(db, "rnd8v@premnathrail.com", granular_permissions=["rnd:projects:view", "rnd:projects.team:view"]))
    r = client.get(f"{BASE}/projects/{pid}/budget", headers=viewer)
    assert r.status_code == 200 and r.json()["hidden"] is True and r.json()["summary"] is None
    # The Budget & costs switch shows it without any edit right.
    costs = auth_header(make_user(db, "rnd8c@premnathrail.com", granular_permissions=["rnd:projects:view", "rnd:projects.team:view", "rnd:projects.costs:view"]))
    r = client.get(f"{BASE}/projects/{pid}/budget", headers=costs)
    assert r.status_code == 200 and not r.json().get("hidden")
    assert r.json()["summary"]["budgeted_amount"] == 100000
    # Editing a project implies seeing its budget.
    editor = auth_header(make_user(db, "rnd8e@premnathrail.com", granular_permissions=["rnd:projects:view", "rnd:projects:edit"]))
    r = client.get(f"{BASE}/projects/{pid}/budget", headers=editor)
    assert r.status_code == 200 and not r.json().get("hidden")


# ── Documents ─────────────────────────────────────────────────────────────

def test_documents_upload_list_delete(client, db, monkeypatch):
    from app.core.config import settings
    from app.modules.rnd.routes import documents as doc_routes

    h_owner_user = make_user(db, "rnd9@premnathrail.com")
    h = auth_header(h_owner_user)
    other = auth_header(make_user(db, "rnd10@premnathrail.com"))
    # The uploader leads the project — only leads (and admins) delete its files.
    pid = create_project(client, h, lead_ids=[h_owner_user.id])["id"]
    files = {"files": ("report.pdf", b"%PDF-1.4 test", "application/pdf")}

    # Storage not configured -> clear, actionable 503.
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")
    r = client.post(f"{BASE}/documents", data={"project_id": pid, "title": "Load report"}, files=files, headers=h)
    assert r.status_code == 503 and "SHAREPOINT_SITE_ID" in r.json()["detail"]

    async def fake_upload(site_id, folder_path, upload_file):
        return {"name": upload_file.filename, "path": f"{folder_path}/{upload_file.filename}", "size": 13, "webUrl": "https://sp/x"}

    async def fake_delete(site_id, path):
        return None

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site-1")
    monkeypatch.setattr(doc_routes, "upload_file_to_sharepoint", fake_upload)
    monkeypatch.setattr(doc_routes, "delete_file_from_sharepoint", fake_delete)

    r = client.post(f"{BASE}/documents", data={"project_id": pid, "title": "X", "doc_type": "memo"}, files=files, headers=h)
    assert r.status_code == 400

    r = client.post(f"{BASE}/documents", data={
        "project_id": pid, "title": "Load report", "doc_type": "test_report", "version": "A",
    }, files=files, headers=h)
    assert r.status_code == 200, r.text
    doc = r.json()[0]
    assert doc["file_name"] == "report.pdf" and "experiment_number" not in doc
    assert "RnD-media" in db.query(doc_routes.RndDocument).get(doc["id"]).sharepoint_path

    assert len(client.get(f"{BASE}/documents", params={"project_id": pid}, headers=h).json()) == 1

    # Project with documents can't be deleted.
    r = client.delete(f"{BASE}/projects/{pid}", headers=h)
    assert r.status_code == 400 and "document" in r.json()["detail"]

    # Someone else's file: only its uploader or a project lead (or admin) deletes it.
    r = client.delete(f"{BASE}/documents/{doc['id']}", headers=other)
    assert r.status_code == 403 and "only the files you uploaded" in r.json()["detail"] and "project lead of" in r.json()["detail"]
    assert client.delete(f"{BASE}/documents/{doc['id']}", headers=h).status_code == 200
    assert client.get(f"{BASE}/documents", params={"project_id": pid}, headers=h).json() == []
