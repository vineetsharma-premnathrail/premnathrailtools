"""Service & Commissioning (erp) RBAC: users built with granular_permissions
(no assigned_apps) get real deny-by-default behaviour. The tab action is
necessary; deletes follow the company rule (Delete on the tab + only your
own records; admins delete anything)."""
from app.auth.jwt_handler import create_access_token
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User

ERP = "/api/v1/erp"

SR_VIEW = ["erp:projects:view", "erp:service_requests:view"]
SR_FULL = SR_VIEW + [
    "erp:service_requests:create", "erp:service_requests:edit", "erp:service_requests:delete",
    "erp:projects:create", "erp:projects:delete",
]


def _user(db, email, grants=None, role="user"):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True,
             granular_permissions=list(grants or []))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email})}"}


def _machine(db, serial, creator_id=None):
    p = Project(serial_number=serial, approval_status="approved", created_by_id=creator_id)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _sr(client, u, project_id):
    r = client.post(f"{ERP}/service-requests", headers=_h(u),
                    json={"project_id": project_id, "issue_title": "Leak", "service_type": "repair_breakdown"})
    assert r.status_code == 201, r.text
    return r.json()


def test_view_only_user_reads_but_cannot_create_edit_or_delete(client, db):
    admin = _user(db, "rbac.erp.admin@x.com", role="admin")
    viewer = _user(db, "rbac.erp.view@x.com", SR_VIEW)
    m = _machine(db, "RBAC-ERP-1", admin.id)
    sr = _sr(client, admin, m.id)
    h = _h(viewer)

    assert client.get(f"{ERP}/service-requests", headers=h).status_code == 200
    assert client.get(f"{ERP}/service-requests/{sr['id']}", headers=h).status_code == 200
    assert client.get(f"{ERP}/projects", headers=h).status_code == 200

    r = client.post(f"{ERP}/service-requests", headers=h,
                    json={"project_id": m.id, "issue_title": "X", "service_type": "repair_breakdown"})
    assert r.status_code == 403
    assert client.patch(f"{ERP}/service-requests/{sr['id']}", headers=h, json={"issue_title": "Y"}).status_code == 403
    r = client.delete(f"{ERP}/service-requests/{sr['id']}", headers=h)
    assert r.status_code == 403 and "'delete' permission" in r.json()["detail"].lower()
    assert client.post(f"{ERP}/projects", headers=h, json={"serial_number": "RBAC-ERP-NEW"}).status_code == 403
    assert client.delete(f"{ERP}/projects/{m.id}", headers=h).status_code == 403
    # No export / import / recycle bin grants either.
    assert client.get(f"{ERP}/service-requests/export", headers=h).status_code == 403
    assert client.get(f"{ERP}/service-requests/import/template", headers=h).status_code == 403
    assert client.get(f"{ERP}/service-requests/recycle-bin", headers=h).status_code == 403


def test_no_grants_means_no_service_tabs(client, db):
    nobody = _user(db, "rbac.erp.none@x.com", ["erp:dashboard:view"])
    assert client.get(f"{ERP}/service-requests", headers=_h(nobody)).status_code == 403
    assert client.get(f"{ERP}/projects", headers=_h(nobody)).status_code == 403


def test_delete_only_own_records(client, db):
    alice = _user(db, "rbac.erp.alice@x.com", SR_FULL)
    bob = _user(db, "rbac.erp.bob@x.com", SR_FULL)
    m = _machine(db, "RBAC-ERP-2", alice.id)
    sr = _sr(client, alice, m.id)

    r = client.delete(f"{ERP}/service-requests/{sr['id']}", headers=_h(bob))
    assert r.status_code == 403 and "created yourself" in r.json()["detail"]
    assert client.delete(f"{ERP}/service-requests/{sr['id']}", headers=_h(alice)).status_code == 200

    r = client.delete(f"{ERP}/projects/{m.id}", headers=_h(bob))
    assert r.status_code == 403 and "created yourself" in r.json()["detail"]
    assert client.delete(f"{ERP}/projects/{m.id}", headers=_h(alice)).status_code == 204


def test_restore_needs_recycle_bin_edit(client, db):
    alice = _user(db, "rbac.erp.rb@x.com", SR_FULL)
    m = _machine(db, "RBAC-ERP-3", alice.id)
    sr = _sr(client, alice, m.id)
    assert client.delete(f"{ERP}/service-requests/{sr['id']}", headers=_h(alice)).status_code == 200
    r = client.post(f"{ERP}/service-requests/{sr['id']}/restore", headers=_h(alice))
    assert r.status_code == 403 and "recycle bin" in r.json()["detail"].lower()

    alice.granular_permissions = SR_FULL + ["erp:recycle_bin:view", "erp:recycle_bin:edit"]
    db.commit()
    assert client.get(f"{ERP}/service-requests/recycle-bin", headers=_h(alice)).status_code == 200
    assert client.post(f"{ERP}/service-requests/{sr['id']}/restore", headers=_h(alice)).status_code == 200


def test_service_projects_moved_to_project_management(client, db):
    """Machines live under Project Management › Service Projects (2026-10-26). A stray old grant still opens
    them; a Project Management wildcard does not (explicit-only tab); Service Requests alone can't list them."""
    from app.core.permission_registry import MODULES, expand_grants
    assert "projects" not in MODULES["erp"]["subtabs"] and "service_projects" in MODULES["projects"]["subtabs"]
    assert expand_grants(["erp:projects:view"]) >= {"projects:service_projects:view"}
    assert not any("service_projects" in g for g in expand_grants(["projects:*:*"]))
    old = _user(db, "old_machine_grant@premnathrail.com", ["erp:projects:view"])
    new = _user(db, "new_machine_grant@premnathrail.com", ["projects:service_projects:view"])
    for u in (old, new):
        assert client.get(f"{ERP}/projects", headers=_h(u)).status_code == 200
        assert "projects" in u.get_apps()
    sr_only = _user(db, "sr_only@premnathrail.com", ["erp:service_requests:view"])
    assert client.get(f"{ERP}/projects", headers=_h(sr_only)).status_code == 403
    pm_all = _user(db, "pm_all@premnathrail.com", ["projects:*:*"])
    assert client.get(f"{ERP}/projects", headers=_h(pm_all)).status_code == 403
    assert client.post(f"{ERP}/projects", json={"serial_number": "PM-WILD-1"}, headers=_h(pm_all)).status_code == 403
