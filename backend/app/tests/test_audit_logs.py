"""
Tests for the shared `audit_logs` table (app/modules/main/models/audit_log.py).

It's a single polymorphic table (entity_type/entity_id) written to by CRM
(organizations, inquiries, tenders) and ERP (projects, service requests) alike
via each module's own `_write_audit()` helper — there's no dedicated
audit-log route, so these tests exercise it through the modules that actually
use it (create/update/delete/restore → GET .../audit), plus the model directly
for behavior no single module's tests would otherwise cover.
"""
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.auth.jwt_handler import create_access_token


def make_user(db, email, name="Test User", role="user", assigned_apps=None):
    user = User(
        email=email, name=name, role=role, is_active=True,
        assigned_apps=assigned_apps if assigned_apps is not None else ["crm", "erp"],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_organization_lifecycle_writes_audit_trail_in_order(client, db):
    # Deleting an organization is admin-only (app.modules.crm.routes.organizations.delete_organization);
    # CRM has no restore endpoint (unlike ERP's Project recycle-bin) so the
    # lifecycle here stops at delete.
    user = make_user(db, "org-audit@premnathrail.com", role="admin")

    create = client.post(
        "/api/v1/crm/organizations",
        json={"name": "Audit Test Org", "railway_zone": "NR"},
        headers=auth_header(user),
    )
    org_id = create.json()["id"]

    client.patch(
        f"/api/v1/crm/organizations/{org_id}",
        json={"railway_zone": "SR"},
        headers=auth_header(user),
    )
    client.delete(f"/api/v1/crm/organizations/{org_id}", headers=auth_header(user))

    logs = client.get(f"/api/v1/crm/organizations/{org_id}/audit", headers=auth_header(user)).json()
    actions = [log["action"] for log in logs]
    assert actions == ["created", "updated", "deleted"]
    assert all(log["performed_by"] == user.name for log in logs)
    assert all(log["performed_at"] for log in logs)


def test_project_lifecycle_writes_audit_trail(client, db):
    user = make_user(db, "project-audit@premnathrail.com", role="admin")

    create = client.post(
        "/api/v1/erp/projects",
        json={"serial_number": "SN-AUDIT-1", "model_name": "Test Model"},
        headers=auth_header(user),
    )
    project_id = create.json()["id"]

    client.patch(
        f"/api/v1/erp/projects/{project_id}",
        json={"model_name": "Updated Model"},
        headers=auth_header(user),
    )
    client.delete(f"/api/v1/erp/projects/{project_id}", headers=auth_header(user))

    logs = client.get(f"/api/v1/erp/projects/{project_id}/audit", headers=auth_header(user)).json()
    assert [log["action"] for log in logs] == ["created", "updated", "deleted"]


def test_audit_log_is_isolated_per_entity_type_and_id(db):
    """Two different entity types can reuse the same numeric id without
    their audit trails leaking into each other — entity_type is part of the key."""
    db.add(AuditLog(entity_type="project", entity_id=1, action="created", performed_by_id=1))
    db.add(AuditLog(entity_type="organization", entity_id=1, action="created", performed_by_id=1))
    db.add(AuditLog(entity_type="project", entity_id=2, action="created", performed_by_id=1))
    db.commit()

    project_1_logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "project", AuditLog.entity_id == 1
    ).all()
    assert len(project_1_logs) == 1
    assert project_1_logs[0].entity_type == "project"


def test_audit_log_allows_null_performed_by_for_system_actions(db):
    """performed_by_id is nullable — system/background actions (no user in
    the request context) must still be recordable, not force a fake user id."""
    entry = AuditLog(entity_type="project", entity_id=99, action="auto_archived", performed_by_id=None)
    db.add(entry)
    db.commit()
    db.refresh(entry)

    assert entry.performed_by_id is None
    assert entry.performed_at is not None  # server_default=func.now()


def test_audit_endpoint_labels_null_performed_by_as_system(client, db):
    user = make_user(db, "system-audit@premnathrail.com")
    create = client.post(
        "/api/v1/crm/organizations",
        json={"name": "System Audit Org"},
        headers=auth_header(user),
    )
    org_id = create.json()["id"]

    db.add(AuditLog(entity_type="organization", entity_id=org_id, action="auto_synced", performed_by_id=None))
    db.commit()

    logs = client.get(f"/api/v1/crm/organizations/{org_id}/audit", headers=auth_header(user)).json()
    system_entries = [log for log in logs if log["action"] == "auto_synced"]
    assert len(system_entries) == 1
    assert system_entries[0]["performed_by"] == "System"
