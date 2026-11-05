"""Role-wise UI visibility in Production (core/visibility.py, catalogue in
core/features/production.py): Work Orders, BOM & Routing, Planning / MRP.
Coded dropdown values (work-order priority, BOM component category, control
key, confirmation, planned-order procurement) are refused by the server with
the real reason; a saved record's own value is only checked when it changes."""
import pytest

from app.core import visibility
from app.core.permission_registry import MODULES
from app.core.priority import PRIORITY_LABELS
from app.core.visibility import VISIBILITY, clean_rules
from app.modules.main.models.role import Role
from app.modules.production.models.bom import PRODUCTION_BOM_ITEM_CATEGORIES, PRODUCTION_CONFIRMATION_TYPES, PRODUCTION_CONTROL_KEYS
from app.modules.production.models.mrp import PLANNED_ORDER_PROCUREMENT
from app.modules.store.models.item import StoreItem
from app.tests.test_cov_production_execution import API, _sqlite_document_numbers, auth, make_user  # noqa: F401

WO_KEY, BOM_KEY, PLAN_KEY = "production:work_orders", "production:bom", "production:planning"
GRANTS = ["production:work_orders:view", "production:work_orders:create", "production:work_orders:edit",
          "production:work_orders.sub_orders:view", "production:work_orders.sub_orders:create",
          "production:bom:view", "production:bom:create", "production:bom:edit",
          "production:planning:view", "production:planning.planned_orders:view", "production:planning.planned_orders:create"]


def _role(db, name, rules=None):
    r = Role(name=name, permissions=list(GRANTS), visibility_rules=rules or {})
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _give(db, user, *roles):
    user.roles = list(roles)
    db.commit()
    db.refresh(user)
    user.__dict__.pop("_visibility_effective_cache", None)


@pytest.fixture
def env(client, db):
    """An admin who sets up an active BOM, a planner restricted to Standard priority / Text + Non-stock
    components / Internal operations with Optional confirmation / Buy planned orders, and an open planner."""
    admin = make_user(db, "vis.prod.admin@premnathrail.com")
    admin.role = "admin"
    db.commit()
    product = StoreItem(item_code="FG-VIS-1", item_name="Brake unit", item_type="finished_good", uom="NOS", status="active")
    part = StoreItem(item_code="RM-VIS-1", item_name="Plate", item_type="raw_material", uom="NOS", status="active")
    other = StoreItem(item_code="FG-VIS-2", item_name="Coupler", item_type="finished_good", uom="NOS", status="active")
    db.add_all([product, part, other])
    db.commit()
    bom = client.post(f"{API}/boms", json={"product_item_id": product.id, "items": [{"component_item_id": part.id, "quantity": 2}],
                                          "operations": [{"sequence": 10, "operation_name": "Weld"}]}, headers=auth(admin))
    assert bom.status_code == 200, bom.text
    # An admin is not a BOM approver: the named approver activates it.
    approver = make_user(db, "vis.prod.approver@premnathrail.com")
    assert client.post(f"{API}/boms/{bom.json()['id']}/activate", headers=auth(approver)).status_code == 200
    planner = make_user(db, "vis.prod.planner@premnathrail.com")
    _give(db, planner, _role(db, "Restricted planner", {
        WO_KEY: {"options": {"priority": ["standard"]}, "hidden_sections": ["remarks"]},
        BOM_KEY: {"options": {"item_category": ["non_stock", "text"], "control_key": ["internal"], "confirmation": ["optional"]}},
        PLAN_KEY: {"options": {"procurement": ["buy"]}},
    }))
    open_planner = make_user(db, "vis.prod.open@premnathrail.com")
    _give(db, open_planner, _role(db, "Open planner"))
    return dict(admin=admin, planner=planner, open=open_planner, product=product, part=part, other=other, bom=bom.json())


# ---------- catalogue ----------

def test_production_catalogue_keys_resolve_and_match_the_coded_values():
    for key in (WO_KEY, BOM_KEY, PLAN_KEY):
        assert key in VISIBILITY, key
        module, tab = key.split(":", 1)
        assert tab in MODULES[module]["actions"], key
    cat = visibility.catalog()
    assert cat[WO_KEY]["options"]["priority"]["values"] == PRIORITY_LABELS
    assert set(cat[BOM_KEY]["options"]["item_category"]["values"]) == set(PRODUCTION_BOM_ITEM_CATEGORIES)
    assert set(cat[BOM_KEY]["options"]["control_key"]["values"]) == set(PRODUCTION_CONTROL_KEYS)
    assert set(cat[BOM_KEY]["options"]["confirmation"]["values"]) == set(PRODUCTION_CONFIRMATION_TYPES)
    assert set(cat[PLAN_KEY]["options"]["procurement"]["values"]) == set(PLANNED_ORDER_PROCUREMENT)
    # screens + required-holding sections locked
    assert list(cat[WO_KEY]["screens"]) == ["form", "detail", "list"]
    assert cat[WO_KEY]["sections"]["what_to_build"]["locked"] and not cat[WO_KEY]["sections"]["remarks"]["locked"]
    assert cat[BOM_KEY]["sections"]["product"]["locked"] and cat[BOM_KEY]["sections"]["components"]["locked"]
    assert cat[PLAN_KEY]["sections"]["item_quantity"]["locked"] and cat[PLAN_KEY]["sections"]["planned_orders"]["locked"]


def test_production_tables_never_offer_code_status_or_money_columns():
    banned = {"code", "number", "status", "value", "rate", "cost", "amount", "price"}
    for key in (WO_KEY, BOM_KEY, PLAN_KEY):
        for table, spec in VISIBILITY[key]["tables"].items():
            for col in spec["columns"]:
                assert not (set(col.lower().split("_")) & banned), (key, table, col)


def test_clean_rules_refuses_hiding_locked_production_sections():
    with pytest.raises(ValueError) as e:
        clean_rules({BOM_KEY: {"hidden_sections": ["components"]}})
    assert str(e.value) == "'Components' holds a required field, so it can't be hidden. Leave it visible."
    assert clean_rules({WO_KEY: {"hidden_sections": ["remarks"], "hidden_columns": {"work_orders": ["progress"]}}}) == {
        WO_KEY: {"hidden_sections": ["remarks"], "hidden_columns": {"work_orders": ["progress"]}}}


# ---------- Work orders ----------

def test_work_order_create_refuses_a_priority_outside_the_role(client, env):
    body = {"bom_id": env["bom"]["id"], "quantity_planned": 1}
    r = client.post(f"{API}/work-orders", json={**body, "priority": "urgent"}, headers=auth(env["planner"]))
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == (
        "Priority 'Urgent' isn't available to your role — you can pick: Standard. Ask an admin to widen it in "
        "Organization › Role & Permissions › Production › Work Orders › Visibility.")
    r = client.post(f"{API}/work-orders", json=body, headers=auth(env["planner"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/work-orders", json={**body, "priority": "urgent"}, headers=auth(env["open"]))
    assert r.status_code == 200, r.text


def test_work_order_update_checks_only_a_changed_priority(client, env):
    wo = client.post(f"{API}/work-orders", json={"bom_id": env["bom"]["id"], "quantity_planned": 1, "priority": "urgent"},
                     headers=auth(env["admin"])).json()
    h = auth(env["planner"])
    assert client.patch(f"{API}/work-orders/{wo['id']}", json={"remarks": "x", "priority": "urgent"}, headers=h).status_code == 200
    assert client.patch(f"{API}/work-orders/{wo['id']}", json={"priority": "standard"}, headers=h).status_code == 200
    r = client.patch(f"{API}/work-orders/{wo['id']}", json={"priority": "urgent"}, headers=h)
    assert r.status_code == 422 and "Priority 'Urgent' isn't available to your role" in r.json()["detail"]


# ---------- BOM ----------

def _bom_body(env, **item):
    return {"product_item_id": env["other"].id,
            "items": [{"component_item_id": env["part"].id, "quantity": 1, **item}],
            "operations": [{"sequence": 10, "operation_name": "Fit"}]}


def test_bom_create_refuses_values_outside_the_role(client, env):
    h = auth(env["planner"])
    r = client.post(f"{API}/boms", json=_bom_body(env), headers=h)  # default category Stock
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith(
        "Component category 'Stock' isn't available to your role — you can pick: Non-stock, Text.")
    body = _bom_body(env, item_category="non_stock")
    body["operations"][0]["control_key"] = "external"
    r = client.post(f"{API}/boms", json=body, headers=h)
    assert r.status_code == 422 and r.json()["detail"].startswith("Control key 'External (job work)' isn't available to your role")
    body["operations"][0] = {"sequence": 10, "operation_name": "Fit", "confirmation": "required"}
    r = client.post(f"{API}/boms", json=body, headers=h)
    assert r.status_code == 422 and r.json()["detail"].startswith("Confirmation 'Required' isn't available to your role")
    body["operations"][0]["confirmation"] = "optional"
    r = client.post(f"{API}/boms", json=body, headers=h)
    assert r.status_code == 200, r.text


def test_bom_update_checks_only_new_or_changed_lines(client, env):
    draft = client.post(f"{API}/boms", json=_bom_body(env), headers=auth(env["admin"])).json()  # holds a Stock line
    h = auth(env["planner"])
    keep = {"items": [{"component_item_id": env["part"].id, "quantity": 3}], "operations": [{"sequence": 10, "operation_name": "Fit"}]}
    assert client.patch(f"{API}/boms/{draft['id']}", json=keep, headers=h).status_code == 200
    changed = {**keep, "operations": [{"sequence": 10, "operation_name": "Fit", "control_key": "external"}]}
    r = client.patch(f"{API}/boms/{draft['id']}", json=changed, headers=h)
    assert r.status_code == 422 and "Control key 'External (job work)'" in r.json()["detail"]
    text_line = {**keep, "items": keep["items"] + [{"item_category": "text", "line_text": "Torque M16", "quantity": 1}]}
    assert client.patch(f"{API}/boms/{draft['id']}", json=text_line, headers=h).status_code == 200


# ---------- Planned orders ----------

def test_planned_order_refuses_a_procurement_outside_the_role(client, env):
    h = auth(env["planner"])
    body = {"item_id": env["product"].id, "quantity": 1, "finish_date": "2030-01-31"}
    r = client.post(f"{API}/mrp/planned-orders", json={**body, "procurement": "make"}, headers=h)
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith("Procurement 'Make' isn't available to your role — you can pick: Buy.")
    # "From BOM" resolves to Make for an item with an active BOM — refused too
    r = client.post(f"{API}/mrp/planned-orders", json=body, headers=h)
    assert r.status_code == 422 and "Procurement 'Make'" in r.json()["detail"]
    r = client.post(f"{API}/mrp/planned-orders", json={**body, "procurement": "buy"}, headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/mrp/planned-orders", json={**body, "procurement": "make"}, headers=auth(env["open"]))
    assert r.status_code == 200, r.text


def test_admin_is_never_restricted(client, db, env):
    _give(db, env["admin"], _role(db, "Restricted admin role", {WO_KEY: {"options": {"priority": ["standard"]}}}))
    r = client.post(f"{API}/work-orders", json={"bom_id": env["bom"]["id"], "quantity_planned": 1, "priority": "urgent"},
                    headers=auth(env["admin"]))
    assert r.status_code == 200, r.text


# ---------- normalised priority (L1) and discipline merge (L3) ----------

def _urgent_only_user(db, email):
    u = make_user(db, email)
    _give(db, u, _role(db, f"Urgent only {email}", {WO_KEY: {"options": {"priority": ["urgent"]}}}))
    return u


def test_work_order_priority_is_normalised_before_the_role_check(client, db, env):
    urgent = _urgent_only_user(db, "vis.prod.urgent@premnathrail.com")
    body = {"bom_id": env["bom"]["id"], "quantity_planned": 1}
    r = client.post(f"{API}/work-orders", json={**body, "priority": ""}, headers=auth(urgent))  # blank is stored as Standard
    assert r.status_code == 422 and "Priority 'Standard' isn't available to your role — you can pick: Urgent." in r.json()["detail"]
    r = client.post(f"{API}/work-orders", json={**body, "priority": "URGENT"}, headers=auth(urgent))
    assert r.status_code == 200, r.text
    wo_id = r.json()["id"]
    r = client.patch(f"{API}/work-orders/{wo_id}", json={"priority": ""}, headers=auth(urgent))
    assert r.status_code == 422 and "Priority 'Standard' isn't available" in r.json()["detail"]
    r = client.patch(f"{API}/work-orders/{wo_id}", json={"priority": "Urgent", "remarks": "same priority, other case"}, headers=auth(urgent))
    assert r.status_code == 200, r.text


def test_merge_discipline_is_refused_for_a_role_that_may_not_pick_stock(client, db, env):
    """A merged electrical / hydraulic BOM arrives as Stock lines, like the Design transfer."""
    merge_grants = [*GRANTS, "production:bom.discipline_merge:view", "production:bom.discipline_merge:create"]
    limited = make_user(db, "vis.prod.merge@premnathrail.com")
    role = Role(name="Merging planner", permissions=merge_grants,
                visibility_rules={BOM_KEY: {"options": {"item_category": ["non_stock", "text"]}}})
    db.add(role)
    db.commit()
    _give(db, limited, role)
    draft = client.post(f"{API}/boms", json=_bom_body(env), headers=auth(env["admin"])).json()
    r = client.post(f"{API}/boms/{draft['id']}/merge-discipline", json={"source_type": "electrical", "source_id": 1, "multiplier": 1},
                    headers=auth(limited))
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith(
        "Merging an electrical / hydraulic BOM adds its components as Stock lines, and your role's Component category allows only: Non-stock, Text.")
    assert "Production › BOM & Routing › Visibility" in r.json()["detail"]
    # A role that offers Stock is past the visibility rule (the missing source is then the next, different, error).
    _give(db, limited, _role(db, "Stock planner", {BOM_KEY: {"options": {"item_category": ["stock"]}}}))
    limited.roles[0].permissions = merge_grants
    db.commit()
    r = client.post(f"{API}/boms/{draft['id']}/merge-discipline", json={"source_type": "electrical", "source_id": 1, "multiplier": 1},
                    headers=auth(limited))
    assert "adds its components as Stock lines" not in r.text, r.text
