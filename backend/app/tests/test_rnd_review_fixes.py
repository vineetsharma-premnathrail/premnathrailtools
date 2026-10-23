"""
R&D review fixes: per-tool Permission Matrix gating on the calculators,
create/edit/delete/approve action checks on projects / experiments /
prototypes, PATCH explicit-null handling, history rename/error texts,
hydraulic error + file-name handling, and the safe document-content headers.
"""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.tools.hydraulic.api import _content_disposition

BASE = "/api/v1/rnd"


def _user(db, email, grants=None, role="user"):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=["rnd"], granular_permissions=list(grants or []),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def _project(client, h, **kw):
    r = client.post(f"{BASE}/projects", json={"title": "Bogie", "objective": "Lighter frame", "origin": "new_development", "origin_note": "Proposed by R&D head", "attachment_count": 1, **kw}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# --- calculator subtab gating -------------------------------------------------

def test_tool_endpoints_follow_permission_matrix_subtab(client, db):
    qmax_only = _h(_user(db, "qmax-only@premnathrail.com", ["rnd:qmax:view"]))
    r = client.post(f"{BASE}/tools/braking/braking_calculate", json={}, headers=qmax_only)
    assert r.status_code == 403
    # The granted tool is reachable (validation may still reject the empty body).
    r = client.post(f"{BASE}/tools/qmax/calculate", json={}, headers=qmax_only)
    assert r.status_code != 403


def test_tool_endpoints_unrestricted_for_matrix_untouched_user(client, db):
    h = _h(_user(db, "plain-rnd@premnathrail.com"))
    r = client.post(f"{BASE}/tools/braking/braking_calculate", json={}, headers=h)
    assert r.status_code != 403


# --- action checks ------------------------------------------------------------

def test_project_create_and_delete_need_matrix_actions(client, db):
    viewer = _h(_user(db, "proj-viewer@premnathrail.com", ["rnd:projects:view"]))
    r = client.post(f"{BASE}/projects", json={"title": "X", "objective": "Y"}, headers=viewer)
    assert r.status_code == 403 and "'Create'" in r.json()["detail"]

    owner = _h(_user(db, "proj-owner@premnathrail.com"))
    pid = _project(client, owner)["id"]
    r = client.delete(f"{BASE}/projects/{pid}", headers=viewer)
    assert r.status_code == 403 and "'Delete'" in r.json()["detail"]
    r = client.patch(f"{BASE}/projects/{pid}", json={"remarks": "x"}, headers=viewer)
    assert r.status_code == 403 and "'Edit'" in r.json()["detail"]


def test_feasibility_recommendation_needs_approve(client, db):
    owner = _h(_user(db, "feas-owner@premnathrail.com"))
    pid = _project(client, owner)["id"]
    editor = _h(_user(db, "feas-editor@premnathrail.com", ["rnd:projects:view", "rnd:projects:edit"]))
    # Plain edits pass…
    r = client.put(f"{BASE}/projects/{pid}/feasibility", json={"material_cost": 10}, headers=editor)
    assert r.status_code == 200, r.text
    # …but the Go/No-Go call is an approval.
    r = client.put(f"{BASE}/projects/{pid}/feasibility", json={"recommendation": "go"}, headers=editor)
    assert r.status_code == 403 and "'Approve'" in r.json()["detail"]
    approver = _h(_user(db, "feas-approver@premnathrail.com", ["rnd:projects:view", "rnd:projects:edit", "rnd:projects:approve"]))
    r = client.put(f"{BASE}/projects/{pid}/feasibility", json={"recommendation": "go"}, headers=approver)
    assert r.status_code == 200, r.text


def test_stage_move_to_closed_needs_approve(client, db):
    owner = _h(_user(db, "stage-owner@premnathrail.com"))
    pid = _project(client, owner)["id"]
    editor = _h(_user(db, "stage-editor@premnathrail.com", ["rnd:projects:view", "rnd:projects:edit"]))
    r = client.post(f"{BASE}/projects/{pid}/stage", json={"stage": "closed"}, headers=editor)
    assert r.status_code == 403 and "'Approve'" in r.json()["detail"]


def test_experiment_and_prototype_actions_gated(client, db):
    viewer = _h(_user(db, "ep-viewer@premnathrail.com", ["rnd:experiments:view", "rnd:prototypes:view"]))
    r = client.post(f"{BASE}/experiments", json={"title": "T", "project_id": 1}, headers=viewer)
    assert r.status_code == 403
    r = client.post(f"{BASE}/prototypes", json={"name": "P", "project_id": 1}, headers=viewer)
    assert r.status_code == 403
    r = client.post(f"{BASE}/prototypes/1/release-to-production", json={}, headers=viewer)
    assert r.status_code == 403 and "'Approve'" in r.json()["detail"]


# --- project PATCH explicit nulls --------------------------------------------

def test_project_patch_explicit_null_is_a_clear_400(client, db):
    h = _h(_user(db, "nulls@premnathrail.com"))
    pid = _project(client, h)["id"]
    for field in ("priority", "project_type", "status", "handover_specs_final"):
        r = client.patch(f"{BASE}/projects/{pid}", json={field: None}, headers=h)
        assert r.status_code == 400, (field, r.text)
        assert "can't be blank" in r.json()["detail"]
    r = client.patch(f"{BASE}/projects/{pid}", json={"team_member_ids": None}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["team_members"] == []


# --- history -----------------------------------------------------------------

def test_history_rename_rejects_blank_and_errors_are_specific(client, db):
    user = _user(db, "hist-fix@premnathrail.com")
    saved = client.post(
        f"{BASE}/history/save", json={"tool_name": "braking", "inputs": {}, "results": {}}, headers=_h(user),
    ).json()
    r = client.patch(f"{BASE}/history/rename/{saved['id']}", json={"calculation_name": "   "}, headers=_h(user))
    assert r.status_code == 400 and "Enter a name" in r.json()["detail"]
    r = client.patch(f"{BASE}/history/rename/{saved['id']}", json={"calculation_name": "  Run A "}, headers=_h(user))
    assert r.status_code == 200 and r.json()["calculation_name"] == "Run A"

    r = client.delete(f"{BASE}/history/delete/999999", headers=_h(user))
    assert r.status_code == 404 and "#999999" in r.json()["detail"]

    other = _user(db, "hist-other@premnathrail.com")
    r = client.get(f"{BASE}/history/detail/{saved['id']}", headers=_h(other))
    assert r.status_code == 403 and "Only the person who saved" in r.json()["detail"]


# --- hydraulic ---------------------------------------------------------------

def test_hydraulic_validation_error_names_fields(client, db):
    h = _h(_user(db, "hyd@premnathrail.com"))
    r = client.post(f"{BASE}/tools/hydraulic/calculate", json={"calc_mode": "calc_cc"}, headers=h)
    assert r.status_code == 422
    body = r.text
    assert "weight" in body and "recalculate" in body
    assert "validation error for HydraulicInput" not in body


def test_hydraulic_content_disposition_is_ascii_safe():
    header = _content_disposition("PRT/HYD—01 \\_x", ".pdf")
    header.encode("latin-1")  # must not raise
    assert 'filename="PRT_HYD_01___x.pdf"' in header
    assert "filename*=UTF-8''" in header
    assert _content_disposition(None, ".docx").startswith('attachment; filename="Hydraulic_Report.docx"')


# --- document content headers -----------------------------------------------

def test_document_content_uses_name_based_type_and_safe_header(client, db, monkeypatch):
    from app.core.config import settings
    import app.modules.rnd.routes.documents as docs_routes

    h = _h(_user(db, "docs@premnathrail.com"))
    pid = _project(client, h)["id"]
    html_doc = RndDocument(project_id=pid, title="t", file_name='रिपोर्ट — "x".html', sharepoint_path="a/b", mime_type="application/pdf")
    pdf_doc = RndDocument(project_id=pid, title="t2", file_name="spec — v2.pdf", sharepoint_path="a/c", mime_type="text/html")
    db.add_all([html_doc, pdf_doc])
    db.commit()

    async def fake_download(site_id, path):
        return b"data", "text/html"

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site")
    monkeypatch.setattr(docs_routes, "download_file_content", fake_download)

    r = client.get(f"{BASE}/documents/{html_doc.id}/content", headers=h)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["content-disposition"].startswith("attachment;")
    assert r.headers["x-content-type-options"] == "nosniff"

    r = client.get(f"{BASE}/documents/{pdf_doc.id}/content", headers=h)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.headers["content-disposition"].startswith("inline;")
    assert "filename*=UTF-8''" in r.headers["content-disposition"]
