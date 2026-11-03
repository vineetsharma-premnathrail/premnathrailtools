"""Role-wise UI visibility in Maintenance (requests, work orders), CRM › Products and
R&D (requirements list, Prototype / Research projects, Create Task) — catalogue in
core/features/{maintenance,products,rnd}.py. Coded dropdown values are refused by the
server for a role that doesn't offer them (create, and update only when the value
changes); the option endpoints list every value with `allowed`."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.core import visibility
from app.core.permission_registry import MODULES
from app.core.priority import PRIORITY_LABELS
from app.core.visibility import VISIBILITY, clean_rules
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.request import MAINTENANCE_REQUEST_TYPES
from app.modules.maintenance.models.work_order import MAINTENANCE_FAILURE_CATEGORIES, MAINTENANCE_WO_TYPES, MaintenanceWorkOrder
from app.modules.products.models.product import PRODUCT_STATUS_LABELS, PRODUCT_TYPE_LABELS, FinishedProduct
from app.modules.rnd.models.project import RND_IMPROVEMENT_REASON_LABELS, RND_ORIGIN_LABELS
from app.modules.rnd.models.project_task import RndProjectTask
from app.modules.rnd.models.requirement_work import RndRequirementTask
from app.tests.test_cov_crm_quotations_rnd import tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_task_board import _env, _proj_task, _req_task

API = "/api/v1"
KEYS = ("maintenance:requests", "maintenance:work_orders", "crm:products", "rnd:requirements", "rnd:projects", "rnd:tasks")


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _member(db, email, apps, grants, rules=None):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True, assigned_apps=list(apps), granular_permissions=[])
    db.add(u)
    db.commit()
    role = Role(name=f"Role of {email}", permissions=list(grants), visibility_rules=rules or {})
    db.add(role)
    db.commit()
    u.roles = [role]
    db.commit()
    db.refresh(u)
    u.__dict__.pop("_visibility_effective_cache", None)
    return u


def _asset(db):
    from app.tests.test_maintenance import setup_plant
    branch, *_ = setup_plant(db)
    a = MaintenanceAsset(asset_code="EQ-0101", name="Press", branch_id=branch.id, status="operational", criticality="B")
    db.add(a)
    db.commit()
    return a


MAINT_GRANTS = ["maintenance:requests:view", "maintenance:requests:create", "maintenance:work_orders:view",
                "maintenance:work_orders:create", "maintenance:work_orders:edit"]


# ---------- catalogue ----------

def test_catalogue_keys_resolve_to_tabs():
    for key in KEYS:
        assert key in VISIBILITY, key
        module, tab = key.split(":", 1)
        assert tab in MODULES[module]["actions"], key


def test_catalogue_values_are_the_coded_ones():
    cat = visibility.catalog()
    assert tuple(cat["maintenance:requests"]["options"]["request_type"]["values"]) == MAINTENANCE_REQUEST_TYPES
    assert tuple(cat["maintenance:work_orders"]["options"]["wo_type"]["values"]) == MAINTENANCE_WO_TYPES
    assert tuple(cat["maintenance:work_orders"]["options"]["failure_category"]["values"]) == MAINTENANCE_FAILURE_CATEGORIES
    assert cat["maintenance:requests"]["options"]["priority"]["values"] == PRIORITY_LABELS
    assert cat["crm:products"]["options"]["product_type"]["values"] == PRODUCT_TYPE_LABELS
    assert cat["crm:products"]["options"]["status"]["values"] == PRODUCT_STATUS_LABELS
    assert cat["rnd:projects"]["options"]["origin"]["values"] == RND_ORIGIN_LABELS
    assert cat["rnd:projects"]["options"]["improvement_reason"]["values"] == RND_IMPROVEMENT_REASON_LABELS
    assert cat["rnd:tasks"]["options"]["priority"]["values"] == PRIORITY_LABELS
    # every item is tagged with a declared screen
    for key in KEYS:
        screens = cat[key]["screens"]
        for kind in ("sections", "options", "tables"):
            for item in cat[key][kind].values():
                assert item["screen"] in screens, (key, kind)


def test_required_sections_are_locked():
    cat = visibility.catalog()
    for key, locked in (("maintenance:requests", ("machine", "problem", "detail_summary")),
                        ("maintenance:work_orders", ("job", "detail_summary")),
                        ("crm:products", ("product", "detail_summary")),
                        ("rnd:projects", ("origin", "initiation", "attachments", "detail_summary")),
                        ("rnd:tasks", ("type", "basic", "assignment", "schedule_priority"))):
        for s in locked:
            assert cat[key]["sections"][s]["locked"], (key, s)
    assert not cat["maintenance:requests"]["sections"]["photos"]["locked"]
    assert not cat["rnd:tasks"]["sections"]["checklist"]["locked"]


def test_tables_never_offer_code_status_or_money_columns():
    banned = {"code", "number", "id", "status", "cost", "value", "amount", "price", "budget"}
    for key in KEYS:
        for table, spec in VISIBILITY[key]["tables"].items():
            for col in spec["columns"]:
                assert not (set(col.lower().split("_")) & banned), (key, table, col)


def test_clean_rules_refuses_locked_sections_and_hidden_priority_without_standard():
    with pytest.raises(ValueError) as e:
        clean_rules({"rnd:projects": {"hidden_sections": ["attachments"]}})
    assert str(e.value) == "'Attachments' holds a required field, so it can't be hidden. Leave it visible."
    with pytest.raises(ValueError) as e:
        clean_rules({"rnd:projects": {"hidden_sections": ["priority_schedule"], "options": {"priority": ["urgent"]}}})
    assert "Priority & Schedule can't be hidden while Priority leaves out Standard" in str(e.value)
    ok = clean_rules({"maintenance:requests": {"hidden_sections": ["photos"], "hidden_columns": {"requests": ["raised_by"]}}})
    assert ok == {"maintenance:requests": {"hidden_sections": ["photos"], "hidden_columns": {"requests": ["raised_by"]}}}


# ---------- Maintenance ----------

def test_request_create_refuses_a_type_outside_the_role(client, db):
    u = _member(db, "vis.mreq@premnathrail.com", ["maintenance"], MAINT_GRANTS,
                {"maintenance:requests": {"options": {"request_type": ["breakdown", "safety"]}}})
    asset = _asset(db)
    body = {"asset_id": asset.id, "request_type": "improvement", "problem_description": "Oil leak", "priority": "standard"}
    r = client.post(f"{API}/maintenance/requests", json=body, headers=_h(u))
    assert r.status_code == 422, r.text
    d = r.json()["detail"]
    assert d.startswith("Type 'Improvement' isn't available to your role — you can pick: Breakdown, Safety.") and "Visibility" in d
    r = client.post(f"{API}/maintenance/requests", json={**body, "request_type": "safety"}, headers=_h(u))
    assert r.status_code == 200, r.text


def test_request_restricted_priority_must_be_picked(client, db):
    u = _member(db, "vis.mreq2@premnathrail.com", ["maintenance"], MAINT_GRANTS,
                {"maintenance:requests": {"options": {"priority": ["urgent"]}}})
    asset = _asset(db)
    body = {"asset_id": asset.id, "request_type": "breakdown", "problem_description": "Stopped"}
    r = client.post(f"{API}/maintenance/requests", json=body, headers=_h(u))
    assert r.status_code == 422 and r.json()["detail"] == "Pick a Priority — your role allows: Urgent."
    r = client.post(f"{API}/maintenance/requests", json={**body, "priority": "Standard"}, headers=_h(u))
    assert r.status_code == 422 and "Priority 'Standard' isn't available to your role" in r.json()["detail"]
    r = client.post(f"{API}/maintenance/requests", json={**body, "priority": "urgent"}, headers=_h(u))
    assert r.status_code == 200, r.text


def test_work_order_type_enforced_on_create_and_changed_update_only(client, db):
    u = _member(db, "vis.mwo@premnathrail.com", ["maintenance"], MAINT_GRANTS,
                {"maintenance:work_orders": {"options": {"wo_type": ["preventive"], "failure_category": ["electrical"]}}})
    asset = _asset(db)
    r = client.post(f"{API}/maintenance/work-orders", json={"asset_id": asset.id, "title": "Check", "wo_type": "corrective"}, headers=_h(u))
    assert r.status_code == 422 and "Type 'Corrective' isn't available to your role — you can pick: Preventive." in r.json()["detail"]
    r = client.post(f"{API}/maintenance/work-orders", json={"asset_id": asset.id, "title": "Check", "wo_type": "preventive"}, headers=_h(u))
    assert r.status_code == 200, r.text
    # An older job with a type the role no longer offers stays editable (type unchanged).
    old = MaintenanceWorkOrder(wo_number="MWO-OLD-1", asset_id=asset.id, title="Old", wo_type="breakdown", status="draft")
    db.add(old)
    db.commit()
    r = client.patch(f"{API}/maintenance/work-orders/{old.id}", json={"title": "Old job", "wo_type": "breakdown"}, headers=_h(u))
    assert r.status_code == 200, r.text
    r = client.patch(f"{API}/maintenance/work-orders/{old.id}", json={"failure_category": "mechanical"}, headers=_h(u))
    assert r.status_code == 422 and "Failure Category 'Mechanical'" in r.json()["detail"]


def test_lookups_carry_allowed(client, db):
    u = _member(db, "vis.mlk@premnathrail.com", ["maintenance"], MAINT_GRANTS,
                {"maintenance:work_orders": {"options": {"wo_type": ["preventive"]}}})
    r = client.get(f"{API}/maintenance/lookups", headers=_h(u))
    assert r.status_code == 200, r.text
    body = r.json()
    wo = {o["code"]: o["allowed"] for o in body["wo_type_options"]}
    assert list(wo) == list(MAINTENANCE_WO_TYPES) and wo["preventive"] and not wo["corrective"]
    assert all(o["allowed"] for o in body["request_type_options"])
    assert body["wo_types"] == list(MAINTENANCE_WO_TYPES)  # the plain list is unchanged


# ---------- Products ----------

PROD_GRANTS = ["crm:products:view", "crm:products:create", "crm:products:edit"]


def test_product_create_refuses_type_and_status_outside_the_role(client, db):
    u = _member(db, "vis.prod@premnathrail.com", ["crm"], PROD_GRANTS,
                {"crm:products": {"options": {"product_type": ["machine"], "status": ["development"]}}})
    body = {"code": "VIS-1", "name": "Tamping machine", "product_type": "vehicle", "status": "development"}
    r = client.post(f"{API}/products", json=body, headers=_h(u))
    assert r.status_code == 422 and r.json()["detail"].startswith("Type 'Rail-road vehicle' isn't available to your role — you can pick: Machine.")
    r = client.post(f"{API}/products", json={**body, "product_type": "machine", "status": "active"}, headers=_h(u))
    assert r.status_code == 422 and "Status 'Active' isn't available" in r.json()["detail"]
    r = client.post(f"{API}/products", json={**body, "product_type": "machine"}, headers=_h(u))
    assert r.status_code == 200, r.text


def test_product_update_checks_only_changed_values_and_meta_carries_allowed(client, db):
    u = _member(db, "vis.prod2@premnathrail.com", ["crm"], PROD_GRANTS,
                {"crm:products": {"options": {"status": ["development"]}}})
    p = FinishedProduct(code="OLD-1", name="Old vehicle", product_type="vehicle", status="active")
    db.add(p)
    db.commit()
    r = client.patch(f"{API}/products/{p.id}", json={"name": "Old vehicle 2", "status": "active"}, headers=_h(u))
    assert r.status_code == 200, r.text
    r = client.patch(f"{API}/products/{p.id}", json={"status": "phased_out"}, headers=_h(u))
    assert r.status_code == 422 and "Status 'Phased out'" in r.json()["detail"]
    meta = client.get(f"{API}/products/meta", headers=_h(u)).json()
    st = {s["value"]: s["allowed"] for s in meta["statuses"]}
    assert st == {"development": True, "active": False, "phased_out": False, "discontinued": False}
    assert all(t["allowed"] for t in meta["types"])


# ---------- R&D ----------

RND_GRANTS = ["rnd:projects:view", "rnd:projects:create", "rnd:projects:edit", "rnd:tasks:view", "rnd:tasks:create"]


def test_rnd_project_origin_and_priority_enforced(client, db):
    u = _member(db, "vis.rnd@premnathrail.com", ["rnd"], RND_GRANTS,
                {"rnd:projects": {"options": {"origin": ["new_project"], "priority": ["standard"]}}})
    base = {"title": "Bogie", "objective": "Lighter frame", "origin_note": "MD asked", "attachment_count": 1}
    r = client.post(f"{API}/rnd/projects", json=base, headers=_h(u))
    assert r.status_code == 422 and r.json()["detail"] == "Pick a Project Origin — your role allows: New Project."
    r = client.post(f"{API}/rnd/projects", json={**base, "origin": "existing_projects"}, headers=_h(u))
    assert r.status_code == 422 and "Project Origin 'Existing Projects' isn't available to your role" in r.json()["detail"]
    r = client.post(f"{API}/rnd/projects", json={**base, "origin": "new_project", "priority": "Urgent"}, headers=_h(u))
    assert r.status_code == 422 and "Priority 'Urgent' isn't available" in r.json()["detail"]
    r = client.post(f"{API}/rnd/projects", json={**base, "origin": "new_project"}, headers=_h(u))
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    r = client.patch(f"{API}/rnd/projects/{pid}", json={"title": "Bogie v2", "priority": "standard"}, headers=_h(u))
    assert r.status_code == 200, r.text
    r = client.patch(f"{API}/rnd/projects/{pid}", json={"priority": "urgent"}, headers=_h(u))
    assert r.status_code == 422 and "Priority 'Urgent'" in r.json()["detail"]


def _standard_only(db, user):
    """Give `user` a role that opens R&D Tasks and offers only the Standard priority."""
    role = Role(name=f"Standard only {user.id}", permissions=["rnd:tasks:view"],
                visibility_rules={"rnd:tasks": {"options": {"priority": ["standard"]}}})
    db.add(role)
    db.commit()
    user.roles = [*user.roles, role]
    db.commit()
    db.refresh(user)
    user.__dict__.pop("_visibility_effective_cache", None)


def _due(days=5):
    from datetime import date, timedelta
    return (date.today() + timedelta(days=days)).isoformat()


def test_rnd_task_priority_is_checked_on_every_create_and_edit_route(client, db, tor_env):
    """The role's Priority list lives in task_fields (apply_create / apply_edit), so the board, the
    requirement routes, the project routes, sub-tasks and PATCH all refuse a priority it leaves out."""
    bd, head, member, other, inq, project = _env(client, db)
    _standard_only(db, head)
    _standard_only(db, member)
    refused = "Priority 'Urgent' isn't available to your role — you can pick: Standard."

    # Board: requirement and prototype tasks.
    r = _req_task(client, inq, head, member, priority="Urgent")
    assert r.status_code == 422 and r.json()["detail"].startswith(refused), r.text
    r = _proj_task(client, project, head, member, priority="urgent")
    assert r.status_code == 422 and r.json()["detail"].startswith(refused), r.text
    # Direct routes.
    form = {"title": "GA drawing", "assigned_to_id": str(member.id), "due_date": _due(), "priority": "urgent"}
    r = client.post(f"{API}/rnd/requirement-work/inquiry/{inq.id}/tasks", data=form, headers=_h(head))
    assert r.status_code == 422 and r.json()["detail"].startswith(refused), r.text
    r = client.post(f"{API}/rnd/projects/{project.id}/tasks", data=form, headers=_h(head))
    assert r.status_code == 422 and r.json()["detail"].startswith(refused), r.text
    assert db.query(RndProjectTask).count() == 0 and db.query(RndRequirementTask).count() == 0

    # An allowed (or blank = Standard) priority creates the task.
    r = _req_task(client, inq, head, member)
    assert r.status_code == 200, r.text
    req_id = r.json()["id"]
    r = _proj_task(client, project, head, member, priority="Standard")
    assert r.status_code == 200, r.text
    proj_id = r.json()["id"]

    # Sub-tasks (the assignee splits the task).
    sub = {"title": "Brake calc", "assigned_to_id": str(other.id), "due_date": _due(2), "priority": "urgent"}
    r = client.post(f"{API}/rnd/requirement-work/tasks/{req_id}/subtasks", data=sub, headers=_h(member))
    assert r.status_code == 422 and r.json()["detail"].startswith(refused), r.text
    r = client.post(f"{API}/rnd/project-tasks/{proj_id}/subtasks", data={**sub, "assigned_to_id": str(head.id)}, headers=_h(member))
    assert r.status_code == 422 and r.json()["detail"].startswith(refused), r.text

    # PATCH: only a CHANGED priority is checked; the same value in another case is not a change.
    for base in (f"{API}/rnd/requirement-work/tasks/{req_id}", f"{API}/rnd/project-tasks/{proj_id}"):
        r = client.patch(base, json={"priority": "urgent"}, headers=_h(head))
        assert r.status_code == 422 and r.json()["detail"].startswith(refused), r.text
        r = client.patch(base, json={"priority": "STANDARD", "remarks": "Updated brief"}, headers=_h(head))
        assert r.status_code == 200, r.text

    # A role with no Priority rule is not limited.
    from app.tests.test_cov_crm_quotations_rnd import make_user
    free = make_user(db, "vis.free.rnd@premnathrail.com", apps=("rnd",))
    assert visibility.allowed_values(free, "rnd:tasks", "priority") is None


def test_rnd_task_fields_unit_apply_create_and_edit_normalise_before_checking(db):
    from types import SimpleNamespace
    from datetime import date
    from fastapi import HTTPException
    from app.modules.rnd.services import task_fields

    u = _member(db, "vis.rndunit@premnathrail.com", ["rnd"], ["rnd:tasks:view"], {"rnd:tasks": {"options": {"priority": ["standard"]}}})
    task = SimpleNamespace(due_date=date(2099, 1, 1), priority=None, start_date=None, work_status=None, checklist=[], progress_percent=0)
    with pytest.raises(HTTPException) as e:
        task_fields.apply_create(task, priority=" URGENT ", start_date=None, work_status=None, checklist=None, user=u)
    assert e.value.status_code == 422 and "Priority 'Urgent' isn't available" in e.value.detail
    task_fields.apply_create(task, priority=None, start_date=None, work_status=None, checklist=None, user=u)  # blank = Standard
    assert task.priority == "standard"
    with pytest.raises(HTTPException) as e:
        task_fields.apply_edit(task, {"priority": "Urgent"}, "Tester", u)
    assert e.value.status_code == 422
    assert task_fields.apply_edit(task, {"priority": "Standard"}, "Tester", u) == []


def test_work_order_and_project_priority_is_normalised_before_the_role_check(client, db):
    """A blank priority is stored as Standard, so a role that offers only Urgent must not slip it through;
    any case of an allowed value passes."""
    u = _member(db, "vis.l1@premnathrail.com", ["maintenance", "rnd"], MAINT_GRANTS + RND_GRANTS,
                {"maintenance:work_orders": {"options": {"priority": ["urgent"]}},
                 "rnd:projects": {"options": {"priority": ["urgent"]}}})
    asset = _asset(db)
    wo = {"asset_id": asset.id, "title": "Check", "wo_type": "preventive"}
    r = client.post(f"{API}/maintenance/work-orders", json=wo, headers=_h(u))
    assert r.status_code == 422 and "Priority 'Standard' isn't available to your role — you can pick: Urgent." in r.json()["detail"]
    r = client.post(f"{API}/maintenance/work-orders", json={**wo, "priority": ""}, headers=_h(u))
    assert r.status_code == 422 and "Priority 'Standard' isn't available" in r.json()["detail"]  # blank = Standard
    r = client.post(f"{API}/maintenance/work-orders", json={**wo, "priority": "URGENT"}, headers=_h(u))
    assert r.status_code == 200, r.text
    assert r.json()["priority"] == "urgent"
    proj = {"title": "Bogie", "objective": "Lighter frame", "origin_note": "MD asked", "attachment_count": 1, "origin": "new_project"}
    r = client.post(f"{API}/rnd/projects", json=proj, headers=_h(u))
    assert r.status_code == 422 and "Priority 'Standard' isn't available to your role — you can pick: Urgent." in r.json()["detail"]
    r = client.post(f"{API}/rnd/projects", json={**proj, "priority": ""}, headers=_h(u))
    assert r.status_code == 422 and "Priority 'Standard' isn't available" in r.json()["detail"]
    r = client.post(f"{API}/rnd/projects", json={**proj, "priority": "URGENT"}, headers=_h(u))
    assert r.status_code == 200, r.text
