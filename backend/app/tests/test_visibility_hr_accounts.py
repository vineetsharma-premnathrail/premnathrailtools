"""Role-wise UI visibility (core/visibility.py) for HR (Employees, Leave) and
Finance (Vendors, Payments & Receipts): the catalogue entries resolve, their
coded dropdown values match the model constants, the server refuses a value
a role does not offer (422 with the real reason) and lets an allowed one
through, an unchanged value on an older record is never refused, and the
employee form-rules endpoint carries `allowed`. No real personal data: every
name, number and email here is made up."""
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.core import visibility
from app.core.permission_registry import MODULES
from app.core.visibility import VISIBILITY, clean_rules
from app.modules.accounts.models.payment_transaction import PAYMENT_MODES, PAYMENT_TYPES
from app.modules.accounts.models.vendor import GST_REGISTRATION_TYPES, VENDOR_STATUSES
from app.modules.hr.models.employee_profile import ATTENDANCE_POLICIES, WORKER_TYPES
from app.modules.hr.models.leave import LEAVE_SESSIONS
from app.modules.hr.services.workforce_rules import FORM_EMPLOYMENT_TYPES, SECTIONS as WORKFORCE_SECTIONS
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.tests.test_accounts_finance import _capital, _sale, books, gstin_for  # noqa: F401 — `books` is a fixture
from app.tests.test_cov_hr_leave import org  # noqa: F401 — fixture: plant, HR user, manager, employee, CL balance
from app.tests.test_cov_hr_support import *  # noqa: F401,F403 — frozen HR clock (autouse) + make_* helpers
from app.tests.test_cov_hr_support import HR, hdr, make_user
from app.tests.test_hr_wave2_hcm import org as hcm_org  # noqa: F401 — fixture: HR admin + employee with a permanent profile

EMP_KEY, LEAVE_KEY, VEND_KEY, PAY_KEY = "hr:employees", "hr:leave", "accounts:vendors", "accounts:payments"
WORKERS = f"{HR}/employees/workers"
EMPLOYEES = f"{HR}/employees"
LEAVE = f"{HR}/leave"
VENDORS = "/api/v1/accounts/vendors"
PAY = "/api/v1/accounts/payments"
WIDEN = "Ask an admin to widen it in Organization › Role & Permissions › "


def _h(u: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _role(db, name, key, rule, **kw) -> Role:
    """A role that OPENS `key` (holds its view grant) and sets `rule` for it."""
    module, tab = key.split(":")
    r = Role(name=name, permissions=[f"{key}:view", f"{key}:create", f"{key}:edit"], visibility_rules={key: rule}, **kw)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _give(db, user, *roles):
    user.roles = list(roles)
    db.commit()
    db.refresh(user)
    user.__dict__.pop("_visibility_effective_cache", None)


# ---------- catalogue ----------

def test_new_keys_resolve_to_tabs_and_hold_the_coded_values():
    for key in (EMP_KEY, LEAVE_KEY, VEND_KEY, PAY_KEY):
        module, tab = key.split(":")
        assert tab in MODULES[module]["actions"], key
        assert VISIBILITY[key]["label"]
    cat = visibility.catalog()
    assert cat[EMP_KEY]["options"]["worker_type"]["values"] == dict(WORKER_TYPES)
    assert cat[EMP_KEY]["options"]["employment_type"]["values"] == dict(FORM_EMPLOYMENT_TYPES)
    assert cat[EMP_KEY]["options"]["attendance_policy"]["values"] == dict(ATTENDANCE_POLICIES)
    assert set(cat[LEAVE_KEY]["options"]["session"]["values"]) == set(LEAVE_SESSIONS)
    assert list(cat[VEND_KEY]["options"]["gst_registration_type"]["values"]) == list(GST_REGISTRATION_TYPES)
    assert list(cat[VEND_KEY]["options"]["status"]["values"]) == list(VENDOR_STATUSES)
    assert list(cat[PAY_KEY]["options"]["payment_type"]["values"]) == [t for t in PAYMENT_TYPES if t != "employee"]
    assert list(cat[PAY_KEY]["options"]["payment_mode"]["values"]) == list(PAYMENT_MODES)


def test_employee_sections_follow_the_workforce_form_and_lock_required_ones():
    sections = VISIBILITY[EMP_KEY]["sections"]
    form = {k for k, s in sections.items() if s["screen"] == "form"}
    # The form's own section keys (workforce_rules.SECTIONS) are the catalogue keys; the statutory-ID row is extra.
    assert set(WORKFORCE_SECTIONS) | {"statutory_ids"} == form
    for key, label in WORKFORCE_SECTIONS.items():
        assert sections[key]["label"] == label
    locked = {k for k, s in sections.items() if s["locked"] and s["screen"] == "form"}
    assert locked == {"classification", "organization", "personal", "access", "contractor", "compliance", "exit"}
    assert "on screen only" in sections["statutory_ids"]["hint"]


# ---------- screens (spec v2) ----------

@pytest.mark.parametrize("key,screens", [
    (EMP_KEY, {"form": "Add / Edit Employee form", "detail": "Employee page", "list": "Employees list"}),
    (LEAVE_KEY, {"form": "Apply for leave form", "list": "Leave lists (requests, balances)"}),
    (VEND_KEY, {"form": "Vendor form", "list": "Vendors list"}),
    (PAY_KEY, {"form": "New voucher form", "list": "Vouchers list"}),
])
def test_every_key_declares_its_screens_and_every_item_names_one(key, screens):
    cat = visibility.catalog()[key]
    assert cat["screens"] == screens
    for group in ("sections", "options", "tables"):
        for name, item in cat[group].items():
            assert item["screen"] in screens, (key, group, name)
    # dropdowns and form sections sit on the form; list tables on the list
    assert all(o["screen"] == "form" for o in cat["options"].values()), key
    assert all(t["screen"] == "list" for t in cat["tables"].values()), key
    # every declared screen has at least one item
    used = {item["screen"] for group in ("sections", "options", "tables") for item in cat[group].values()}
    assert used == set(screens), key


def test_employee_page_blocks_are_their_own_screen():
    cat = visibility.catalog()[EMP_KEY]
    detail = {k: v for k, v in cat["sections"].items() if v["screen"] == "detail"}
    assert set(detail) == {"detail_header", "detail_employment", "detail_exit", "detail_attendance", "detail_contractor",
                           "detail_personal", "detail_emergency", "detail_compliance", "detail_hr_notes"}
    assert detail["detail_header"]["locked"] and detail["detail_employment"]["locked"]
    assert not any(v["locked"] for k, v in detail.items() if k not in ("detail_header", "detail_employment"))
    assert "on screen only" in detail["detail_compliance"]["hint"] and "Statutory IDs" in detail["detail_compliance"]["hint"]
    with pytest.raises(ValueError, match="holds a required field"):
        clean_rules({EMP_KEY: {"hidden_sections": ["detail_header"]}})
    assert clean_rules({EMP_KEY: {"hidden_sections": ["detail_compliance", "admin"]}}) == {EMP_KEY: {"hidden_sections": ["admin", "detail_compliance"]}}


@pytest.mark.parametrize("key,section,locked", [
    (LEAVE_KEY, "leave", True), (LEAVE_KEY, "details", True), (LEAVE_KEY, "document", True), (LEAVE_KEY, "days_balance", False),
    (VEND_KEY, "vendor", True), (VEND_KEY, "gst_pan", True), (VEND_KEY, "referral", True), (VEND_KEY, "bank_details", False),
    (PAY_KEY, "voucher", True), (PAY_KEY, "bank_mode", True), (PAY_KEY, "documents", True), (PAY_KEY, "narration", False),
])
def test_required_holding_sections_are_locked(key, section, locked):
    assert VISIBILITY[key]["sections"][section]["locked"] is locked
    if locked:
        with pytest.raises(ValueError) as e:
            clean_rules({key: {"hidden_sections": [section]}})
        assert "holds a required field" in str(e.value)
    else:
        assert clean_rules({key: {"hidden_sections": [section]}}) == {key: {"hidden_sections": [section]}}


def test_tables_never_offer_code_status_or_money_columns():
    banned = {"code", "number", "status", "amount", "unallocated", "name", "request", "employee", "available"}
    for key in (EMP_KEY, LEAVE_KEY, VEND_KEY, PAY_KEY):
        for table, spec in VISIBILITY[key]["tables"].items():
            assert spec["columns"], (key, table)
            assert not banned & set(spec["columns"]), (key, table, spec["columns"])


# ---------- HR › Employees ----------

def _hr(db, email="hr.vis@premnathrail.com"):
    return make_user(db, email, apps=("hr",))


def test_worker_create_refuses_a_category_the_role_does_not_offer(client, db):
    hr = _hr(db)
    _give(db, hr, _role(db, "Workshop HR", EMP_KEY, {"options": {"worker_type": ["factory", "housekeeping"]}}))
    r = client.post(WORKERS, json={"full_name": "Sample Worker", "worker_type": "contract", "is_draft": True}, headers=hdr(hr))
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == (
        "Worker Category 'Contract labour' isn't available to your role — you can pick: Factory / workshop, "
        "Housekeeping / cleaning. " + WIDEN + f"{MODULES['hr']['label']} › Employees › Visibility.")
    r = client.post(WORKERS, json={"full_name": "Sample Worker", "worker_type": "factory", "is_draft": True}, headers=hdr(hr))
    assert r.status_code == 201, r.text
    assert r.json()["worker_type"] == "factory"
    # Employment type and attendance policy are checked the same way.
    _give(db, hr, _role(db, "Permanent only", EMP_KEY, {"options": {"employment_type": ["permanent"], "attendance_policy": ["biometric"]}}))
    r = client.post(WORKERS, json={"full_name": "Sample Two", "employment_type": "trainee", "is_draft": True}, headers=hdr(hr))
    assert r.status_code == 422 and "Employment Type 'Trainee / Apprentice' isn't available to your role" in r.json()["detail"]
    r = client.post(WORKERS, json={"full_name": "Sample Two", "attendance_policy": "self", "is_draft": True}, headers=hdr(hr))
    assert r.status_code == 422 and "Attendance Policy 'Self-service (portal)' isn't available to your role" in r.json()["detail"]


def test_worker_create_default_category_is_checked_too(client, db):
    """HrWorkerCreate defaults worker_type to 'factory' — leaving it out is not a way round the rule."""
    hr = _hr(db)
    _give(db, hr, _role(db, "Office HR", EMP_KEY, {"options": {"worker_type": ["office"]}}))
    r = client.post(WORKERS, json={"full_name": "Sample Worker", "is_draft": True}, headers=hdr(hr))
    assert r.status_code == 422 and "Worker Category 'Factory / workshop' isn't available" in r.json()["detail"]


def test_account_holder_profile_default_category_is_checked_on_create(client, db):
    """PATCH /hr/employees/{user_id} with no worker_type would store the column default 'office'."""
    hr = _hr(db)
    emp = make_user(db, "sample.emp@premnathrail.com", apps=())
    _give(db, hr, _role(db, "Factory HR", EMP_KEY, {"options": {"worker_type": ["factory"]}}))
    r = client.patch(f"{EMPLOYEES}/{emp.id}", json={"employment_status": "active"}, headers=hdr(hr))
    assert r.status_code == 422 and "Worker Category 'Office staff' isn't available" in r.json()["detail"]
    r = client.patch(f"{EMPLOYEES}/{emp.id}", json={"employment_status": "active", "worker_type": "factory", "is_draft": True}, headers=hdr(hr))
    assert r.status_code == 200, r.text


def test_worker_edit_checks_only_a_changed_category(client, db):
    hr = _hr(db)
    r = client.post(WORKERS, json={"full_name": "Sample Worker", "worker_type": "contract", "is_draft": True}, headers=hdr(hr))
    assert r.status_code == 201, r.text
    pid = r.json()["profile_id"]
    # The role is narrowed AFTER the record was created with a now-disallowed category.
    _give(db, hr, _role(db, "Narrowed HR", EMP_KEY, {"options": {"worker_type": ["factory"]}}))
    r = client.patch(f"{WORKERS}/{pid}", json={"worker_type": "contract", "work_location": "Gate 2"}, headers=hdr(hr))
    assert r.status_code == 200, r.text  # unchanged category is not refused
    r = client.patch(f"{WORKERS}/{pid}", json={"worker_type": "office"}, headers=hdr(hr))
    assert r.status_code == 422 and "Worker Category 'Office staff' isn't available" in r.json()["detail"]
    r = client.patch(f"{WORKERS}/{pid}", json={"worker_type": "factory"}, headers=hdr(hr))
    assert r.status_code == 200 and r.json()["worker_type"] == "factory"


def test_form_rules_carry_allowed_values_and_keep_the_full_lists(client, db):
    hr = _hr(db)
    rules = client.get(f"{EMPLOYEES}/form-rules", headers=hdr(hr)).json()
    assert rules["allowed"] == {"worker_type": None, "employment_type": None, "attendance_policy": None}
    _give(db, hr, _role(db, "Workshop HR", EMP_KEY, {"options": {"worker_type": ["housekeeping", "factory"]}}))
    rules = client.get(f"{EMPLOYEES}/form-rules", headers=hdr(hr)).json()
    assert rules["allowed"] == {"worker_type": ["factory", "housekeeping"], "employment_type": None, "attendance_policy": None}
    assert rules["worker_types"] == WORKER_TYPES  # the full list stays so an older record's value still shows
    # A second role that opens the tab without a rule lifts the restriction (union).
    _give(db, hr, _role(db, "Factory HR", EMP_KEY, {"options": {"worker_type": ["factory"]}}), _role(db, "Plain HR", EMP_KEY, {}))
    assert client.get(f"{EMPLOYEES}/form-rules", headers=hdr(hr)).json()["allowed"]["worker_type"] is None


# ---------- HR › Leave ----------

def _apply(client, user, lt, start, end, fs="full", ts="full", **extra):
    data = {"leave_type_id": str(lt.id), "from_date": start.isoformat(), "to_date": end.isoformat(),
            "from_session": fs, "to_session": ts, "reason": "Family function"}
    data.update({k: str(v) for k, v in extra.items()})
    return client.post(f"{LEAVE}/requests", data=data, headers=hdr(user))


def test_leave_apply_refuses_a_half_day_session_the_role_does_not_offer(client, db, org):
    hr, emp, cl = org["hr"], org["emp"], org["cl"]
    _give(db, hr, _role(db, "Full days only", LEAVE_KEY, {"options": {"session": ["full"]}}))
    r = _apply(client, hr, cl, date(2026, 11, 2), date(2026, 11, 2), fs="first_half", user_id=emp.id)
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == ("Half-day session 'First half' isn't available to your role — you can pick: Full day. "
                                  + WIDEN + f"{MODULES['hr']['label']} › Leave › Visibility.")
    r = _apply(client, hr, cl, date(2026, 11, 2), date(2026, 11, 4), ts="first_half", user_id=emp.id)
    assert r.status_code == 422 and "Half-day session 'First half'" in r.json()["detail"]
    r = _apply(client, hr, cl, date(2026, 11, 2), date(2026, 11, 4), user_id=emp.id)
    assert r.status_code == 200, r.text
    # The employee's own roles decide for their own application — no rule on them, half days stay open.
    r = _apply(client, emp, cl, date(2026, 11, 9), date(2026, 11, 9), fs="second_half")
    assert r.status_code == 200, r.text


# ---------- Finance › Vendors ----------

def _finance(db, email="fin.vis@premnathrail.com"):
    return make_user(db, email, apps=("accounts",))


def test_vendor_create_refuses_a_registration_type_or_status_the_role_does_not_offer(client, db):
    fin = _finance(db)
    _give(db, fin, _role(db, "Local vendors", VEND_KEY, {"options": {"gst_registration_type": ["unregistered", "composition"], "status": ["active"]}}))
    base = {"code": "V-VIS1", "name": "Sample Traders", "referral_type": "direct"}
    r = client.post(VENDORS, json={**base, "gst_registration_type": "regular"}, headers=_h(fin))
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == ("GST registration 'Regular' isn't available to your role — you can pick: Composition, "
                                  "Unregistered. " + WIDEN + "Finance & Accounting › Vendors › Visibility.")
    # Left out, the server would default it — a restricted role has to say which one.
    r = client.post(VENDORS, json=base, headers=_h(fin))
    assert r.status_code == 422 and r.json()["detail"] == "Pick a GST registration — your role allows: Composition, Unregistered."
    r = client.post(VENDORS, json={**base, "gst_registration_type": "unregistered", "status": "blocked"}, headers=_h(fin))
    assert r.status_code == 422 and "Vendor status 'Blocked' isn't available to your role" in r.json()["detail"]
    r = client.post(VENDORS, json={**base, "gst_registration_type": "unregistered"}, headers=_h(fin))
    assert r.status_code == 201, r.text
    assert r.json()["gst_registration_type"] == "unregistered" and r.json()["status"] == "active"


def test_vendor_edit_checks_only_a_changed_value(client, db):
    fin = _finance(db)
    r = client.post(VENDORS, json={"code": "V-VIS2", "name": "Sample Works", "gst_registration_type": "regular",
                                   "gstin": gstin_for("27", "AABCS1111E"), "referral_type": "direct"}, headers=_h(fin))
    assert r.status_code == 201, r.text
    vid = r.json()["id"]
    _give(db, fin, _role(db, "Local vendors", VEND_KEY, {"options": {"gst_registration_type": ["unregistered"], "status": ["active", "inactive"]}}))
    r = client.patch(f"{VENDORS}/{vid}", json={"gst_registration_type": "regular", "city": "Pune"}, headers=_h(fin))
    assert r.status_code == 200, r.text  # unchanged type is not refused
    r = client.patch(f"{VENDORS}/{vid}", json={"gst_registration_type": "composition"}, headers=_h(fin))
    assert r.status_code == 422 and "GST registration 'Composition' isn't available" in r.json()["detail"]
    r = client.patch(f"{VENDORS}/{vid}", json={"status": "blocked"}, headers=_h(fin))
    assert r.status_code == 422 and "Vendor status 'Blocked' isn't available to your role — you can pick: Active, Inactive." in r.json()["detail"]
    r = client.patch(f"{VENDORS}/{vid}", json={"status": "inactive"}, headers=_h(fin))
    assert r.status_code == 200 and r.json()["status"] == "inactive"


# ---------- Finance › Payments & Receipts ----------

def test_voucher_create_refuses_a_type_or_mode_the_role_does_not_offer(client, books):  # noqa: F811
    db, user = books["db"], books["checker"]
    _capital(books)
    _give(db, user, _role(db, "Receipts only", PAY_KEY, {"options": {"payment_type": ["customer", "other_receipt"], "payment_mode": ["neft", "rtgs"]}}))
    body = {"payment_type": "vendor", "bank_account_id": books["bank"].id, "amount": 500, "payment_mode": "neft",
            "payment_date": "2026-08-01", "vendor_id": books["v_local"].id}
    r = client.post(PAY, json=body, headers=_h(user))
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == ("Voucher type 'Vendor payment' isn't available to your role — you can pick: Customer receipt, "
                                  "Other receipt. " + WIDEN + "Finance & Accounting › Payments & Receipts › Visibility.")
    receipt = {"payment_type": "customer", "bank_account_id": books["bank"].id, "amount": 500, "payment_mode": "cash",
               "payment_date": "2026-08-01", "customer_id": books["c_local"].id}
    r = client.post(PAY, json=receipt, headers=_h(user))
    assert r.status_code == 422 and "Payment mode 'Cash' isn't available to your role — you can pick: NEFT, RTGS." in r.json()["detail"]
    r = client.post(PAY, json={**receipt, "payment_mode": "neft"}, headers=_h(user))
    assert r.status_code == 201, r.text
    assert r.json()["payment_type"] == "customer" and r.json()["payment_mode"] == "neft"
    # The pay-one-bill route always records a vendor payment, so the type is checked there too.
    r = client.post(f"{PAY}/pay-invoice", json={"vendor_invoice_id": 1, "bank_account_id": books["bank"].id, "amount": 1,
                                                "payment_mode": "neft", "payment_date": "2026-08-01"}, headers=_h(user))
    assert r.status_code == 422 and "Voucher type 'Vendor payment' isn't available" in r.json()["detail"]


def test_voucher_create_without_rule_is_unchanged(client, books):  # noqa: F811
    _capital(books)
    r = client.post(PAY, json={"payment_type": "contra", "bank_account_id": books["bank"].id, "amount": 1000, "payment_mode": "neft",
                               "payment_date": "2026-08-01", "counter_bank_account_id": books["cash"].id}, headers=_h(books["checker"]))
    assert r.status_code == 201, r.text


def test_invoice_collection_follows_the_payments_voucher_type_and_mode_rule(client, books):  # noqa: F811
    """POST /accounts/ar-transactions/{id}/collect records a customer receipt: it was a way round the Payments rule."""
    db, user = books["db"], books["checker"]
    _capital(books)
    inv = _sale(books, books["c_local"], 10000)
    url = f"/api/v1/accounts/ar-transactions/{inv.id}/collect"
    body = {"bank_account_id": books["bank"].id, "amount": 500, "payment_mode": "neft", "payment_date": "2026-08-01"}
    # Role may record vendor payments only: a customer receipt is refused.
    _give(db, user, _role(db, "Vendor payments only", PAY_KEY, {"options": {"payment_type": ["vendor"]}}))
    r = client.post(url, json=body, headers=_h(user))
    assert r.status_code == 422, r.text
    assert "Voucher type 'Customer receipt' isn't available to your role — you can pick: Vendor payment." in r.json()["detail"]
    # Receipts allowed, but not Cash.
    _give(db, user, _role(db, "NEFT receipts", PAY_KEY, {"options": {"payment_type": ["customer"], "payment_mode": ["neft"]}}))
    r = client.post(url, json={**body, "payment_mode": "cash"}, headers=_h(user))
    assert r.status_code == 422 and "Payment mode 'Cash' isn't available to your role — you can pick: NEFT." in r.json()["detail"]
    r = client.post(url, json=body, headers=_h(user))
    assert r.status_code == 200, r.text


def test_hr_assignment_change_checks_a_changed_employment_type(client, db, hcm_org):
    """POST /hr/org-assignments/{user_id} follows the Employees > Employment Type list; an unchanged value passes."""
    hr, emp = hcm_org["hr"], hcm_org["emp"]  # emp is permanent
    base = {"valid_from": date.today().isoformat(), "reason": "Visibility check"}
    url = f"{HR}/org-assignments/{emp.id}"
    _give(db, hr, _role(db, "Permanent only", EMP_KEY, {"options": {"employment_type": ["permanent"]}}))
    r = client.post(url, json={**base, "employment_type": "trainee"}, headers=hdr(hr))
    assert r.status_code == 422, r.text
    assert "Employment Type 'Trainee / Apprentice' isn't available to your role — you can pick: Permanent." in r.json()["detail"]
    # A change that leaves the employment type as it is (here: only the department) is not refused by the rule.
    r = client.post(url, json={**base, "employment_type": "permanent", "department_id": hcm_org["qa"].id}, headers=hdr(hr))
    assert r.status_code == 200, r.text
    # A role that offers Trainee accepts the change.
    _give(db, hr, _role(db, "Trainee allowed", EMP_KEY, {"options": {"employment_type": ["permanent", "trainee"]}}))
    r = client.post(url, json={**base, "employment_type": "trainee"}, headers=hdr(hr))
    assert r.status_code == 200, r.text
