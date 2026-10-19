"""Store → Settings configurable types (entry/issue/return source/condition)
and the Material Return approval + quarantine flow they drive (routed by the
central approval engine, workflow "store.material_return")."""
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.routes.stock import MANUAL_ENTRY_REMOVED
from app.tests._stock_seed import seed_opening_stock

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


def test_defaults_are_seeded_and_stock_entry_types_are_history_only(client, db, env):
    h = _h(env["keeper"])
    kinds = {k: [t["value"] for t in client.get(f"{API}/doc-types/{k}", headers=h).json()]
             for k in ("stock_entry", "issue", "return_source", "return_condition")}
    assert kinds["stock_entry"] == ["receipt", "issue", "damage"]  # kept so old entries show their labels
    assert "good" in kinds["return_condition"] and "other" in kinds["return_source"]

    # Record Stock Entry is removed (2026-10-12): its types can't be added or changed.
    add = client.post(f"{API}/doc-types/stock_entry", json={"label": "Opening Balance", "stock_effect": "in"}, headers=h)
    assert add.status_code == 410 and "Record Stock Entry was removed" in add.json()["detail"]
    edit = client.put(f"{API}/doc-types/stock_entry/receipt", json={"label": "Receipt", "stock_effect": "out"}, headers=h)
    assert edit.status_code == 410
    txn = client.post(f"{API}/stock/transactions", json={
        "entry_type": "receipt", "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 10,
    }, headers=_h(env["manager"]))
    assert txn.status_code == 410 and txn.json()["detail"] == MANUAL_ENTRY_REMOVED


def _approval(client, ret_id, user):
    return client.get(f"/api/v1/approvals/entity/material_return/{ret_id}", headers=_h(user)).json()["current"]


def test_good_return_against_nothing_needs_warehouse_manager(client, db, env):
    r = _return(client, env)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending_approval"
    req = _approval(client, body["id"], env["manager"])
    assert [s["approver_id"] for s in req["steps"]] == [env["manager"].id] and req["can_decide"] is True
    assert _balance(db, env) is None  # nothing posted yet

    own = client.post(f"{API}/material-returns/{body['id']}/approve", headers=_h(env["keeper"]))
    assert own.status_code == 403
    ok = client.post(f"{API}/material-returns/{body['id']}/approve", headers=_h(env["manager"]))
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    assert _balance(db, env).on_hand_qty == 5


def test_damaged_and_rejected_need_hod_and_qc_and_land_in_quarantine(client, db, env):
    from app.modules.store.models.doc_type import StoreDocType

    h = _h(env["keeper"])
    admin = User(email="returns.admin@premnathrail.com", name="admin", role="admin", is_active=True)
    db.add(admin)
    db.commit()
    # The QC approver named on "Rejected" before the move seeds that stage of
    # the central workflow (created on first use from the live return types)…
    client.get(f"{API}/doc-types/return_condition", headers=h)
    rejected = db.query(StoreDocType).filter_by(kind="return_condition", value="rejected").one()
    rejected.approver_user_ids = [env["qc"].id]
    db.commit()
    # … and can no longer be changed here (Organization › Approval Workflows).
    moved = client.put(f"{API}/doc-types/return_condition/rejected", json={
        "label": "Rejected (quality)", "stock_effect": "quarantine", "approver_rule": "specific_users", "approver_user_ids": [env["keeper"].id],
    }, headers=_h(admin))
    assert moved.status_code == 409 and "Approval Workflows" in moved.json()["detail"]

    no_dept = _return(client, env, items=[{"item_id": env["item"].id, "quantity": 2, "condition": "damaged"}])
    assert no_dept.status_code == 422 and "Department" in no_dept.json()["detail"]

    r = _return(client, env, department_id=env["dept"].id, items=[
        {"item_id": env["item"].id, "quantity": 2, "condition": "damaged"},
        {"item_id": env["item"].id, "quantity": 3, "condition": "rejected"},
    ])
    assert r.status_code == 200, r.text
    r = r.json()
    # 'Other' source → warehouse manager, damaged → HOD, rejected → QC (stages in that order).
    req = _approval(client, r["id"], env["keeper"])
    assert r["status"] == "pending_approval"
    assert [s["approver_id"] for s in req["steps"]] == [env["manager"].id, env["hod"].id, env["qc"].id]

    early = client.post(f"{API}/material-returns/{r['id']}/approve", headers=_h(env["hod"]))
    assert early.status_code == 403  # not the HOD's stage yet
    assert client.post(f"{API}/material-returns/{r['id']}/approve", headers=_h(env["manager"])).json()["status"] == "pending_approval"
    # HOD has no Store access but can still open and approve it.
    assert client.get(f"{API}/material-returns/{r['id']}", headers=_h(env["hod"])).status_code == 200
    assert _approval(client, r["id"], env["hod"])["can_decide"] is True
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
    assert r.status_code == 422 and "can't approve your own return" in r.json()["detail"]


def test_good_return_against_an_issue_posts_at_once(client, db, env):
    seed_opening_stock(db, env["item"].id, env["loc"].id, 10, created_by_id=env["manager"].id)
    issue = client.post(f"{API}/material-issues", json={
        "location_id": env["loc"].id, "issue_type": "production", "items": [{"item_id": env["item"].id, "quantity": 4}],
    }, headers=_h(env["keeper"]))
    assert issue.status_code == 200, issue.text
    r = _return(client, env, source_type="issue", source_issue_id=issue.json()["id"],
                items=[{"item_id": env["item"].id, "quantity": 1, "condition": "good"}])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"  # no stage applies, so the engine approves it at once
    assert _balance(db, env).on_hand_qty == 7


def test_requester_can_withdraw_and_reject_goes_through_engine(client, db, env):
    from app.modules.organization.services import approval_engine as engine

    r = _return(client, env).json()
    req = engine.latest_request(db, "material_return", r["id"])
    out = client.post(f"/api/v1/approvals/requests/{req.id}/cancel", json={"reason": "Raised twice"}, headers=_h(env["keeper"]))
    assert out.status_code == 200, out.text
    assert client.get(f"{API}/material-returns/{r['id']}", headers=_h(env["keeper"])).json()["status"] == "cancelled"

    r2 = _return(client, env).json()
    req2 = engine.latest_request(db, "material_return", r2["id"])
    no_comment = client.post(f"/api/v1/approvals/requests/{req2.id}/decide", json={"decision": "reject"}, headers=_h(env["manager"]))
    assert no_comment.status_code == 422
    rej = client.post(f"/api/v1/approvals/requests/{req2.id}/decide", json={"decision": "reject", "comment": "Not received"},
                      headers=_h(env["manager"]))
    assert rej.status_code == 200, rej.text
    body = client.get(f"{API}/material-returns/{r2['id']}", headers=_h(env["keeper"])).json()
    assert body["status"] == "rejected" and body["rejected_reason"] == "Not received"
    assert _balance(db, env) is None


def test_return_raised_before_the_engine_finishes_on_its_old_steps(client, db, env):
    """In-flight at cut-over: no engine request, so the old step path decides it."""
    from app.modules.store.models.material_return import StoreMaterialReturn, StoreMaterialReturnApproval, StoreMaterialReturnItem

    ret = StoreMaterialReturn(return_number="MR-OLD-0001", location_id=env["loc"].id, source_type="other",
                              return_date=date.today(), returned_by_id=env["keeper"].id, status="pending_approval")
    ret.items.append(StoreMaterialReturnItem(item_id=env["item"].id, quantity=2, condition="good"))
    ret.approvals.append(StoreMaterialReturnApproval(rule="warehouse_manager", label="Store in-charge — Other",
                                                     approver_user_ids=[env["manager"].id], status="pending"))
    db.add(ret)
    db.commit()
    assert client.get(f"{API}/material-returns/{ret.id}", headers=_h(env["manager"])).json()["can_act"] is True
    ok = client.post(f"{API}/material-returns/{ret.id}/approve", headers=_h(env["manager"]))
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    assert _balance(db, env).on_hand_qty == 2


def test_only_a_store_manager_other_than_self_can_approve_an_adjustment(client, db, env):
    """C-09: the approver must be a Store Manager — the store's own manager or
    a user with the Store Manager flag — and never the creator."""
    h = _h(env["keeper"])
    body = lambda approver: {"location_id": env["loc"].id, "approved_by_id": approver.id,  # noqa: E731
                             "items": [{"item_id": env["item"].id, "actual_quantity": 4}]}
    plain = client.post(f"{API}/stock-adjustments", json=body(env["qc"]), headers=h)
    assert plain.status_code == 400 and "Store Manager" in plain.json()["detail"]
    assert client.post(f"{API}/stock-adjustments", json=body(env["manager"]), headers=h).status_code == 200  # store's manager
    env["qc"].is_store_manager = True
    db.commit()
    assert client.post(f"{API}/stock-adjustments", json=body(env["qc"]), headers=h).status_code == 200  # flagged manager
    own = client.post(f"{API}/stock-adjustments", json=body(env["keeper"]), headers=h)
    assert own.status_code == 400 and "your own" in own.json()["detail"]


def test_issue_rules_require_challan_and_vendor(client, db, env):
    """Issue Rules settings were retired (2026-10-12): each issue type now
    carries its own fixed form standard (store/issue_forms.py)."""
    h = _h(env["keeper"])
    seed_opening_stock(db, env["item"].id, env["loc"].id, 20, created_by_id=env["manager"].id)
    assert client.get(f"{API}/settings/issue-rules", headers=h).status_code in (404, 405)
    assert client.put(f"{API}/settings/issue-rules", json={"vendor_issue_types": ["general"]}, headers=h).status_code in (404, 405)

    def issue(**body):
        return client.post(f"{API}/material-issues", json={
            "location_id": env["loc"].id, "issue_type": "general",
            "items": [{"item_id": env["item"].id, "quantity": 1}], **body,
        }, headers=h)

    miss = issue()
    assert miss.status_code == 422 and "Department" in miss.json()["detail"]
    ok = issue(department_id=env["dept"].id)
    assert ok.status_code == 200 and ok.json()["department_id"] == env["dept"].id

    miss = issue(issue_type="project")
    assert miss.status_code == 422
    assert "Project / machine" in miss.json()["detail"] and "Delivery challan no." in miss.json()["detail"]

    miss = issue(issue_type="maintenance")
    assert miss.status_code == 422 and "Maintenance work order or Machine / asset" in miss.json()["detail"]

    # Fields a type doesn't list are dropped on save.
    ok = issue(department_id=env["dept"].id, challan_number="DC-1", vendor_name="Someone")
    assert ok.status_code == 200 and ok.json()["challan_number"] is None and ok.json()["vendor_name"] is None


def test_adjustment_goes_through_engine_and_old_ones_finish_on_old_path(client, db, env):
    from app.modules.organization.services import approval_engine as engine
    from app.modules.store.models.stock_adjustment import StoreStockAdjustment, StoreStockAdjustmentItem

    env["manager"].granular_permissions = ["store:adjustments:view", "store:adjustments:approve", "store:adjustments:reject"]
    db.commit()
    body = {"location_id": env["loc"].id, "approved_by_id": env["manager"].id, "items": [{"item_id": env["item"].id, "actual_quantity": 4}]}
    adj = client.post(f"{API}/stock-adjustments", json=body, headers=_h(env["keeper"]))
    assert adj.status_code == 200 and adj.json()["status"] == "pending_approval", adj.text
    req = engine.latest_request(db, "stock_adjustment", adj.json()["id"])
    assert [s.approver_id for s in req.steps] == [env["manager"].id]
    rej = client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "reject", "comment": "Recount bin A"},
                      headers=_h(env["manager"]))
    assert rej.status_code == 200, rej.text
    out = client.get(f"{API}/stock-adjustments/{adj.json()['id']}", headers=_h(env["manager"])).json()
    assert out["status"] == "rejected" and out["rejected_reason"] == "Recount bin A"

    old = StoreStockAdjustment(adjustment_number="SA-OLD-0001", location_id=env["loc"].id, adjustment_date=date.today(),
                               approved_by_id=env["manager"].id, created_by_id=env["keeper"].id, status="pending_approval")
    old.items.append(StoreStockAdjustmentItem(item_id=env["item"].id, existing_quantity=0, actual_quantity=3, difference=3))
    db.add(old)
    db.commit()
    ok = client.post(f"{API}/stock-adjustments/{old.id}/approve", headers=_h(env["manager"]))
    assert ok.status_code == 200 and ok.json()["status"] == "approved", ok.text
    assert _balance(db, env).on_hand_qty == 3


def test_issue_types_are_fixed_and_job_work_scrap_sample_rules_apply(client, db, env):
    from app.modules.accounts.models.vendor import Vendor
    from app.modules.crm.models.organization import Organization

    h = _h(env["keeper"])
    seed_opening_stock(db, env["item"].id, env["loc"].id, 20, created_by_id=env["manager"].id)
    values = [t["value"] for t in client.get(f"{API}/doc-types/issue", headers=h).json()]
    assert values == ["production", "maintenance", "project", "general", "rework", "testing", "job_work", "scrap",
                      "customer_sample", "dispatch", "service"]
    vendor = Vendor(code="V-SHREE", name="Shree Machining", status="active")
    customer = Organization(name="Northern Railway")
    db.add_all([vendor, customer])
    db.commit()

    def issue(user=None, **body):
        return client.post(f"{API}/material-issues", json={
            "location_id": env["loc"].id, "items": [{"item_id": env["item"].id, "quantity": 1}], **body},
            headers=_h(user) if user else h)

    jw = issue(issue_type="job_work")
    detail = jw.json()["detail"]
    assert jw.status_code == 422
    for need in ("Vendor", "Process", "Expected return date", "Delivery challan no."):
        assert need in detail
    bad = issue(issue_type="job_work", vendor_id=vendor.id, process="painting", challan_number="DC-9",
                expected_return_date="2099-01-01")
    assert bad.status_code == 422 and "Process must be one of" in bad.json()["detail"]
    jw = issue(issue_type="job_work", vendor_id=vendor.id, process="machining", challan_number="DC-9",
               expected_return_date="2099-01-01", vendor_name="Typed name")
    assert jw.status_code == 200, jw.text
    assert jw.json()["vendor_name"] == "Shree Machining"  # from the Vendor master, not the payload

    scrap = issue(env["manager"], issue_type="scrap")
    assert scrap.status_code == 422 and "scrapping" in scrap.json()["detail"]
    plain = issue(issue_type="scrap", remarks="Corroded beyond use")
    assert plain.status_code == 403 and "Store Manager" in plain.json()["detail"]
    assert issue(env["manager"], issue_type="scrap", remarks="Corroded beyond use").status_code == 200
    sold = issue(env["manager"], issue_type="scrap", remarks="Sold as scrap", scrap_buyer="Kabadi & Co")
    assert sold.status_code == 422 and "Delivery challan no." in sold.json()["detail"]

    sample = issue(issue_type="customer_sample", challan_number="DC-10")
    assert sample.status_code == 422
    for need in ("Customer", "Purpose", "Returnable"):
        assert need in sample.json()["detail"]
    base = {"issue_type": "customer_sample", "customer_id": customer.id, "purpose": "trial", "challan_number": "DC-10"}
    assert issue(**base, returnable=False).status_code == 200  # not coming back → no return date
    back = issue(**base, returnable=True)
    assert back.status_code == 422 and "Expected return date" in back.json()["detail"]
    assert issue(**base, returnable=True, expected_return_date="2099-01-01").status_code == 200
