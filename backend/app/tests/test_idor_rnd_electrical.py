"""IDOR / object-level authorization sweep — R&D and Electrical.

Covers the gaps closed in the sweep: filing an experiment / prototype /
document under an R&D project outside the user's data scope, the document
upload permission, the project-file delete message (was a NameError 500),
and opening a CRM-internal file through R&D › Requirement work by id."""
from app.auth.jwt_handler import create_access_token
from app.modules.crm.models.document import CrmDocument
from app.modules.main.models.user import User
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.routes import requirement_work as work_routes
from app.tests.test_cov_crm_quotations_rnd import make_inquiry, send_tor, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture

RND = "/api/v1/rnd"
WORK = f"{RND}/requirement-work"


def make_user(db, email, apps=("rnd",), grants=None, scopes=None):
    user = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=list(apps))
    if grants is not None:
        user.granular_permissions = list(grants)
    if scopes is not None:
        user.data_access_scopes = dict(scopes)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def _project(client, owner, **extra):
    resp = client.post(f"{RND}/projects", json={"title": "Bogie test rig", "objective": "Validate", "origin": "new_project", "origin_note": "Proposed by R&D head", "attachment_count": 1, **extra}, headers=auth(owner))
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_cannot_file_experiment_or_prototype_under_out_of_scope_project(client, db):
    owner = make_user(db, "idor.rnd.owner@premnathrail.com")
    outsider = make_user(db, "idor.rnd.out@premnathrail.com", scopes={"rnd": "own"})
    project = _project(client, owner)

    # The project itself is out of the outsider's scope …
    assert client.get(f"{RND}/projects/{project['id']}", headers=auth(outsider)).status_code == 403
    # … so they can't file records under it either.
    r = client.post(f"{RND}/experiments", json={"title": "Load test", "project_id": project["id"]}, headers=auth(outsider))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]
    r = client.post(f"{RND}/prototypes", json={"name": "Proto", "project_id": project["id"]}, headers=auth(outsider))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]

    # Moving their own experiment into that project is refused too.
    mine = _project(client, outsider)
    own = client.post(f"{RND}/experiments", json={"title": "Bench test", "project_id": mine["id"]}, headers=auth(outsider))
    assert own.status_code == 200, own.text
    r = client.patch(f"{RND}/experiments/{own.json()['id']}", json={"project_id": project["id"]}, headers=auth(outsider))
    assert r.status_code == 403
    # Editing other fields of their own record still works.
    r = client.patch(f"{RND}/experiments/{own.json()['id']}", json={"title": "Bench test 2"}, headers=auth(outsider))
    assert r.status_code == 200, r.text

    # The owner (in scope) can.
    r = client.post(f"{RND}/experiments", json={"title": "Load test", "project_id": project["id"]}, headers=auth(owner))
    assert r.status_code == 200, r.text


def test_document_upload_checks_permission_and_project_scope(client, db):
    owner = make_user(db, "idor.rnd.docowner@premnathrail.com")
    outsider = make_user(db, "idor.rnd.docout@premnathrail.com", scopes={"rnd": "own"})
    viewer = make_user(db, "idor.rnd.docview@premnathrail.com", grants=["rnd:documents:view"])
    project = _project(client, owner)
    files = {"files": ("spec.pdf", b"%PDF", "application/pdf")}
    data = {"project_id": str(project["id"]), "title": "Spec"}

    r = client.post(f"{RND}/documents", data=data, files=files, headers=auth(viewer))
    assert r.status_code == 403 and "'Create' on R&D › Documents" in r.json()["detail"]
    r = client.post(f"{RND}/documents", data=data, files=files, headers=auth(outsider))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]


def test_team_member_delete_gets_real_reason(client, db):
    lead = make_user(db, "idor.rnd.lead@premnathrail.com")
    member = make_user(db, "idor.rnd.member@premnathrail.com")
    project = _project(client, lead, lead_ids=[lead.id], team_member_ids=[member.id])
    doc = RndDocument(project_id=project["id"], doc_type="other", title="Drawing", file_name="d.pdf", uploaded_by_id=member.id)
    db.add(doc)
    db.commit()
    r = client.delete(f"{RND}/documents/{doc.id}", headers=auth(member))
    assert r.status_code == 403 and "Only a project lead" in r.json()["detail"]


def test_requirement_work_cannot_open_crm_internal_file_by_id(client, db, tor_env, monkeypatch):
    bd = make_user(db, "idor.rnd.bd@premnathrail.com", apps=("crm",))
    head = make_user(db, "idor.rnd.head@premnathrail.com")

    async def fake_download(site, path):
        return b"%PDF", "application/pdf"
    monkeypatch.setattr(work_routes, "download_file_content", fake_download)

    sent = make_inquiry(db, bd)
    assert send_tor(client, sent.id, bd).status_code == 200
    tor = db.query(CrmDocument).filter(CrmDocument.related_id == sent.id, CrmDocument.shared_via_tor == True).first()  # noqa: E712
    internal = CrmDocument(related_module="inquiry", related_id=sent.id, folder_type="quotation", file_name="q.pdf",
                           file_path="x/q.pdf", sharepoint_path="x/q.pdf", org_id=sent.org_id)
    unsent = make_inquiry(db, bd, uid="INQ-20261007-0099")
    other = CrmDocument(related_module="inquiry", related_id=unsent.id, folder_type="technical_offer", file_name="t.pdf",
                        file_path="x/t.pdf", sharepoint_path="x/t.pdf", org_id=unsent.org_id, shared_via_tor=True)
    db.add_all([internal, other])
    db.commit()

    assert client.get(f"{WORK}/documents/{tor.id}/content", headers=auth(head)).status_code == 200
    r = client.get(f"{WORK}/documents/{internal.id}/content", headers=auth(head))
    assert r.status_code == 403 and "CRM-internal" in r.json()["detail"]
    r = client.get(f"{WORK}/documents/{other.id}/download-url", headers=auth(head))
    assert r.status_code == 404 and "sent to R&D" in r.json()["detail"]
