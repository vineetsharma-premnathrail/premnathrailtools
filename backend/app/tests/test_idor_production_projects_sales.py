"""IDOR / object-level authorization regressions for Production, Project
Management (and the retired Sales API): a second record id in the URL (or a file's owning
record) is checked against the caller's data scope, and soft-deleted parents
don't leak through their children."""
import pytest
from fastapi import HTTPException

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.production.models.work_order import ProductionWorkOrder
from app.modules.projects.models.document import PmProjectDocument
from app.modules.projects.models.project import PmProject

API = "/api/v1"
OUT_OF_SCOPE = "outside your data access"


def _user(db, email, role="user", **kw):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _scoped(db, email, module, perms, level, **kw):
    role = Role(name=f"{module} {level} {email}", permissions=perms, data_scopes={module: level})
    db.add(role)
    db.commit()
    u = _user(db, email, **kw)
    u.roles = [role]
    db.commit()
    return u


# ── Production ───────────────────────────────────────────────────────────

def test_rrv_link_work_order_checks_the_work_orders_scope(client, db):
    other = _user(db, "idor.prod.other@premnathrail.com", assigned_apps=["production"])
    me = _scoped(db, "idor.prod.me@premnathrail.com", "production", ["production:*:*"], "own", assigned_apps=["production"])
    build = ProductionRrvBuild(build_number="RRV-IDOR-1", rrv_model="RRV", status="planned", created_by_id=me.id)
    wo = ProductionWorkOrder(wo_number="WO-IDOR-1", product_item_id=1, bom_id=1, quantity_planned=1, created_by_id=other.id)
    db.add_all([build, wo])
    db.commit()
    r = client.post(f"{API}/production/rrv-builds/{build.id}/work-orders/{wo.id}", json={"build_role": "main"}, headers=h(me))
    assert r.status_code == 403, r.text
    assert OUT_OF_SCOPE in r.json()["detail"] and "work order" in r.json()["detail"]
    db.refresh(wo)
    assert wo.rrv_build_id is None


def test_rrv_handover_document_respects_scope_and_soft_delete(db):
    from app.modules.production.routes.rrv_builds import _handover_document_target

    other = _user(db, "idor.prod.owner2@premnathrail.com", assigned_apps=["production"])
    me = _scoped(db, "idor.prod.me2@premnathrail.com", "production", ["production:*:*"], "own", assigned_apps=["production"])
    theirs = ProductionRrvBuild(build_number="RRV-IDOR-2", rrv_model="RRV", status="handed_over", created_by_id=other.id)
    gone = ProductionRrvBuild(build_number="RRV-IDOR-3", rrv_model="RRV", status="handed_over", created_by_id=me.id, is_deleted=True)
    db.add_all([theirs, gone])
    db.commit()
    with pytest.raises(HTTPException) as e:
        _handover_document_target(db, theirs.id, me, False)
    assert e.value.status_code == 403 and OUT_OF_SCOPE in e.value.detail
    with pytest.raises(HTTPException) as e:
        _handover_document_target(db, gone.id, me, False)
    assert e.value.status_code == 404


# ── Project Management ───────────────────────────────────────────────────

def test_pm_work_project_file_checks_project_scope(client, db):
    pm = _user(db, "idor.pm.owner@premnathrail.com", assigned_apps=["projects"])
    me = _scoped(db, "idor.pm.me@premnathrail.com", "projects", ["projects:*:*"], "own", assigned_apps=["projects"])
    project = PmProject(project_code="IDOR-PM-1", name="Not mine", status="active", project_manager_id=pm.id, created_by_id=pm.id)
    db.add(project)
    db.commit()
    doc = PmProjectDocument(project_id=project.id, doc_type="other", title="Contract", file_name="c.pdf",
                            file_path="x/c.pdf", sharepoint_path="x/c.pdf", uploaded_by_id=pm.id)
    db.add(doc)
    db.commit()
    r = client.get(f"{API}/pm-work/files/{doc.id}/content", headers=h(me))
    assert r.status_code == 403, r.text
    assert OUT_OF_SCOPE in r.json()["detail"]
    # The project-scoped route says the same.
    r = client.get(f"{API}/projects/{project.id}/documents/{doc.id}/content", headers=h(me))
    assert r.status_code == 403


def test_pm_project_document_bound_to_project_in_url(client, db):
    admin = _user(db, "idor.pm.admin@premnathrail.com", role="admin")
    a = PmProject(project_code="IDOR-PM-A", name="A", status="active", created_by_id=admin.id)
    b = PmProject(project_code="IDOR-PM-B", name="B", status="active", created_by_id=admin.id)
    db.add_all([a, b])
    db.commit()
    doc_b = PmProjectDocument(project_id=b.id, doc_type="other", title="B file", file_name="b.pdf", file_path="b.pdf",
                              sharepoint_path="b.pdf", uploaded_by_id=admin.id)
    db.add(doc_b)
    db.commit()
    r = client.delete(f"{API}/projects/{a.id}/documents/{doc_b.id}", headers=h(admin))
    assert r.status_code == 404 and "not found on this project" in r.json()["detail"]


def test_pm_final_report_document_checks_project_scope(db):
    from app.modules.projects.closure import _report_target

    pm = _user(db, "idor.pm.owner3@premnathrail.com", assigned_apps=["projects"])
    me = _scoped(db, "idor.pm.me3@premnathrail.com", "projects", ["projects:*:*"], "own", assigned_apps=["projects"])
    project = PmProject(project_code="IDOR-PM-3", name="Done", status="technically_complete", project_manager_id=pm.id, created_by_id=pm.id)
    db.add(project)
    db.commit()
    with pytest.raises(HTTPException) as e:
        _report_target(db, project.id, me, False)
    assert e.value.status_code == 403 and OUT_OF_SCOPE in e.value.detail


# ── Sales (retired 2026-10-30) ───────────────────────────────────────────

def test_retired_sales_api_answers_410_and_exposes_no_data(client, db):
    """Every /sales/... call gets 410 with where to go instead — orders, attachments, delivery rows
    and the by-build / by-source lookups are gone, so there is nothing left to leak by id."""
    admin = _user(db, "idor.sales.admin@premnathrail.com", role="admin")
    for method, path in (("get", "/sales/orders"), ("get", "/sales/orders/1"), ("post", "/sales/orders"),
                         ("get", "/sales/schedule/by-build/987654"), ("get", "/sales/attachments"),
                         ("delete", "/sales/orders/1"), ("get", "/sales/orders/by-source")):
        r = getattr(client, method)(f"{API}{path}", headers=h(admin))
        assert r.status_code == 410, (method, path, r.text)
        assert "Sales Orders were removed" in r.json()["detail"] and "Create Project" in r.json()["detail"]
