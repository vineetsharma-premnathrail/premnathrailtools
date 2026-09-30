"""
Tests for the automatic ORM-level audit trail (app/core/audit.py) covering
Quality, Store and Organization, and for Quality's switch to soft delete.

Quality/Store document numbers are generated under a Postgres advisory lock,
which SQLite can't run, so those records are inserted directly through the
ORM here. Updates and deletes still go through the real routes.
"""
import json
from datetime import date

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.quality.models.ncr import QualityNcr
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.item import StoreItem
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.services.stock_ledger import post_stock_transaction


def make_user(db, email, name="Test User", role="user", assigned_apps=None):
    user = User(
        email=email, name=name, role=role, is_active=True,
        assigned_apps=assigned_apps if assigned_apps is not None else ["quality", "store"],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def logs_for(db, entity_type, entity_id):
    return db.query(AuditLog).filter(
        AuditLog.entity_type == entity_type, AuditLog.entity_id == entity_id
    ).order_by(AuditLog.id).all()


def make_ncr(db, number="NCR-2026-0001"):
    ncr = QualityNcr(
        ncr_number=number, source="internal", severity="minor", status="open",
        item_name="Brake shoe", description="Surface crack", ncr_date=date(2026, 9, 1),
    )
    db.add(ncr)
    db.commit()
    db.refresh(ncr)
    return ncr


# ---------------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------------

def test_ncr_update_records_field_level_old_and_new_values(client, db):
    user = make_user(db, "qa@premnathrail.com", name="QA Engineer")
    ncr = make_ncr(db)

    resp = client.patch(f"/api/v1/quality/ncr/{ncr.id}", json={"status": "closed", "severity": "major"}, headers=auth_header(user))
    assert resp.status_code == 200

    logs = logs_for(db, "quality_ncr", ncr.id)
    assert [log.action for log in logs] == ["created", "updated"]
    update = logs[1]
    assert update.module_key == "quality"
    assert update.performed_by_id == user.id
    assert update.api_source == "bearer_token"
    old, new = json.loads(update.old_value), json.loads(update.new_value)
    assert old["status"] == "open" and new["status"] == "closed"
    assert old["severity"] == "minor" and new["severity"] == "major"
    assert "NCR-2026-0001" in update.summary and "status (open → closed)" in update.summary


def test_ncr_delete_is_soft_and_keeps_a_full_snapshot(client, db):
    user = make_user(db, "qa2@premnathrail.com")
    ncr = make_ncr(db)

    assert client.delete(f"/api/v1/quality/ncr/{ncr.id}", headers=auth_header(user)).status_code == 200

    db.expire_all()
    row = db.query(QualityNcr).filter(QualityNcr.id == ncr.id).first()
    assert row is not None and row.is_deleted is True and row.deleted_at is not None

    assert client.get(f"/api/v1/quality/ncr/{ncr.id}", headers=auth_header(user)).status_code == 404
    assert all(n["id"] != ncr.id for n in client.get("/api/v1/quality/ncr", headers=auth_header(user)).json())

    delete_log = logs_for(db, "quality_ncr", ncr.id)[-1]
    assert delete_log.action == "deleted"
    assert delete_log.performed_by_id == user.id
    snapshot = json.loads(delete_log.old_value)
    assert snapshot["ncr_number"] == "NCR-2026-0001"
    assert snapshot["description"] == "Surface crack"
    assert "record retained" in delete_log.summary


def test_deleted_ncr_cannot_be_linked_from_a_rejection(client, db):
    user = make_user(db, "qa3@premnathrail.com")
    ncr = make_ncr(db)
    client.delete(f"/api/v1/quality/ncr/{ncr.id}", headers=auth_header(user))

    # A soft-deleted NCR must behave as missing for new links, not silently accept them.
    from app.modules.quality.models.rejection import QualityRejection
    rejection = QualityRejection(
        rejection_number="REJ-2026-0001", item_name="Brake shoe", disposition="scrap",
        status="open", rejection_date=date(2026, 9, 2),
    )
    db.add(rejection)
    db.commit()
    resp = client.patch(f"/api/v1/quality/rejections/{rejection.id}", json={"ncr_id": ncr.id}, headers=auth_header(user))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

def test_store_item_create_update_delete_are_audited(client, db):
    user = make_user(db, "store@premnathrail.com")
    headers = auth_header(user)

    item_id = client.post("/api/v1/store/items", json={"item_code": "ITM-1", "item_name": "Bolt M12", "uom": "NOS"}, headers=headers).json()["id"]
    client.patch(f"/api/v1/store/items/{item_id}", json={"item_name": "Bolt M12 x 50"}, headers=headers)
    client.delete(f"/api/v1/store/items/{item_id}", headers=headers)

    logs = logs_for(db, "store_item", item_id)
    assert [log.action for log in logs] == ["created", "updated", "deleted"]
    assert all(log.module_key == "store" and log.performed_by_id == user.id for log in logs)
    assert logs[1].field_name == "item_name"
    assert json.loads(logs[2].old_value)["item_code"] == "ITM-1"


def test_manual_stock_posting_is_audited(client, db):
    user = make_user(db, "store2@premnathrail.com")
    headers = auth_header(user)
    location_id = client.post("/api/v1/store/locations", json={"name": "Main", "code": "WH-1"}, headers=headers).json()["id"]
    item_id = client.post("/api/v1/store/items", json={"item_code": "ITM-2", "item_name": "Nut", "uom": "NOS"}, headers=headers).json()["id"]

    resp = client.post(
        "/api/v1/store/stock/transactions",
        json={"item_id": item_id, "location_id": location_id, "transaction_type": "receipt", "quantity": 10},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    txn_logs = db.query(AuditLog).filter(AuditLog.entity_type == "store_stock_transaction").all()
    assert len(txn_logs) == 1
    assert txn_logs[0].action == "created" and txn_logs[0].performed_by_id == user.id
    assert json.loads(txn_logs[0].new_value)["quantity"] == 10


def test_store_document_lines_are_logged_on_the_parent_and_ledger_rows_are_not_duplicated(db):
    location = StoreLocation(name="Main", code="WH-9")
    item = StoreItem(item_code="ITM-9", item_name="Washer")
    db.add_all([location, item])
    db.commit()
    post_stock_transaction(db, item_id=item.id, location_id=location.id, transaction_type="receipt", quantity=5, reference_type="manual")
    db.commit()

    issue = StoreMaterialIssue(issue_number="MI-2026-0001", location_id=location.id, issue_date=date(2026, 9, 3))
    db.add(issue)
    db.flush()
    db.add(StoreMaterialIssueItem(issue_id=issue.id, item_id=item.id, quantity=2))
    post_stock_transaction(
        db, item_id=item.id, location_id=location.id, transaction_type="issue", quantity=2,
        reference_type="material_issue", reference_number=issue.issue_number,
    )
    db.commit()

    issue_logs = logs_for(db, "store_material_issue", issue.id)
    assert sorted(log.action for log in issue_logs) == ["created", "line_added"]
    ledger_logs = db.query(AuditLog).filter(AuditLog.entity_type == "store_stock_transaction").all()
    # Only the manual receipt; the issue's ledger posting is covered by the issue's own rows.
    assert len(ledger_logs) == 1


# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------

def test_department_head_change_is_audited_with_names(client, db):
    admin = make_user(db, "admin@premnathrail.com", name="Admin", role="admin", assigned_apps=[])
    old_head = make_user(db, "old.head@premnathrail.com", name="Old Head")
    new_head = make_user(db, "new.head@premnathrail.com", name="New Head")
    headers = auth_header(admin)

    dept_id = client.post("/api/v1/organization/departments", json={"name": "Purchase", "head_user_id": old_head.id}, headers=headers).json()["id"]
    client.patch(f"/api/v1/organization/departments/{dept_id}", json={"head_user_id": new_head.id}, headers=headers)

    logs = logs_for(db, "department", dept_id)
    assert [log.action for log in logs] == ["created", "updated"]
    update = logs[1]
    assert update.performed_by_id == admin.id
    assert json.loads(update.old_value) == {"head_user_id": old_head.id}
    assert json.loads(update.new_value) == {"head_user_id": new_head.id}
    assert "Old Head → New Head" in update.summary


def test_department_membership_and_delete_are_audited(client, db):
    admin = make_user(db, "admin2@premnathrail.com", role="admin", assigned_apps=[])
    member = make_user(db, "member@premnathrail.com", name="Member")
    headers = auth_header(admin)

    dept_id = client.post("/api/v1/organization/departments", json={"name": "Stores"}, headers=headers).json()["id"]
    client.post(f"/api/v1/organization/departments/{dept_id}/members", json={"user_id": member.id}, headers=headers)
    client.delete(f"/api/v1/organization/departments/{dept_id}/members/{member.id}", headers=headers)
    assert client.delete(f"/api/v1/organization/departments/{dept_id}", headers=headers).status_code == 204

    actions = [log.action for log in logs_for(db, "department", dept_id)]
    assert actions == ["created", "member_added", "member_removed", "deleted"]
    deleted = logs_for(db, "department", dept_id)[-1]
    assert json.loads(deleted.old_value)["name"] == "Stores"
    assert "permanently deleted" in deleted.summary


def test_audit_log_screen_filters_new_modules_in_sql(client, db):
    admin = make_user(db, "admin3@premnathrail.com", role="admin", assigned_apps=["quality", "store"])
    headers = auth_header(admin)
    make_ncr(db)
    client.post("/api/v1/store/items", json={"item_code": "ITM-3", "item_name": "Pin", "uom": "NOS"}, headers=headers)

    quality = client.get("/api/v1/organization/audit-logs", params={"module_key": "quality"}, headers=headers).json()
    store = client.get("/api/v1/organization/audit-logs", params={"module_key": "store"}, headers=headers).json()
    assert quality and all(log["module_key"] == "quality" for log in quality)
    assert store and all(log["module_key"] == "store" for log in store)

    dashboard = client.get("/api/v1/organization/audit-logs/dashboard", headers=headers).json()
    assert dashboard["by_module"].get("quality") and dashboard["by_module"].get("store")
