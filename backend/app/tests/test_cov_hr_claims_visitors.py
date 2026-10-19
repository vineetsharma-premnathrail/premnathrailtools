"""HR expense claims (draft -> submit -> approve/reject -> paid) and the
visitor log (pre-register, reception check-in/out, cancel), plus the
self-service vs HR-team access split for both."""
import pytest

from app.modules.hr.models.expense import HrExpenseClaim
from app.modules.hr.models.visitor import HrVisitor
from app.tests.test_cov_hr_support import *  # noqa: F401,F403

E = f"{HR}/expenses"
V = f"{HR}/visitors"

SELF_SERVICE_BUG = (
    "BUG: self-service gated by full-HR check — require_hr_module is applied router-wide in "
    "app/main.py (include_router(..., dependencies=[Depends(require_hr_module)])) so an employee "
    "without the 'hr' app gets 403 on My HR claims/visitor endpoints that use get_current_user"
)

PAST = "2025-01-10"


@pytest.fixture
def org(db):
    plant = make_branch(db, "P1")
    hr = make_user(db, "hr.accounts@premnathrail.com", branch_id=plant.id)
    mgr = make_user(db, "claims.manager@premnathrail.com", branch_id=plant.id)
    emp = make_user(db, "field.engineer@premnathrail.com", branch_id=plant.id, reporting_manager_id=mgr.id)
    return {"plant": plant, "hr": hr, "mgr": mgr, "emp": emp}


def new_claim(client, user, items=None, title="Site visit Delhi"):
    items = items if items is not None else [
        {"expense_date": PAST, "category": "local_conveyance", "amount": "350.00"},
        {"expense_date": PAST, "category": "food", "amount": "150.50"},
    ]
    r = client.post(E, json={"title": title, "items": items}, headers=hdr(user))
    assert r.status_code == 201, r.text
    return r.json()


# ─────────────────────────── expense claims ───────────────────────────

def test_claim_submit_approve_pay(client, db, org):
    emp, mgr, hr = org["emp"], org["mgr"], org["hr"]
    c = new_claim(client, emp)
    assert c["status"] == "draft" and float(c["total_amount"]) == 500.50
    assert c["claim_no"].startswith("EXP-")

    r = client.post(f"{E}/{c['id']}/submit", headers=hdr(emp))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "submitted" and r.json()["approver_id"] == mgr.id

    assert [x["id"] for x in client.get(f"{E}/approvals", headers=hdr(mgr)).json()] == [c["id"]]
    r = client.post(f"{E}/{c['id']}/approve", json={}, headers=hdr(emp))
    assert r.status_code == 403 and "your own" in r.json()["detail"]

    # Paying before approval is refused.
    r = client.post(f"{E}/{c['id']}/mark-paid", json={"payment_reference": "NEFT-1"}, headers=hdr(hr))
    assert r.status_code == 409 and "approved first" in r.json()["detail"]

    r = client.post(f"{E}/{c['id']}/approve", json={"remarks": "OK"}, headers=hdr(mgr))
    assert r.status_code == 200 and r.json()["status"] == "approved"

    r = client.post(f"{E}/{c['id']}/mark-paid", json={"payment_reference": "  NEFT-778  "}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    db.expire_all()
    claim = db.get(HrExpenseClaim, c["id"])
    assert claim.status == "paid" and claim.payment_reference == "NEFT-778" and claim.paid_by_id == hr.id
    assert claim.paid_on is not None

    # Paid claims are locked.
    r = client.patch(f"{E}/{c['id']}", json={"title": "Changed"}, headers=hdr(emp))
    assert r.status_code == 409


def test_claim_reject_needs_reason_then_resubmit(client, db, org):
    emp, mgr = org["emp"], org["mgr"]
    c = new_claim(client, emp)
    client.post(f"{E}/{c['id']}/submit", headers=hdr(emp))
    r = client.post(f"{E}/{c['id']}/reject", json={"remarks": ""}, headers=hdr(mgr))
    assert r.status_code == 400
    r = client.post(f"{E}/{c['id']}/reject", json={"remarks": "Split food bill"}, headers=hdr(mgr))
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert client.patch(f"{E}/{c['id']}", json={"title": "Site visit Delhi (fixed)"}, headers=hdr(emp)).status_code == 200
    r = client.post(f"{E}/{c['id']}/submit", headers=hdr(emp))
    assert r.status_code == 200 and r.json()["status"] == "submitted"


def test_claim_hr_cannot_pay_own_claim(client, db, org):
    hr, mgr = org["hr"], org["mgr"]
    hr.reporting_manager_id = mgr.id
    db.commit()
    c = new_claim(client, hr)
    client.post(f"{E}/{c['id']}/submit", headers=hdr(hr))
    client.post(f"{E}/{c['id']}/approve", json={}, headers=hdr(mgr))
    r = client.post(f"{E}/{c['id']}/mark-paid", json={"payment_reference": "X"}, headers=hdr(hr))
    assert r.status_code == 403


def test_claim_submit_rules(client, db, org):
    emp = org["emp"]
    empty = new_claim(client, emp, items=[])
    r = client.post(f"{E}/{empty['id']}/submit", headers=hdr(emp))
    assert r.status_code == 400 and "no expense lines" in r.json()["detail"]

    big = new_claim(client, emp, items=[{"expense_date": PAST, "category": "lodging", "amount": "2400"}])
    r = client.post(f"{E}/{big['id']}/submit", headers=hdr(emp))
    assert r.status_code == 400 and "Receipts are required" in r.json()["detail"]

    r = client.post(E, json={"title": "Future", "items": [{"expense_date": "2099-01-01", "category": "food", "amount": "10"}]},
                    headers=hdr(emp))
    assert r.status_code == 400 and "in the future" in r.json()["detail"]


def test_claim_cancel_and_visibility(client, db, org):
    emp, mgr = org["emp"], org["mgr"]
    c = new_claim(client, emp)
    client.post(f"{E}/{c['id']}/submit", headers=hdr(emp))
    assert client.post(f"{E}/{c['id']}/cancel", json={}, headers=hdr(mgr)).status_code == 403
    r = client.post(f"{E}/{c['id']}/cancel", json={"remarks": "Duplicate"}, headers=hdr(emp))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert client.post(f"{E}/{c['id']}/approve", json={}, headers=hdr(mgr)).status_code == 409


def test_claim_hr_screens_need_hr_app(client, db, org):
    outsider = make_user(db, "p2p.buyer@premnathrail.com", apps=("p2p",))
    assert client.get(E, headers=hdr(outsider)).status_code == 403
    assert client.post(f"{E}/1/mark-paid", json={"payment_reference": "X"}, headers=hdr(outsider)).status_code == 403


@pytest.mark.xfail(reason=SELF_SERVICE_BUG, strict=True)
def test_employee_without_hr_app_can_submit_claim(client, db, org):
    mgr = org["mgr"]
    plain = make_user(db, "plain.claimer@premnathrail.com", apps=("store",), reporting_manager_id=mgr.id)
    c = client.post(E, json={"title": "Taxi", "items": [{"expense_date": PAST, "category": "local_conveyance",
                                                         "amount": "200"}]}, headers=hdr(plain))
    assert c.status_code == 201, c.text
    assert client.post(f"{E}/{c.json()['id']}/submit", headers=hdr(plain)).status_code == 200
    assert client.get(f"{E}/mine", headers=hdr(plain)).status_code == 200


# ─────────────────────────── visitors ───────────────────────────

def test_employee_preregisters_and_reception_checks_in_out(client, db, org):
    emp, hr = org["emp"], org["hr"]
    r = client.post(V, json={"visitor_name": "Ravi Kumar", "visitor_company": "Acme Bearings",
                             "purpose": "Vendor audit", "id_proof_last4": "1234 5678 9012"}, headers=hdr(emp))
    assert r.status_code == 201, r.text
    v = r.json()
    assert v["status"] == "expected" and v["host_user_id"] == emp.id and v["branch_id"] == org["plant"].id
    assert v["id_proof_last4"] == "9012"
    assert v["visit_no"].startswith("VIS-")

    r = client.post(f"{V}/{v['id']}/check-in", json={"badge_no": "B-7", "check_in_at": "2026-10-07T09:00:00"}, headers=hdr(hr))
    assert r.status_code == 200 and r.json()["status"] == "checked_in" and r.json()["badge_no"] == "B-7"
    r = client.post(f"{V}/{v['id']}/check-in", json={}, headers=hdr(hr))
    assert r.status_code == 409

    r = client.post(f"{V}/{v['id']}/check-out", json={"check_out_at": "2026-10-07T08:00:00"}, headers=hdr(hr))
    assert r.status_code == 400 and "before the check-in" in r.json()["detail"]
    r = client.post(f"{V}/{v['id']}/check-out", json={"check_out_at": "2026-10-07T11:30:00", "remarks": "Left"}, headers=hdr(hr))
    assert r.status_code == 200 and r.json()["status"] == "checked_out"
    r = client.post(f"{V}/{v['id']}/cancel", json={}, headers=hdr(emp))
    assert r.status_code == 409

    mine = client.get(f"{V}/mine", headers=hdr(emp)).json()
    assert [x["id"] for x in mine] == [v["id"]]


def test_visitor_permissions(client, db, org):
    emp, hr, mgr = org["emp"], org["hr"], org["mgr"]
    # Only reception may register for another host or check in a walk-in.
    # (Every user in this fixture holds the hr app, so use a fresh non-HR user
    #  for the negative cases — they are refused either by the module gate or the rule.)
    outsider = make_user(db, "visiting.host@premnathrail.com", apps=("crm",))
    assert client.post(V, json={"visitor_name": "X", "host_user_id": mgr.id}, headers=hdr(outsider)).status_code == 403
    assert client.post(V, json={"visitor_name": "X", "check_in_now": True}, headers=hdr(outsider)).status_code == 403

    r = client.post(V, json={"visitor_name": "Walk In", "host_user_id": mgr.id, "check_in_now": True}, headers=hdr(hr))
    assert r.status_code == 201 and r.json()["status"] == "checked_in" and r.json()["host_user_id"] == mgr.id

    v = client.post(V, json={"visitor_name": "Planned"}, headers=hdr(emp)).json()
    assert client.get(f"{V}/{v['id']}", headers=hdr(outsider)).status_code == 403
    r = client.post(f"{V}/{v['id']}/cancel", json={"remarks": "Postponed"}, headers=hdr(emp))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert db.get(HrVisitor, v["id"]).remarks == "Cancelled: Postponed"


def test_reception_board_and_list_need_hr_app(client, db, org):
    outsider = make_user(db, "rnd.scientist@premnathrail.com", apps=("rnd",))
    for url in (V, f"{V}/board"):
        assert client.get(url, headers=hdr(outsider)).status_code == 403
    v = client.post(V, json={"visitor_name": "Gate"}, headers=hdr(org["emp"])).json()
    assert client.post(f"{V}/{v['id']}/check-in", json={}, headers=hdr(outsider)).status_code == 403
    r = client.get(f"{V}/board", headers=hdr(org["hr"]))
    assert r.status_code == 200 and set(r.json()) >= {"expected", "inside", "checked_out"}


@pytest.mark.xfail(reason=SELF_SERVICE_BUG, strict=True)
def test_employee_without_hr_app_can_preregister_own_visitor(client, db, org):
    plain = make_user(db, "plain.host@premnathrail.com", apps=("production",), branch_id=org["plant"].id)
    r = client.post(V, json={"visitor_name": "Supplier rep"}, headers=hdr(plain))
    assert r.status_code == 201, r.text
    assert client.get(f"{V}/mine", headers=hdr(plain)).status_code == 200
