"""Master-data delete/rename guards: a plant, cost center, internal order or
unit that is already used on records is never hard-deleted (or re-coded) —
it is deactivated / closed instead, so posted documents keep their meaning."""
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine
from app.modules.main.models.user import User
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.branch_address import BranchAddress
from app.modules.organization.models.cost_center import CostCenter
from app.modules.store.models.location import StoreLocation

API = "/api/v1"


def _headers(user: User) -> dict:
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(db):
    u = User(email="md.admin@example.com", name="Admin", role="admin", is_active=True,
             assigned_apps=["store", "accounts"])
    db.add(u)
    db.commit()
    return _headers(u)


@pytest.fixture
def plain_user(db):
    u = User(email="requester@example.com", name="Requester", role="user", is_active=True, assigned_apps=["p2p"])
    db.add(u)
    db.commit()
    return _headers(u)


def _branch(db, code="GZB", name="Ghaziabad") -> Branch:
    b = Branch(code=code, name=name)
    db.add(b)
    db.commit()
    return b


def _journal_line(db, **refs) -> None:
    gl = db.query(GLAccount).filter(GLAccount.code == "5000").first()
    if not gl:
        gl = GLAccount(code="5000", name="Repairs", account_type="expense")
        db.add(gl)
        db.flush()
    je = JournalEntry(entry_number=f"JV-{db.query(JournalEntry).count() + 1}", posting_date=date(2026, 10, 1),
                      accounting_period="2026-10", total_debit=100, total_credit=100)
    db.add(je)
    db.flush()
    db.add(JournalEntryLine(journal_entry_id=je.id, line_number=1, gl_account_id=gl.id, debit_amount=100, **refs))
    db.commit()


# --- Plants -----------------------------------------------------------------

def test_unused_branch_deletes_with_its_own_child_rows(client, db, admin):
    b = _branch(db)
    db.add(BranchAddress(branch_id=b.id, **_address_fields()))
    db.commit()
    r = client.delete(f"{API}/organization/branches/{b.id}", headers=admin)
    assert r.status_code == 204, r.text
    assert db.query(Branch).count() == 0
    assert db.query(BranchAddress).count() == 0


def test_branch_delete_removes_its_per_plant_setting_overrides(client, db, admin):
    ModuleSetting = pytest.importorskip("app.modules.main.models.module_setting").ModuleSetting
    ModuleSetting.__table__.create(bind=db.get_bind(), checkfirst=True)
    b = _branch(db)
    db.add(ModuleSetting(module_key="store", key="sample_per_plant_key", branch_id=b.id, value=5))
    db.add(ModuleSetting(module_key="store", key="sample_per_plant_key", branch_id=None, value=3))
    db.commit()
    r = client.delete(f"{API}/organization/branches/{b.id}", headers=admin)
    assert r.status_code == 204, r.text
    assert db.query(ModuleSetting).filter(ModuleSetting.branch_id == b.id).count() == 0
    # The company-wide value is untouched.
    assert db.query(ModuleSetting).filter(ModuleSetting.branch_id.is_(None)).count() == 1


def _address_fields() -> dict:
    # Fill whatever non-null columns the address model has with a sample value.
    fields = {}
    for col in BranchAddress.__table__.columns:
        if col.name in ("id", "branch_id", "created_at", "updated_at") or col.nullable or col.default is not None:
            continue
        fields[col.name] = "X"
    return fields


def test_branch_in_use_returns_409_naming_the_uses(client, db, admin):
    b = _branch(db)
    db.add(MaintenanceAsset(asset_code="MA-1", name="Lathe", branch_id=b.id))
    db.add(StoreLocation(code="WH-1", name="Main store", branch_id=b.id))
    db.commit()
    r = client.delete(f"{API}/organization/branches/{b.id}", headers=admin)
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert "Ghaziabad" in detail
    assert "1 maintenance asset(s)" in detail and "1 store location(s)" in detail
    assert "Inactive" in detail
    assert db.query(Branch).count() == 1


def test_branch_used_by_sales_order_returns_409(client, db, admin):
    SalesOrder = pytest.importorskip("app.modules.sales.models.order").SalesOrder
    b = _branch(db)
    # SQLite doesn't enforce FKs, so a placeholder customer id is enough here.
    db.add(SalesOrder(customer_id=1, branch_id=b.id))
    db.commit()
    r = client.delete(f"{API}/organization/branches/{b.id}", headers=admin)
    assert r.status_code == 409, r.text
    assert "1 sales order(s)" in r.json()["detail"]
    assert db.query(Branch).count() == 1


def test_branch_delete_blocked_by_any_unlisted_fk_to_branches(client, db, admin):
    """Safety net: a table that references branches.id but isn't in the explicit
    usage list (e.g. a newly added module) still blocks the delete."""
    from sqlalchemy import Column, ForeignKey, Integer, Table
    from app.db.base import Base

    table = Table("zz_test_plant_refs", Base.metadata,
                  Column("id", Integer, primary_key=True),
                  Column("plant_id", Integer, ForeignKey("branches.id")))
    try:
        table.create(bind=db.get_bind(), checkfirst=True)
        b = _branch(db)
        db.execute(table.insert().values(plant_id=b.id))
        db.commit()
        r = client.delete(f"{API}/organization/branches/{b.id}", headers=admin)
        assert r.status_code == 409, r.text
        assert "1 zz test plant refs record(s)" in r.json()["detail"]
    finally:
        table.drop(bind=db.get_bind(), checkfirst=True)
        Base.metadata.remove(table)


# --- Cost centers -----------------------------------------------------------

def test_cost_center_used_on_journal_line_returns_409(client, db, admin):
    cc = CostCenter(code="CC-MFG", name="Manufacturing")
    db.add(cc)
    db.commit()
    _journal_line(db, cost_center_id=cc.id)
    r = client.delete(f"{API}/organization/cost-centers/{cc.id}", headers=admin)
    assert r.status_code == 409
    assert "CC-MFG" in r.json()["detail"] and "1 journal line(s)" in r.json()["detail"]
    assert db.query(CostCenter).count() == 1


def test_unused_cost_center_deletes(client, db, admin):
    cc = CostCenter(code="CC-TMP", name="Temp")
    db.add(cc)
    db.commit()
    r = client.delete(f"{API}/organization/cost-centers/{cc.id}", headers=admin)
    assert r.status_code == 200, r.text
    assert db.query(CostCenter).count() == 0


# --- Internal orders ----------------------------------------------------------

def test_internal_order_used_on_journal_line_returns_409(client, db, admin):
    io = InternalOrder(code="IO-001", name="Shed roof", order_type="maintenance")
    db.add(io)
    db.commit()
    _journal_line(db, internal_order_id=io.id)
    r = client.delete(f"{API}/accounts/internal-orders/{io.id}", headers=admin)
    assert r.status_code == 409
    assert "IO-001" in r.json()["detail"] and "1 posted journal line(s)" in r.json()["detail"]
    assert db.query(InternalOrder).count() == 1


def test_unused_internal_order_deletes(client, db, admin):
    io = InternalOrder(code="IO-002", name="Unused", order_type="it")
    db.add(io)
    db.commit()
    assert client.delete(f"{API}/accounts/internal-orders/{io.id}", headers=admin).status_code == 200
    assert db.query(InternalOrder).count() == 0


# --- Store UOMs ---------------------------------------------------------------

def test_uom_create_needs_store_app(client, plain_user):
    assert client.get(f"{API}/store/uoms", headers=plain_user).status_code == 200
    r = client.post(f"{API}/store/uoms", json={"code": "BOX", "label": "Box"}, headers=plain_user)
    assert r.status_code == 403
    r = client.put(f"{API}/store/uoms/NOS", json={"code": "NOS", "label": "Numbers"}, headers=plain_user)
    assert r.status_code == 403


def test_used_uom_code_is_frozen_but_name_can_change(client, admin):
    assert client.post(f"{API}/store/uoms", json={"code": "BOX", "label": "Box"}, headers=admin).status_code == 200
    r = client.post(f"{API}/store/items", json={"item_name": "Gloves", "uom": "BOX"}, headers=admin)
    assert r.status_code in (200, 201), r.text
    r = client.put(f"{API}/store/uoms/BOX", json={"code": "CTN", "label": "Carton"}, headers=admin)
    assert r.status_code == 409
    assert "1 store item(s)" in r.json()["detail"] and "only its name" in r.json()["detail"]
    r = client.put(f"{API}/store/uoms/BOX", json={"code": "BOX", "label": "Box of 10"}, headers=admin)
    assert r.status_code == 200
    assert any(o["value"] == "BOX" and "Box of 10" in o["label"] for o in r.json())


def test_unused_uom_code_can_change(client, admin):
    client.post(f"{API}/store/uoms", json={"code": "ROLL", "label": "Roll"}, headers=admin)
    r = client.put(f"{API}/store/uoms/ROLL", json={"code": "RL", "label": "Roll"}, headers=admin)
    assert r.status_code == 200
    assert "RL" in [o["value"] for o in r.json()]
