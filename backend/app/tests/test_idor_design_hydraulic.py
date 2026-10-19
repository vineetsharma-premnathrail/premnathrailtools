"""IDOR / object-level authorization sweep — Design and Hydraulic & Pneumatic.

Covers the gaps closed in the sweep: by-id reads that were only gated on the
app (now need the same tab as their list), documents of a soft-deleted
hydraulic record, the Design WBS-evidence lookup (bound to Design-owned WBS
elements) and linking an out-of-scope drawing to a PM task."""
from datetime import date, timedelta

from app.auth.jwt_handler import create_access_token
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.document import HydDocument
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmProjectTask

HYD = "/api/v1/hydraulic"
DES = "/api/v1/design"


def make_user(db, email, apps, grants=None, role="user"):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    if grants is not None:
        user.granular_permissions = list(grants)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


# ---------------------------------------------------------------------------
# Hydraulic
# ---------------------------------------------------------------------------

def test_hydraulic_detail_reads_need_the_tab(client, db):
    full = make_user(db, "idor.hyd.full@premnathrail.com", ("hydraulic",))
    bom_only = make_user(db, "idor.hyd.bom@premnathrail.com", ("hydraulic",), grants=["hydraulic:bom:view"])
    comp = client.post(f"{HYD}/components", json={"name": "Pump", "category": "pump"}, headers=auth(full))
    assert comp.status_code == 200, comp.text
    cid = comp.json()["id"]
    assert client.get(f"{HYD}/components/{cid}", headers=auth(full)).status_code == 200
    assert client.get(f"{HYD}/components/{cid}", headers=auth(bom_only)).status_code == 403
    # Retired read-only records: tab check runs before the lookup.
    for path in ("service-records", "maintenance-plans", "spare-parts"):
        assert client.get(f"{HYD}/{path}/999999", headers=auth(bom_only)).status_code == 403, path
        assert client.get(f"{HYD}/{path}/999999", headers=auth(full)).status_code == 404, path


def test_hydraulic_documents_of_deleted_parent_404(client, db):
    eng = make_user(db, "idor.hyd.eng@premnathrail.com", ("hydraulic",))
    c = client.post(f"{HYD}/circuits", json={"title": "Lift circuit"}, headers=auth(eng)).json()
    doc = HydDocument(entity_type="circuit", entity_id=c["id"], doc_type="circuit_diagram", title="D", file_name="d.pdf")
    db.add(doc)
    db.commit()
    params = {"entity_type": "circuit", "entity_id": c["id"]}
    assert client.get(f"{HYD}/documents", params=params, headers=auth(eng)).status_code == 200
    db.get(HydCircuit, c["id"]).is_deleted = True
    db.commit()
    r = client.get(f"{HYD}/documents", params=params, headers=auth(eng))
    assert r.status_code == 404 and "deleted" in r.json()["detail"]
    assert client.get(f"{HYD}/documents/{doc.id}/content", headers=auth(eng)).status_code == 404


# ---------------------------------------------------------------------------
# Design
# ---------------------------------------------------------------------------

def test_design_milestone_evidence_bound_to_design_wbs(client, db):
    user = make_user(db, "idor.des.user@premnathrail.com", ("design",))
    design = Department(name="Design", code="DSN-IDOR")
    sales = Department(name="Sales", code="SAL-IDOR")
    project = PmProject(project_code="IDOR-P1", name="Project")
    db.add_all([design, sales, project])
    db.flush()
    due = date.today() + timedelta(days=30)
    ours = PmProjectMilestone(project_id=project.id, department_id=design.id, title="Design freeze", target_date=due)
    theirs = PmProjectMilestone(project_id=project.id, department_id=sales.id, title="Commercial bid", target_date=due)
    db.add_all([ours, theirs])
    db.commit()
    assert client.get(f"{DES}/milestones/{ours.id}/evidence", headers=auth(user)).status_code == 200
    r = client.get(f"{DES}/milestones/{theirs.id}/evidence", headers=auth(user))
    assert r.status_code == 404 and "Design department" in r.json()["detail"]


def test_design_link_deliverable_respects_scope(client, db):
    role = Role(name="Design – own (IDOR)", permissions=["design:*:*"], data_scopes={"design": "own"})
    db.add(role)
    db.commit()
    a = User(email="idor.des.a@premnathrail.com", name="A", role="user", is_active=True)
    b = User(email="idor.des.b@premnathrail.com", name="B", role="user", is_active=True)
    a.roles, b.roles = [role], [role]
    db.add_all([a, b])
    db.commit()
    body = {"title": "Bogie frame GA", "document_type": "ga_drawing", "discipline": "mechanical"}
    mine = client.post(f"{DES}/documents", json=body, headers=auth(a))
    theirs = client.post(f"{DES}/documents", json=body, headers=auth(b))
    assert mine.status_code == 201 and theirs.status_code == 201, (mine.text, theirs.text)
    assert client.get(f"{DES}/documents/{theirs.json()['id']}", headers=auth(a)).status_code == 403

    project = PmProject(project_code="IDOR-P2", name="Project")
    db.add(project)
    db.flush()
    task = PmProjectTask(project_id=project.id, title="Draw frame", assignee_id=a.id)
    db.add(task)
    db.commit()
    r = client.post(f"{DES}/task-deliverables", json={"pm_task_id": task.id, "document_id": theirs.json()["id"]}, headers=auth(a))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]
    r = client.post(f"{DES}/task-deliverables", json={"pm_task_id": task.id, "document_id": mine.json()["id"]}, headers=auth(a))
    assert r.status_code == 201, r.text


def test_design_standard_file_needs_library_tab(client, db):
    no_library = make_user(db, "idor.des.nolib@premnathrail.com", ("design",), grants=["design:documents:view"])
    r = client.get(f"{DES}/library/standards/999999/file", headers=auth(no_library))
    assert r.status_code == 403
    full = make_user(db, "idor.des.lib@premnathrail.com", ("design",))
    assert client.get(f"{DES}/library/standards/999999/file", headers=auth(full)).status_code == 404
