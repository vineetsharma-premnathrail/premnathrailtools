"""Store → Settings configurable types (entry/issue/return source/condition)
and the Material Return approval + quarantine flow they drive."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance

API = "/api/v1/store"


def _user(db, email, apps=("store",)):
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=list(apps))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def env(db):
    keeper = _user(db, "keeper@premnathrail.com")
    manager = _user(db, "wh.manager@premnathrail.com")
    hod = _user(db, "hod@premnathrail.com", apps=())  # no Store access
    qc = _user(db, "qc@premnathrail.com")
    dept = Department(name="Production", code="PROD", head_user_id=hod.id)
    loc = StoreLocation(name="Main Store", code="MS", manager_user_id=manager.id)
    item = StoreItem(item_code="MT-GEN-0001", item_name="Bolt M12", uom="NOS", item_type="material")
    db.add_all([dept, loc, item])
    db.commit()
    return {"keeper": keeper, "manager": manager, "hod": hod, "qc": qc, "dept": dept, "loc": loc, "item": item}


def _balance(db, env):
    db.expire_all()
    return db.query(StoreStockBalance).filter_by(item_id=env["item"].id, location_id=env["loc"].id).first()


def _return(client, env, **body):
    payload = {
        "location_id": env["loc"].id, "source_type": "other", "source_description": "Site surplus",
        "items": [{"item_id": env["item"].id, "quantity": 5, "condition": "good"}], **body,
    }
    return client.post(f"{API}/material-returns", json=payload, headers=_h(env["keeper"]))


def test_defaults_are_seeded_and_custom_entry_type_posts_by_effect(client, db, env):
    h = _h(env["keeper"])
    kinds = {k: [t["value"] for t in client.get(f"{API}/doc-types/{k}", headers=h).json()]
             for k in ("stock_entry", "issue", "return_source", "return_condition")}
    assert kinds["stock_entry"] == ["receipt", "issue", "damage"]
    assert "good" in kinds["return_condition"] and "other" in kinds["return_source"]

    bad = client.post(f"{API}/doc-types/stock_entry", json={"label": "Opening Balance"}, headers=h)
    assert bad.status_code == 400 and "Stock in" in bad.json()["detail"]
    t = client.post(f"{API}/doc-types/stock_entry", json={"label": "Opening Balance", "stock_effect": "in"}, headers=h).json()
    assert t["value"] == "opening_balance"

    txn = client.post(f"{API}/stock/transactions", json={
        "entry_type": "opening_balance", "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 10,
    }, headers=h)
    assert txn.status_code == 200, txn.text
    assert txn.json()["transaction_type"] == "manual_in" and txn.json()["entry_type_label"] == "Opening Balance"
    assert _balance(db, env).on_hand_qty == 10

    flip = client.put(f"{API}/doc-types/stock_entry/opening_balance", json={"label": "Opening Balance", "stock_effect": "out"}, headers=h)
    assert flip.status_code == 409 and "can't be changed" in flip.json()["detail"]


def test_good_return_against_nothing_needs_warehouse_manager(client, db, env):
    r = _return(client, env)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending_approval"
    assert [a["approver_user_ids"] for a in body["approvals"]] == [[env["manager"].id]]
    assert _balance(db, env) is None  # nothing posted yet

    own = client.post(f"{API}/material-returns/{body['id']}/approve", headers=_h(env["keeper"]))
    assert own.status_code == 403
    ok = client.post(f"{API}/material-returns/{body['id']}/approve", headers=_h(env["manager"]))
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    assert _balance(db, env).on_hand_qty == 5


def test_damaged_and_rejected_need_hod_and_qc_and_land_in_quarantine(client, db, env):
    h = _h(env["keeper"])
    client.put(f"{API}/doc-types/return_condition/rejected", json={
        "label": "Rejected (quality)", "stock_effect": "quarantine", "approver_rule": "specific_users", "approver_user_ids": [env["qc"].id],
    }, headers=h)
    client.put(f"{API}/doc-types/return_source/other", json={"label": "Other (no issue reference)", "approver_rule": "none"}, headers=h)

    no_dept = _return(client, env, items=[{"item_id": env["item"].id, "quantity": 2, "condition": "damaged"}])
    assert no_dept.status_code == 422 and "Department" in no_dept.json()["detail"]

    r = _return(client, env, department_id=env["dept"].id, items=[
        {"item_id": env["item"].id, "quantity": 2, "condition": "damaged"},
        {"item_id": env["item"].id, "quantity": 3, "condition": "rejected"},
    ])
    assert r.status_code == 200, r.text
    r = r.json()
    assert r["status"] == "pending_approval" and len(r["approvals"]) == 2

    # HOD has no Store access but can still open and approve it.
    assert client.get(f"{API}/material-returns/{r['id']}", headers=_h(env["hod"])).json()["can_act"] is True
    assert client.post(f"{API}/material-returns/{r['id']}/approve", headers=_h(env["hod"])).json()["status"] == "pending_approval"
    assert client.post(f"{API}/material-returns/{r['id']}/approve", headers=_h(env["qc"])).json()["status"] == "approved"
    bal = _balance(db, env)
    assert bal.on_hand_qty == 0 and bal.quarantine_qty == 5

    rel = client.post(f"{API}/stock/quarantine/clear", json={
        "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 3, "disposition": "release",
    }, headers=h)
    assert rel.status_code == 200, rel.text
    over = client.post(f"{API}/stock/quarantine/clear", json={
        "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 5, "disposition": "scrap",
    }, headers=h)
    assert over.status_code == 409
    bal = _balance(db, env)
    assert bal.on_hand_qty == 3 and bal.quarantine_qty == 2


def test_rejection_needs_reason_and_posts_nothing(client, db, env):
    r = _return(client, env).json()
    assert client.post(f"{API}/material-returns/{r['id']}/reject", json={"reason": " "}, headers=_h(env["manager"])).status_code == 400
    rej = client.post(f"{API}/material-returns/{r['id']}/reject", json={"reason": "Not received"}, headers=_h(env["manager"]))
    assert rej.json()["status"] == "rejected"
    assert _balance(db, env) is None


def test_creator_as_only_approver_is_blocked_with_a_fix(client, env, db):
    env["loc"].manager_user_id = env["keeper"].id
    db.commit()
    r = _return(client, env)
    assert r.status_code == 422 and "only approver" in r.json()["detail"]


def test_any_store_user_except_self_can_approve_an_adjustment(client, env):
    h = _h(env["keeper"])
    body = lambda approver: {"location_id": env["loc"].id, "approved_by_id": approver.id,  # noqa: E731
                             "items": [{"item_id": env["item"].id, "actual_quantity": 4}]}
    assert client.post(f"{API}/stock-adjustments", json=body(env["qc"]), headers=h).status_code == 200
    assert client.post(f"{API}/stock-adjustments", json=body(env["manager"]), headers=h).status_code == 200
    own = client.post(f"{API}/stock-adjustments", json=body(env["keeper"]), headers=h)
    assert own.status_code == 400 and "your own" in own.json()["detail"]


def test_issue_rules_require_challan_and_vendor(client, db, env):
    h = _h(env["keeper"])
    client.post(f"{API}/stock/transactions", json={
        "entry_type": "receipt", "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 20,
    }, headers=h)

    def issue(**body):
        return client.post(f"{API}/material-issues", json={
            "location_id": env["loc"].id, "issue_type": "general",
            "items": [{"item_id": env["item"].id, "quantity": 1}], **body,
        }, headers=h)

    def rules(**body):
        return client.put(f"{API}/settings/issue-rules", json=body, headers=h)

    assert issue().status_code == 200  # no rules → nothing extra asked

    bad = rules(vendor_issue_types=["nope"])
    assert bad.status_code == 400 and "nope" in bad.json()["detail"]

    r = rules(challan_issue_types=["project"], vendor_issue_types=["maintenance"])
    assert r.json() == {"challan_issue_types": ["project"], "challan_location_ids": [], "vendor_issue_types": ["maintenance"], "return_date_issue_types": []}
    assert issue().status_code == 200  # general isn't listed
    miss = issue(issue_type="project")
    assert miss.status_code == 422 and "Project / Site" in miss.json()["detail"]
    ok = issue(issue_type="project", challan_number=" DC-101 ")
    assert ok.status_code == 200 and ok.json()["challan_number"] == "DC-101"

    miss = issue(issue_type="maintenance")
    assert miss.status_code == 422 and "Vendor" in miss.json()["detail"]
    ok = issue(issue_type="maintenance", vendor_name="Shree Job Works")
    assert ok.status_code == 200 and ok.json()["vendor_name"] == "Shree Job Works"
    assert "Shree Job Works" in client.get(f"{API}/stock/vendor-options", headers=h).json()

    rules(return_date_issue_types=["general"])
    miss = issue()
    assert miss.status_code == 422 and "Enter the Date" in miss.json()["detail"]
    early = issue(issue_date="2026-10-05", expected_return_date="2026-10-01")
    assert early.status_code == 422 and "before the issue date" in early.json()["detail"]
    ok = issue(issue_date="2026-10-05", expected_return_date="2026-10-20")
    assert ok.status_code == 200 and ok.json()["expected_return_date"] == "2026-10-20"

    rules(challan_location_ids=[env["loc"].id])
    miss = issue()
    assert miss.status_code == 422 and "Main Store" in miss.json()["detail"]
