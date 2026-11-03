"""Role-wise UI visibility (core/visibility.py) on Project Management and
Service: the catalogue entries of All Projects (list + machine form), the task
form inside a milestone and Service Requests (form + list), and the server
side of their coded dropdowns — machine Operational Status, task Priority, SR
Service Type / Priority — refused with the real reason, checked only when
changed on an edit, and bulk imports closed to a narrowed role."""
from datetime import date, timedelta

import pytest

from app.core import visibility
from app.core.permission_registry import MODULES
from app.core.priority import PRIORITIES
from app.core.visibility import VISIBILITY
from app.modules.erp.models.project import Project as Machine
from app.modules.erp.models.service_request import SR_PRIORITIES, SR_SERVICE_TYPES
from app.modules.erp.schemas.project import PROJECT_STATUSES
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.tests.test_cov_projects_lifecycle import API, auth, create, w  # noqa: F401  (w = fixture)
from app.tests.test_erp_bulk_import import _csv

MACHINE_KEY = "projects:all_projects"
TASK_KEY = "projects:overview.tasks"
SR_KEY = "erp:service_requests"
SR_API = f"{API}/erp/service-requests"
MACHINE_API = f"{API}/erp/projects"
DUE = str(date.today() + timedelta(days=10))


def _user(db, email, apps=("erp",), erp_permissions=(), **flags):
    flags.setdefault("is_active", True)
    u = User(email=email, name=email.split("@")[0].title(), role="user", assigned_apps=list(apps),
             erp_permissions=list(erp_permissions), granular_permissions=[], **flags)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _role(db, name, permissions, rules=None):
    r = Role(name=name, permissions=list(permissions), visibility_rules=rules or {})
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _give(db, user, *roles):
    user.roles = list(roles)
    db.commit()
    db.refresh(user)
    user.__dict__.pop("_visibility_effective_cache", None)


def _machine(db, serial="SN-VIS-001", **kw):
    kw.setdefault("lifecycle_stage", "dispatched")  # service requests need a dispatched machine
    m = Machine(serial_number=serial, model_name="Test Machine", **kw)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def _sr_body(machine, **extra):
    body = {"project_id": machine.id, "issue_title": "Cooling fan dead", "service_type": "repair_breakdown"}
    body.update(extra)
    return body


# ---------- catalogue ----------

def test_catalogue_entries_resolve_and_match_the_coded_values():
    for key in (MACHINE_KEY, TASK_KEY, SR_KEY):
        assert key in VISIBILITY, key
        module, tabfeat = key.split(":", 1)
        tab, _, feature = tabfeat.partition(".")
        assert tab in MODULES[module]["actions"], key
        if feature:
            assert feature in MODULES[module]["features"][tab], key
    cat = visibility.catalog()

    machine = cat[MACHINE_KEY]
    assert list(machine["options"]["status"]["values"]) == list(PROJECT_STATUSES)
    assert machine["options"]["status"]["values"]["under_service"] == "Under Service"
    # Sections with a required field (project name / serial, client company, customer PO) stay locked.
    assert machine["sections"]["machine_identity"]["locked"] and machine["sections"]["client_details"]["locked"]
    assert machine["sections"]["procurement_delivery"]["locked"]
    assert not machine["sections"]["warranty"]["locked"] and not machine["sections"]["attachments"]["locked"]
    assert set(machine["tables"]["all_projects"]["columns"]) == {"client", "site", "project_manager", "closing_dispatch"}

    task = cat[TASK_KEY]
    assert list(task["options"]["priority"]["values"]) == list(PRIORITIES)
    assert task["sections"]["schedule_status"]["locked"] and not task["sections"]["labels"]["locked"]

    sr = cat[SR_KEY]
    assert list(sr["options"]["service_type"]["values"]) == list(SR_SERVICE_TYPES)
    assert sr["options"]["service_type"]["values"]["repair_breakdown"] == "Repair / Breakdown"
    assert list(sr["options"]["priority"]["values"]) == list(SR_PRIORITIES)
    assert sr["sections"]["machine"]["locked"] and sr["sections"]["issue_information"]["locked"]
    assert not sr["sections"]["reported_by"]["locked"]
    # The SR number and status columns are never hideable; money stays behind the charges switch.
    assert set(sr["tables"]["service_requests"]["columns"]) == {
        "machine_serial", "client_site", "issue_summary", "priority", "opening_date", "closing_date", "age", "warranty"}


def test_catalogue_screens_and_every_item_names_one():
    cat = visibility.catalog()
    machine, task, sr = cat[MACHINE_KEY], cat[TASK_KEY], cat[SR_KEY]
    assert machine["screens"] == {"form": "New Project / machine form", "detail": "Project page", "list": "All Projects list"}
    assert task["screens"] == {"form": "Task form"}
    assert sr["screens"] == {"form": "Service Request form", "detail": "Service Request page", "list": "Service Requests list"}
    for entry in (machine, task, sr):
        for group in ("sections", "options", "tables"):
            for name, item in entry[group].items():
                assert item["screen"] in entry["screens"], (group, name)
    # form items on the form, page blocks on the page (prefixed detail_), list columns on the list
    assert machine["sections"]["warranty"]["screen"] == "form" and machine["options"]["status"]["screen"] == "form"
    assert machine["tables"]["all_projects"]["screen"] == "list"
    assert {k for k, s in machine["sections"].items() if s["screen"] == "detail"} == {
        "detail_summary", "detail_progress", "detail_record", "detail_budget", "detail_machine"}
    assert machine["sections"]["detail_summary"]["locked"] and not machine["sections"]["detail_machine"]["locked"]
    assert all(s["screen"] == "form" for s in task["sections"].values()) and task["options"]["priority"]["screen"] == "form"
    assert sr["options"]["service_type"]["screen"] == "form" and sr["tables"]["service_requests"]["screen"] == "list"
    assert {k for k, s in sr["sections"].items() if s["screen"] == "detail"} == {
        "detail_summary", "detail_workflow", "detail_machine_site", "detail_reported_by", "detail_assignment_dates",
        "detail_service_notes", "detail_status_card", "detail_billing", "detail_warranty_invoice"}
    assert sr["sections"]["detail_status_card"]["locked"] and not sr["sections"]["detail_billing"]["locked"]
    # a page block can be hidden by a rule like any other section; a locked one can't
    assert visibility.clean_rules({SR_KEY: {"hidden_sections": ["detail_billing"]}}) == {SR_KEY: {"hidden_sections": ["detail_billing"]}}
    with pytest.raises(ValueError):
        visibility.clean_rules({MACHINE_KEY: {"hidden_sections": ["detail_summary"]}})


# ---------- Service Requests ----------

def test_sr_create_refuses_a_service_type_or_priority_the_role_does_not_offer(client, db):
    eng = _user(db, "vis.sr.create@premnathrail.com")
    _give(db, eng, _role(db, "Warranty desk", ["erp:service_requests:view", "erp:service_requests:create"],
                         {SR_KEY: {"options": {"service_type": ["warranty", "amc"], "priority": ["standard"]}}}))
    m = _machine(db, "SN-VIS-SR-1")
    h = auth(eng)

    r = client.post(SR_API, json=_sr_body(m), headers=h)  # repair_breakdown
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == (
        "Service Type 'Repair / Breakdown' isn't available to your role — you can pick: Warranty, AMC. Ask an admin to "
        f"widen it in Organization › Role & Permissions › {MODULES['erp']['label']} › Service Requests › Visibility.")

    r = client.post(SR_API, json=_sr_body(m, service_type="warranty", priority="urgent"), headers=h)
    assert r.status_code == 422
    assert r.json()["detail"].startswith("Priority 'Urgent' isn't available to your role — you can pick: Standard.")

    r = client.post(SR_API, json=_sr_body(m, service_type="amc"), headers=h)  # priority left out = Standard, allowed
    assert r.status_code == 201, r.text
    assert r.json()["service_type"] == "amc" and r.json()["priority"] == "standard"


def test_sr_create_without_a_rule_is_unchanged(client, db):
    eng = _user(db, "vis.sr.free@premnathrail.com")
    _give(db, eng, _role(db, "Open service", ["erp:service_requests:view", "erp:service_requests:create"]))
    r = client.post(SR_API, json=_sr_body(_machine(db, "SN-VIS-SR-2"), priority="urgent"), headers=auth(eng))
    assert r.status_code == 201, r.text


def test_sr_edit_checks_only_a_changed_value(client, db):
    eng = _user(db, "vis.sr.edit@premnathrail.com")
    _give(db, eng, _role(db, "Open service edit", ["erp:service_requests:view", "erp:service_requests:create", "erp:service_requests:edit"]))
    m = _machine(db, "SN-VIS-SR-3")
    r = client.post(SR_API, json=_sr_body(m, priority="urgent"), headers=auth(eng))
    assert r.status_code == 201, r.text
    sr_id = r.json()["id"]
    # The role is narrowed AFTER the request was raised with now-disallowed values.
    _give(db, eng, _role(db, "Narrowed service", ["erp:service_requests:view", "erp:service_requests:edit"],
                         {SR_KEY: {"options": {"service_type": ["warranty"], "priority": ["standard"]}}}))
    h = auth(eng)
    r = client.patch(f"{SR_API}/{sr_id}", json={"issue_title": "Cooling fan dead (rev A)", "service_type": "repair_breakdown",
                                               "priority": "urgent"}, headers=h)
    assert r.status_code == 200, r.text  # unchanged values are not refused by Visibility
    r = client.patch(f"{SR_API}/{sr_id}", json={"service_type": "amc"}, headers=h)
    assert r.status_code == 422 and "Service Type 'AMC' isn't available to your role" in r.json()["detail"]
    r = client.patch(f"{SR_API}/{sr_id}", json={"priority": "standard"}, headers=h)
    assert r.status_code == 200, r.text  # moving to an allowed value is fine


def test_sr_import_is_closed_to_a_narrowed_role_with_the_reason(client, db):
    eng = _user(db, "vis.sr.import@premnathrail.com")
    perms = ["erp:service_requests:view", "erp:service_requests:create", "erp:service_requests:import"]
    _give(db, eng, _role(db, "Warranty import", perms, {SR_KEY: {"options": {"service_type": ["warranty"]}}}))
    _machine(db, "SN-VIS-IMP")
    body = "machine_serial_number,issue_title,service_type\nSN-VIS-IMP,Leak,Warranty\n"
    r = client.post(f"{SR_API}/import", files=_csv(body), headers=auth(eng))
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith("Your role limits the Service Type of service requests, so a bulk import isn't available to you")
    assert "Service Requests › Visibility" in r.json()["detail"]
    # Without a rule the same role imports as before.
    _give(db, eng, _role(db, "Open import", perms))
    r = client.post(f"{SR_API}/import", files=_csv(body), headers=auth(eng))
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1 or len(r.json().get("created", [])) == 1


# ---------- Machines (All Projects) ----------

def test_machine_create_refuses_an_operational_status_the_role_does_not_offer(client, db):
    reg = _user(db, "vis.machine.create@premnathrail.com", apps=("erp", "projects"))
    _give(db, reg, _role(db, "Active only", ["projects:all_projects:view", "projects:all_projects:create"],
                         {MACHINE_KEY: {"options": {"status": ["active"]}}}))
    h = auth(reg)
    r = client.post(MACHINE_API, json={"serial_number": "SN-VIS-M1", "status": "standby"}, headers=h)
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == (
        "Operational Status 'Standby' isn't available to your role — you can pick: Active. Ask an admin to widen it in "
        "Organization › Role & Permissions › Project Management › All Projects › Visibility.")
    r = client.post(MACHINE_API, json={"serial_number": "SN-VIS-M1", "status": "active"}, headers=h)
    assert r.status_code == 201, r.text
    r = client.post(MACHINE_API, json={"serial_number": "SN-VIS-M2"}, headers=h)  # default Active
    assert r.status_code == 201, r.text


def test_new_project_with_machine_is_refused_with_the_same_rule(client, db):
    mgr = _user(db, "vis.machine.project@premnathrail.com", apps=("projects",))
    _give(db, mgr, _role(db, "Project creator", ["projects:all_projects:view", "projects:all_projects:create"],
                         {MACHINE_KEY: {"options": {"status": ["active"]}}}))
    body = {"name": "Tamping machine", "machine": {"client_company": "RVNL", "po_number": "PO-77", "status": "standby"}}
    r = client.post(f"{API}/projects/with-machine", json=body, headers=auth(mgr))
    assert r.status_code == 422, r.text
    assert "Operational Status 'Standby' isn't available to your role" in r.json()["detail"]
    body["machine"]["status"] = "active"
    r = client.post(f"{API}/projects/with-machine", json=body, headers=auth(mgr))
    assert r.status_code == 200, r.text


def test_machine_edit_checks_only_a_changed_status(client, db):
    ed = _user(db, "vis.machine.edit@premnathrail.com", apps=("erp", "projects"))
    _give(db, ed, _role(db, "Active only edit", ["projects:all_projects:view", "projects:all_projects:edit"],
                        {MACHINE_KEY: {"options": {"status": ["active"]}}}))
    m = _machine(db, "SN-VIS-M3", status="standby")
    h = auth(ed)
    r = client.patch(f"{MACHINE_API}/{m.id}", json={"model_name": "TM-2", "status": "standby"}, headers=h)
    assert r.status_code == 200, r.text  # unchanged Standby stays
    r = client.patch(f"{MACHINE_API}/{m.id}", json={"status": "inactive"}, headers=h)
    assert r.status_code == 422 and "Operational Status 'Inactive' isn't available to your role" in r.json()["detail"]
    r = client.patch(f"{MACHINE_API}/{m.id}", json={"status": "active"}, headers=h)
    assert r.status_code == 200, r.text


def test_machine_import_is_closed_to_a_narrowed_role_with_the_reason(client, db):
    imp = _user(db, "vis.machine.import@premnathrail.com", apps=("projects",))
    perms = ["projects:all_projects:view", "projects:all_projects:create", "projects:all_projects:import"]
    _give(db, imp, _role(db, "Machine import", perms, {MACHINE_KEY: {"options": {"status": ["active"]}}}))
    r = client.post(f"{MACHINE_API}/import", files=_csv("serial_number\nSN-VIS-IMP-M\n"), headers=auth(imp))
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith("Your role limits the Operational Status of machines, so a bulk import isn't available to you")
    assert "All Projects › Visibility" in r.json()["detail"]
    _give(db, imp, _role(db, "Machine import open", perms))
    r = client.post(f"{MACHINE_API}/import", files=_csv("serial_number\nSN-VIS-IMP-M\n"), headers=auth(imp))
    assert r.status_code == 200, r.text


# ---------- Task form (milestone tasks) ----------

def test_task_priority_follows_the_role_rule_and_only_a_changed_value_is_checked(client, db, w):
    p = create(client, w)
    url = f"{API}/projects/{p['id']}/project-tasks"
    r = client.post(url, headers=auth(w["pm"]), json={"title": "GA drawing", "assignee_id": w["pm"].id, "due_date": DUE})
    assert r.status_code == 200, r.text
    ms_id = r.json()["id"]
    sub_url = f"{API}/pm-ongoing/tasks/{ms_id}/subtasks"
    # A task raised before the role was narrowed holds Urgent.
    r = client.post(sub_url, headers=auth(w["pm"]), json={"title": "Frame", "assignee_id": w["pm"].id, "due_date": DUE, "priority": "urgent"})
    assert r.status_code == 200, r.text
    old = r.json()["subtasks"][0]

    _give(db, w["pm"], _role(db, "Standard tasks", ["projects:overview:view"], {TASK_KEY: {"options": {"priority": ["standard"]}}}))
    r = client.post(sub_url, headers=auth(w["pm"]), json={"title": "Axle", "assignee_id": w["pm"].id, "due_date": DUE, "priority": "urgent"})
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == (
        "Priority 'Urgent' isn't available to your role — you can pick: Standard. Ask an admin to widen it in "
        "Organization › Role & Permissions › Project Management › Overview › Tasks in a milestone › Visibility.")
    r = client.post(sub_url, headers=auth(w["pm"]), json={"title": "Axle", "assignee_id": w["pm"].id, "due_date": DUE})
    assert r.status_code == 200, r.text  # default Standard

    # Editing the old task without touching its priority is fine; changing it to Urgent again is not.
    r = client.patch(f"{API}/pm-ongoing/subtasks/{old['id']}", headers=auth(w["pm"]), json={"title": "Frame rev A", "priority": "urgent"})
    assert r.status_code == 200, r.text
    r = client.patch(f"{API}/pm-ongoing/subtasks/{old['id']}", headers=auth(w["pm"]), json={"priority": "standard"})
    assert r.status_code == 200, r.text
    r = client.patch(f"{API}/pm-ongoing/subtasks/{old['id']}", headers=auth(w["pm"]), json={"priority": "urgent"})
    assert r.status_code == 422 and "Priority 'Urgent' isn't available to your role" in r.json()["detail"]


@pytest.mark.parametrize("key,dropdown,value", [
    (MACHINE_KEY, "status", "standby"), (TASK_KEY, "priority", "urgent"), (SR_KEY, "service_type", "paid_service"),
])
def test_admin_and_partner_are_never_restricted(db, key, dropdown, value):
    role = _role(db, f"Narrow {dropdown}", ["projects:all_projects:view", "projects:overview:view", "erp:service_requests:view"],
                 {key: {"options": {dropdown: ["active", "standard", "warranty"]}}})
    admin = _user(db, f"vis.admin.{dropdown}@premnathrail.com")
    admin.role = "admin"
    partner = _user(db, f"vis.partner.{dropdown}@premnathrail.com", is_partner=True)
    _give(db, admin, role)
    _give(db, partner, role)
    visibility.ensure_option_allowed(admin, key, dropdown, value)
    visibility.ensure_option_allowed(partner, key, dropdown, value)


def test_task_blank_or_null_priority_is_checked_as_standard(client, db, w):
    """A blank priority on create and a null on edit both become Standard, so a role that offers only Urgent can't use them."""
    p = create(client, w)
    r = client.post(f"{API}/projects/{p['id']}/project-tasks", headers=auth(w["pm"]), json={"title": "GA drawing", "assignee_id": w["pm"].id, "due_date": DUE})
    sub_url = f"{API}/pm-ongoing/tasks/{r.json()['id']}/subtasks"
    r = client.post(sub_url, headers=auth(w["pm"]), json={"title": "Frame", "assignee_id": w["pm"].id, "due_date": DUE, "priority": "urgent"})
    assert r.status_code == 200, r.text
    old = r.json()["subtasks"][0]
    _give(db, w["pm"], _role(db, "Urgent tasks", ["projects:overview:view"], {TASK_KEY: {"options": {"priority": ["urgent"]}}}))
    r = client.post(sub_url, headers=auth(w["pm"]), json={"title": "Axle", "assignee_id": w["pm"].id, "due_date": DUE, "priority": ""})
    assert r.status_code == 422 and "Priority 'Standard' isn't available to your role — you can pick: Urgent." in r.json()["detail"]
    r = client.patch(f"{API}/pm-ongoing/subtasks/{old['id']}", headers=auth(w["pm"]), json={"priority": None})
    assert r.status_code == 422 and "Priority 'Standard' isn't available" in r.json()["detail"]
    r = client.patch(f"{API}/pm-ongoing/subtasks/{old['id']}", headers=auth(w["pm"]), json={"title": "Frame B", "priority": "URGENT"})
    assert r.status_code == 200, r.text  # same value, other case: not a change
