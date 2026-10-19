"""IDOR / object-level authorization regressions for HR, Organization and
Accounts: by-id HR actions respect the HR data scope (travel complete,
lifecycle checklist items, asset history by employee, attendance delete,
legacy leave decisions), the central approval-status endpoint only discloses
to the approval's parties / record viewers, plant child rows are bound to the
plant in the URL, and payment allocations check the source voucher's scope."""
from datetime import date, datetime, timezone
from decimal import Decimal

from app.modules.accounts.models.payment_transaction import PaymentAllocation, PaymentTransaction
from app.modules.hr.models.attendance import HrAttendance
from app.modules.hr.models.leave import HrLeaveRequest
from app.modules.hr.models.lifecycle import HrChecklistItem, HrLifecycleEvent
from app.modules.hr.models.travel import HrTravelRequest
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.branch_address import BranchAddress
from app.tests.test_cov_hr_support import HR, hdr, make_leave_type, make_user

API = "/api/v1"


def _narrow_hr(db, email="hr.own@premnathrail.com"):
    """HR user with full HR grants but data scope 'own' for HR."""
    return make_user(db, email, data_access_scopes={"hr": "own"})


# ── HR ──────────────────────────────────────────────────────────────────

def test_travel_complete_respects_hr_scope(client, db):
    hr = _narrow_hr(db)
    emp = make_user(db, "trav.emp@premnathrail.com")
    tr = HrTravelRequest(request_no="TR-IDOR-1", user_id=emp.id, purpose="Site", from_city="Delhi", to_city="Agra",
                         depart_date=date(2026, 10, 1), travel_mode="train", status="approved")
    db.add(tr)
    db.commit()
    r = client.post(f"{HR}/travel/{tr.id}/complete", json={"remarks": "done"}, headers=hdr(hr))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]
    admin = make_user(db, "trav.admin@premnathrail.com", role="admin")
    assert client.post(f"{HR}/travel/{tr.id}/complete", json={}, headers=hdr(admin)).status_code == 200


def test_lifecycle_checklist_item_checks_parent_event_scope(client, db):
    hr = _narrow_hr(db, "hr.own2@premnathrail.com")
    emp = make_user(db, "lc.emp@premnathrail.com")
    other_hr = make_user(db, "lc.otherhr@premnathrail.com")
    ev = HrLifecycleEvent(event_no="LC-IDOR-1", event_type="exit", user_id=emp.id, status="in_progress",
                          created_by_id=other_hr.id)
    db.add(ev)
    db.flush()
    item = HrChecklistItem(event_id=ev.id, category="it", title="Laptop", status="pending", sort_order=10)
    db.add(item)
    db.commit()
    r = client.patch(f"{HR}/lifecycle/items/{item.id}", json={"remarks": "x"}, headers=hdr(hr))
    assert r.status_code == 403 and "lifecycle event is outside your data access" in r.json()["detail"]
    r = client.delete(f"{HR}/lifecycle/items/{item.id}", headers=hdr(hr))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]
    # Organization-wide HR still can.
    assert client.delete(f"{HR}/lifecycle/items/{item.id}", headers=hdr(other_hr)).status_code == 200


def test_asset_history_by_user_respects_employee_scope(client, db):
    hr = _narrow_hr(db, "hr.own3@premnathrail.com")
    emp = make_user(db, "asset.emp@premnathrail.com")
    r = client.get(f"{HR}/assets/by-user/{emp.id}", headers=hdr(hr))
    assert r.status_code == 403 and "outside your HR data access" in r.json()["detail"]
    assert client.get(f"{HR}/assets/by-user/{hr.id}", headers=hdr(hr)).status_code == 200
    assert client.get(f"{HR}/assets/by-user/999999", headers=hdr(hr)).status_code == 404


def test_attendance_delete_respects_hr_scope(client, db):
    hr = _narrow_hr(db, "hr.own4@premnathrail.com")
    emp = make_user(db, "att.emp@premnathrail.com")
    # Marked by the narrow HR user themself, so only the scope can stop it.
    row = HrAttendance(user_id=emp.id, attendance_date=date(2026, 10, 5), status="present", source="manual",
                       marked_by_id=hr.id)
    db.add(row)
    db.commit()
    r = client.delete(f"{HR}/attendance/entries/{row.id}", headers=hdr(hr))
    assert r.status_code == 403 and "attendance record is outside your data access" in r.json()["detail"]


def test_legacy_leave_decision_respects_hr_scope(client, db):
    hr = _narrow_hr(db, "hr.own5@premnathrail.com")
    emp = make_user(db, "leave.emp@premnathrail.com")
    lt = make_leave_type(db)
    req = HrLeaveRequest(request_no="LV-IDOR-1", user_id=emp.id, leave_type_id=lt.id, from_date=date(2026, 11, 2),
                         to_date=date(2026, 11, 2), days=Decimal("1"), status="pending", approver_id=None)
    db.add(req)
    db.commit()
    r = client.post(f"{HR}/leave/requests/{req.id}/reject", json={"remarks": "no"}, headers=hdr(hr))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]
    db.refresh(req)
    assert req.status == "pending"


# ── Organization ────────────────────────────────────────────────────────

def test_approval_status_hidden_from_unrelated_users(client, db):
    requester = make_user(db, "appr.req@premnathrail.com")
    stranger = make_user(db, "appr.stranger@premnathrail.com", apps=())
    db.add(ApprovalRequest(workflow_key="hr.expense", module_key="hr", entity_type="hr_expense_claim", entity_id=4242,
                           title="Expense claim 'Hotel' — Appr Req", requester_id=requester.id, context={},
                           status="pending", submitted_at=datetime.now(timezone.utc)))
    db.commit()
    url = f"{API}/approvals/entity/hr_expense_claim/4242"
    r = client.get(url, headers=hdr(stranger))
    assert r.status_code == 403 and "approval history" in r.json()["detail"]
    r = client.get(url, headers=hdr(requester))
    assert r.status_code == 200 and r.json()["current"]["entity_id"] == 4242


def test_branch_address_bound_to_branch_in_url(client, db):
    admin = make_user(db, "org.admin@premnathrail.com", role="admin")
    a = Branch(name="Plant A", code="PA")
    b = Branch(name="Plant B", code="PB")
    db.add_all([a, b])
    db.flush()
    addr_b = BranchAddress(branch_id=b.id, address_line1="B street")
    db.add(addr_b)
    db.commit()
    r = client.patch(f"{API}/organization/branches/{a.id}/addresses/{addr_b.id}", json={"address_line1": "hijack"},
                     headers=hdr(admin))
    assert r.status_code == 404 and f"does not belong to plant #{a.id}" in r.json()["detail"]
    r = client.delete(f"{API}/organization/branches/{a.id}/addresses/{addr_b.id}", headers=hdr(admin))
    assert r.status_code == 404
    db.refresh(addr_b)
    assert addr_b.address_line1 == "B street"


# ── Accounts ────────────────────────────────────────────────────────────

def test_remove_allocation_checks_source_voucher_scope(client, db):
    maker = make_user(db, "fin.maker@premnathrail.com", apps=("accounts",))
    narrow = make_user(db, "fin.narrow@premnathrail.com", apps=("accounts",), data_access_scopes={"accounts": "own"})
    pay = PaymentTransaction(payment_number="PV-IDOR-1", payment_mode="bank", payment_date=date(2026, 10, 1),
                             amount=100, bank_account_id=1, created_by_id=maker.id)
    db.add(pay)
    db.flush()
    alloc = PaymentAllocation(source_type="payment", source_id=pay.id, target_type="vendor_invoice", target_id=1,
                              amount=50, allocation_date=date(2026, 10, 1), created_by_id=maker.id)
    db.add(alloc)
    db.commit()
    r = client.delete(f"{API}/accounts/payments/allocations/{alloc.id}", headers=hdr(narrow))
    assert r.status_code == 403 and "payment voucher is outside your data access" in r.json()["detail"]
    assert db.get(PaymentAllocation, alloc.id) is not None
