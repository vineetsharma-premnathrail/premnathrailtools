"""
Tests for the R&D module's project lifecycle (backend/app/modules/rnd/routes/
projects.py, experiments.py, prototypes.py, dashboard.py): numbering,
stage gates (feasibility → handover → closed), prototype BOM cost roll-up,
and the delete guards.
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
    payload = {"title": "Rail grinder bogie", "objective": "Lighter bogie frame", "budget_amount": 100000, **overrides}
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
        json={"title": "X", "objective": "Y", "start_date": "2026-10-10", "target_end_date": "2026-10-01"},
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


def test_prototype_bom_cost_rolls_up_to_project(client, db):
    h = auth_header(make_user(db, "rnd5@premnathrail.com"))
    pid = create_project(client, h)["id"]
    r = client.post(f"{BASE}/prototypes", json={
        "project_id": pid, "name": "Frame proto", "version": "v1",
        "bom_items": [
            {"item_name": "Steel plate", "quantity": 4, "unit_cost": 1500, "uom": "NOS"},
            {"item_name": "Bolts", "quantity": 50, "unit_cost": 10},
        ],
    }, headers=h)
    assert r.status_code == 200, r.text
    proto = r.json()
    assert proto["prototype_number"].startswith("PRT-")
    assert proto["bom_cost"] == 6500
    assert [l["line_cost"] for l in proto["bom_items"]] == [6000, 500]

    detail = client.get(f"{BASE}/projects/{pid}", headers=h).json()
    assert detail["actual_cost"] == 6500 and detail["prototype_count"] == 1
    assert detail["prototypes"][0]["bom_cost"] == 6500

    # Replacing the BOM replaces every line.
    r = client.patch(f"{BASE}/prototypes/{proto['id']}", json={"bom_items": [{"item_name": "Plate", "quantity": 1, "unit_cost": 100}]}, headers=h)
    assert r.status_code == 200 and r.json()["bom_cost"] == 100 and len(r.json()["bom_items"]) == 1

    bad = client.patch(f"{BASE}/prototypes/{proto['id']}", json={"bom_items": [{"item_name": "Plate", "quantity": 0}]}, headers=h)
    assert bad.status_code == 400 and "quantity" in bad.json()["detail"]


def test_experiment_rules_and_delete_guards(client, db):
    h = auth_header(make_user(db, "rnd6@premnathrail.com"))
    pid = create_project(client, h)["id"]
    other_pid = create_project(client, h, title="Other")["id"]
    proto = client.post(f"{BASE}/prototypes", json={"project_id": pid, "name": "P", "version": "v1"}, headers=h).json()

    # Prototype must belong to the experiment's project.
    r = client.post(f"{BASE}/experiments", json={"project_id": other_pid, "prototype_id": proto["id"], "title": "T"}, headers=h)
    assert r.status_code == 400 and "different project" in r.json()["detail"]

    r = client.post(f"{BASE}/experiments", json={
        "project_id": pid, "prototype_id": proto["id"], "title": "Load test",
        "parameters": [{"parameter": "Max deflection", "specification": "< 2", "measured": "1.6", "unit": "mm", "result": "pass"}],
    }, headers=h)
    assert r.status_code == 200, r.text
    exp = r.json()
    assert exp["experiment_number"].startswith("EXP-") and exp["status"] == "planned"

    # Completed requires an overall result.
    r = client.patch(f"{BASE}/experiments/{exp['id']}", json={"status": "completed"}, headers=h)
    assert r.status_code == 400 and "Result" in r.json()["detail"]
    r = client.patch(f"{BASE}/experiments/{exp['id']}", json={"status": "completed", "result": "pass"}, headers=h)
    assert r.status_code == 200

    # Delete guards: prototype has an experiment; project has children.
    assert client.delete(f"{BASE}/prototypes/{proto['id']}", headers=h).status_code == 400
    r = client.delete(f"{BASE}/projects/{pid}", headers=h)
    assert r.status_code == 400 and "experiment" in r.json()["detail"]

    assert client.delete(f"{BASE}/experiments/{exp['id']}", headers=h).status_code == 200
    assert client.delete(f"{BASE}/prototypes/{proto['id']}", headers=h).status_code == 200
    assert client.delete(f"{BASE}/projects/{pid}", headers=h).status_code == 200
    assert client.get(f"{BASE}/projects/{pid}", headers=h).status_code == 404


def test_dashboard_summary(client, db):
    h = auth_header(make_user(db, "rnd7@premnathrail.com"))
    pid = create_project(client, h)["id"]
    client.post(f"{BASE}/prototypes", json={
        "project_id": pid, "name": "P", "version": "v1", "bom_items": [{"item_name": "X", "quantity": 2, "unit_cost": 50}],
    }, headers=h)
    exp = client.post(f"{BASE}/experiments", json={"project_id": pid, "title": "T"}, headers=h).json()
    client.patch(f"{BASE}/experiments/{exp['id']}", json={"status": "completed", "result": "fail"}, headers=h)

    r = client.get(f"{BASE}/dashboard", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["projects"]["active"] == 1 and data["projects"]["by_stage"]["initiation"] == 1
    assert data["experiments"]["fail"] == 1 and data["experiments"]["pass_rate"] == 0.0
    assert data["prototypes"]["design"] == 1
    assert data["budget"] == {"total_budget": 100000.0, "total_spend": 100.0}


# ── Release to Production ─────────────────────────────────────────────────

def _store_item(db, code, name):
    from app.modules.store.models.item import StoreItem
    item = StoreItem(item_code=code, item_name=name, uom="NOS")
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_release_prototype_to_production(client, db):
    from app.modules.production.models.bom import ProductionBom

    h = auth_header(make_user(db, "rnd8@premnathrail.com"))
    pid = create_project(client, h)["id"]
    plate = _store_item(db, "RM-PLATE", "Steel plate")
    bolt = _store_item(db, "RM-BOLT", "Bolt M12")
    product = _store_item(db, "FG-BOGIE", "Bogie frame")

    proto = client.post(f"{BASE}/prototypes", json={
        "project_id": pid, "name": "Frame", "version": "v2",
        "bom_items": [
            {"store_item_id": plate.id, "item_name": "Steel plate", "quantity": 2, "unit_cost": 100},
            {"item_name": "Custom bracket", "quantity": 1},
            {"store_item_id": plate.id, "item_name": "Steel plate", "quantity": 1, "remarks": "stiffener"},
        ],
    }, headers=h).json()
    url = f"{BASE}/prototypes/{proto['id']}/release-to-production"

    # Must be validated first.
    r = client.post(url, json={"product_item_id": product.id}, headers=h)
    assert r.status_code == 400 and "Validated" in r.json()["detail"]

    # Free-text lines block the release and are named.
    client.patch(f"{BASE}/prototypes/{proto['id']}", json={"status": "validated"}, headers=h)
    r = client.post(url, json={"product_item_id": product.id}, headers=h)
    assert r.status_code == 400 and "Custom bracket" in r.json()["detail"]

    lines = [
        {"store_item_id": plate.id, "item_name": "Steel plate", "quantity": 2, "unit_cost": 100},
        {"store_item_id": bolt.id, "item_name": "Bolt M12", "quantity": 8},
        {"store_item_id": plate.id, "item_name": "Steel plate", "quantity": 1, "remarks": "stiffener"},
    ]
    client.patch(f"{BASE}/prototypes/{proto['id']}", json={"bom_items": lines}, headers=h)

    # Product can't be one of its own components.
    r = client.post(url, json={"product_item_id": plate.id}, headers=h)
    assert r.status_code == 400 and "RM-PLATE" in r.json()["detail"]

    r = client.post(url, json={"product_item_id": product.id}, headers=h)
    assert r.status_code == 200, r.text
    released = r.json()
    assert released["production_bom_id"] and released["production_bom_status"] == "draft"
    assert released["production_bom_number"].endswith("(v1)")

    bom = db.query(ProductionBom).filter(ProductionBom.id == released["production_bom_id"]).first()
    qty = {i.component_item_id: i.quantity for i in bom.items}
    assert qty == {plate.id: 3, bolt.id: 8}  # duplicate plate lines merged
    assert bom.product_item_id == product.id and bom.status == "draft"
    assert proto["prototype_number"] in bom.remarks

    # Released prototype: BOM frozen, can't release twice, can't delete.
    r = client.patch(f"{BASE}/prototypes/{proto['id']}", json={"bom_items": lines[:1]}, headers=h)
    assert r.status_code == 409 and "frozen" in r.json()["detail"]
    assert client.post(url, json={"product_item_id": product.id}, headers=h).status_code == 409
    assert client.delete(f"{BASE}/prototypes/{proto['id']}", headers=h).status_code == 400

    # Project detail shows the released BOM on the prototype row.
    detail = client.get(f"{BASE}/projects/{pid}", headers=h).json()
    assert detail["prototypes"][0]["production_bom_number"] == released["production_bom_number"]

    # A second prototype for the same product is blocked while the draft is open.
    p2 = client.post(f"{BASE}/prototypes", json={
        "project_id": pid, "name": "Frame", "version": "v3",
        "bom_items": [{"store_item_id": bolt.id, "item_name": "Bolt M12", "quantity": 4}],
    }, headers=h).json()
    client.patch(f"{BASE}/prototypes/{p2['id']}", json={"status": "validated"}, headers=h)
    r = client.post(f"{BASE}/prototypes/{p2['id']}/release-to-production", json={"product_item_id": product.id}, headers=h)
    assert r.status_code == 409 and "open draft" in r.json()["detail"]


# ── Documents ─────────────────────────────────────────────────────────────

def test_documents_upload_list_delete(client, db, monkeypatch):
    from app.core.config import settings
    from app.modules.rnd.routes import documents as doc_routes

    h_owner_user = make_user(db, "rnd9@premnathrail.com")
    h = auth_header(h_owner_user)
    other = auth_header(make_user(db, "rnd10@premnathrail.com"))
    pid = create_project(client, h)["id"]
    other_pid = create_project(client, h, title="Other")["id"]
    exp = client.post(f"{BASE}/experiments", json={"project_id": pid, "title": "T"}, headers=h).json()
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

    # Experiment must belong to the same project.
    r = client.post(f"{BASE}/documents", data={"project_id": other_pid, "experiment_id": exp["id"], "title": "X"}, files=files, headers=h)
    assert r.status_code == 400 and "different project" in r.json()["detail"]
    r = client.post(f"{BASE}/documents", data={"project_id": pid, "title": "X", "doc_type": "memo"}, files=files, headers=h)
    assert r.status_code == 400

    r = client.post(f"{BASE}/documents", data={
        "project_id": pid, "experiment_id": exp["id"], "title": "Load report", "doc_type": "test_report", "version": "A",
    }, files=files, headers=h)
    assert r.status_code == 200, r.text
    doc = r.json()[0]
    assert doc["file_name"] == "report.pdf" and doc["experiment_number"] == exp["experiment_number"]
    assert "RnD-media" in db.query(doc_routes.RndDocument).get(doc["id"]).sharepoint_path

    assert len(client.get(f"{BASE}/documents", params={"project_id": pid}, headers=h).json()) == 1
    assert len(client.get(f"{BASE}/documents", params={"experiment_id": exp["id"]}, headers=h).json()) == 1

    # Project with documents can't be deleted (after removing its experiment).
    client.delete(f"{BASE}/experiments/{exp['id']}", headers=h)
    r = client.delete(f"{BASE}/projects/{pid}", headers=h)
    assert r.status_code == 400 and "document" in r.json()["detail"]

    # Only the uploader (or admin) can delete.
    r = client.delete(f"{BASE}/documents/{doc['id']}", headers=other)
    assert r.status_code == 403 and "uploader" in r.json()["detail"]
    assert client.delete(f"{BASE}/documents/{doc['id']}", headers=h).status_code == 200
    assert client.get(f"{BASE}/documents", params={"project_id": pid}, headers=h).json() == []


def test_documents_follow_experiment_to_new_project(client, db, monkeypatch):
    from app.core.config import settings
    from app.modules.rnd.routes import documents as doc_routes

    async def fake_upload(site_id, folder_path, upload_file):
        return {"name": upload_file.filename, "path": f"{folder_path}/{upload_file.filename}", "size": 1}

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site-1")
    monkeypatch.setattr(doc_routes, "upload_file_to_sharepoint", fake_upload)

    h = auth_header(make_user(db, "rnd11@premnathrail.com"))
    a = create_project(client, h, title="A")["id"]
    b = create_project(client, h, title="B")["id"]
    exp = client.post(f"{BASE}/experiments", json={"project_id": a, "title": "T"}, headers=h).json()
    client.post(f"{BASE}/documents", data={"project_id": a, "experiment_id": exp["id"], "title": "R"},
                files={"files": ("r.pdf", b"x", "application/pdf")}, headers=h)

    assert client.patch(f"{BASE}/experiments/{exp['id']}", json={"project_id": b}, headers=h).status_code == 200
    assert client.get(f"{BASE}/documents", params={"project_id": a}, headers=h).json() == []
    assert len(client.get(f"{BASE}/documents", params={"project_id": b}, headers=h).json()) == 1
