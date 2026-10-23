"""Coverage tests for Production BOM & routing: draft → active → obsolete
lifecycle, version rules, standard cost, line validation, real error
messages and Permission Matrix enforcement on the BOM tab."""
from app.core.permission_words import place
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.production.models.bom import ProductionBom
from app.modules.store.models.item import StoreItem

API = "/api/v1/production"


def make_user(db, email, apps=("production", "quality"), grants=None):
    user = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=list(apps))
    if grants is not None:
        user.granular_permissions = list(grants)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@pytest.fixture
def ctx(client, db):
    user = make_user(db, "bom.planner@premnathrail.com")
    product = StoreItem(item_code="FG-AXL-01", item_name="Axle assembly", item_type="finished_good", uom="NOS", status="active")
    shaft = StoreItem(item_code="RM-SFT-01", item_name="Shaft blank", item_type="raw_material", uom="NOS", standard_cost=200.0, status="active")
    # No standard cost: falls back to moving-average cost.
    grease = StoreItem(item_code="RM-GRS-01", item_name="Grease", item_type="consumable", uom="KG", moving_average_cost=50.0, status="active")
    # Neither cost set: contributes 0.
    tag = StoreItem(item_code="RM-TAG-01", item_name="ID tag", item_type="consumable", uom="NOS", status="active")
    db.add_all([product, shaft, grease, tag])
    db.commit()
    h = auth(user)
    ws = client.post(f"{API}/workstations", json={"code": "lathe-01", "name": "Lathe", "hourly_rate": 300}, headers=h).json()
    return {"user": user, "h": h, "product": product, "shaft": shaft, "grease": grease, "tag": tag, "ws": ws}


def _create(client, ctx, **overrides):
    body = {
        "product_item_id": ctx["product"].id, "base_quantity": 1,
        "items": [{"component_item_id": ctx["shaft"].id, "quantity": 2}],
        "operations": [{"sequence": 10, "operation_name": "Turning", "workstation_id": ctx["ws"]["id"], "run_hours_per_unit": 1}],
    }
    body.update(overrides)
    return client.post(f"{API}/boms", json=body, headers=ctx["h"])


# ---------------------------------------------------------------------------
# Standard cost
# ---------------------------------------------------------------------------

def test_standard_cost_uses_moving_average_fallback_and_base_quantity(client, ctx):
    resp = _create(client, ctx, base_quantity=2, items=[
        {"component_item_id": ctx["shaft"].id, "quantity": 2, "scrap_percent": 5},
        {"component_item_id": ctx["grease"].id, "quantity": 0.5},
        {"component_item_id": ctx["tag"].id, "quantity": 2},
    ], operations=[
        {"sequence": 10, "operation_name": "Turning", "workstation_id": ctx["ws"]["id"], "setup_hours": 0.5, "run_hours_per_unit": 1.5},
        {"sequence": 20, "operation_name": "Hand finish", "run_hours_per_unit": 3},  # no workstation → no rate
    ])
    assert resp.status_code == 200, resp.text
    bom = resp.json()
    # 2 × 1.05 × 200 + 0.5 × 50 + 2 × 0 = 445
    assert bom["standard_material_cost"] == 445.0
    # (0.5 + 1.5 × base 2) × 300 = 1050; unassigned op adds nothing.
    assert bom["standard_labour_cost"] == 1050.0
    costs = {line["item_code"]: line["unit_cost"] for line in bom["items"]}
    assert costs == {"RM-SFT-01": 200.0, "RM-GRS-01": 50.0, "RM-TAG-01": 0.0}
    assert bom["product_code"] == "FG-AXL-01" and bom["created_by_name"] == "bom.planner"


def test_editing_a_draft_recomputes_cost_and_replaces_lines(client, ctx):
    bom = _create(client, ctx).json()
    assert bom["standard_material_cost"] == 400.0 and bom["standard_labour_cost"] == 300.0
    patched = client.patch(f"{API}/boms/{bom['id']}", json={
        "items": [{"component_item_id": ctx["grease"].id, "quantity": 1}],
        "operations": [
            {"sequence": 30, "operation_name": "Pack"},
            {"sequence": 5, "operation_name": "Inspect", "workstation_id": ctx["ws"]["id"], "setup_hours": 2},
        ],
        "remarks": "rev a",
    }, headers=ctx["h"])
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert [i["item_code"] for i in body["items"]] == ["RM-GRS-01"]
    assert [o["sequence"] for o in body["operations"]] == [5, 30]  # routing re-sorted by sequence
    assert body["standard_material_cost"] == 50.0 and body["standard_labour_cost"] == 600.0
    assert body["remarks"] == "rev a"


def test_workstation_rate_change_flows_into_bom_standard_cost(client, ctx):
    bom = _create(client, ctx).json()
    client.patch(f"{API}/workstations/{ctx['ws']['id']}", json={"hourly_rate": 1000}, headers=ctx["h"])
    assert client.get(f"{API}/boms/{bom['id']}", headers=ctx["h"]).json()["standard_labour_cost"] == 1000.0


# ---------------------------------------------------------------------------
# Line validation — real error messages
# ---------------------------------------------------------------------------

def test_create_rejects_unknown_or_inactive_product(client, db, ctx):
    missing = _create(client, ctx, product_item_id=99999)
    assert missing.status_code == 404 and "#99999 not found" in missing.json()["detail"]
    ctx["product"].status = "discontinued"
    db.commit()
    inactive = _create(client, ctx)
    assert inactive.status_code == 409
    assert "FG-AXL-01 is discontinued" in inactive.json()["detail"] and "Reactivate" in inactive.json()["detail"]


def test_create_validates_components_and_routing(client, ctx):
    shaft = ctx["shaft"].id
    dup = _create(client, ctx, items=[{"component_item_id": shaft, "quantity": 1}, {"component_item_id": shaft, "quantity": 2}])
    assert dup.status_code == 400 and "more than once" in dup.json()["detail"]

    unknown = _create(client, ctx, items=[{"component_item_id": 424242, "quantity": 1}])
    assert unknown.status_code == 404 and "#424242" in unknown.json()["detail"]

    seq = _create(client, ctx, operations=[
        {"sequence": 10, "operation_name": "A"}, {"sequence": 10, "operation_name": "B"},
    ])
    assert seq.status_code == 400 and "same sequence" in seq.json()["detail"]

    ws = _create(client, ctx, operations=[{"sequence": 10, "operation_name": "A", "workstation_id": 777}])
    assert ws.status_code == 404 and "Workstation(s) #777 not found" in ws.json()["detail"]

    self_ref = _create(client, ctx, items=[{"component_item_id": ctx["product"].id, "quantity": 1}])
    assert self_ref.status_code == 400 and "own BOM" in self_ref.json()["detail"]


def test_create_rejects_inactive_component(client, db, ctx):
    ctx["grease"].status = "inactive"
    db.commit()
    resp = _create(client, ctx, items=[{"component_item_id": ctx["grease"].id, "quantity": 1}])
    assert resp.status_code == 409 and "RM-GRS-01" in resp.json()["detail"]


@pytest.mark.parametrize("line", [
    {"quantity": 0},
    {"quantity": -1},
    {"quantity": 1, "scrap_percent": 100},
    {"quantity": 1, "scrap_percent": -5},
])
def test_component_quantity_and_scrap_bounds(client, ctx, line):
    resp = _create(client, ctx, items=[{"component_item_id": ctx["shaft"].id, **line}])
    assert resp.status_code == 422


def test_deleted_workstation_cannot_be_routed(client, ctx):
    other = client.post(f"{API}/workstations", json={"code": "OLD-01", "name": "Old press"}, headers=ctx["h"]).json()
    assert client.delete(f"{API}/workstations/{other['id']}", headers=ctx["h"]).status_code == 200
    resp = _create(client, ctx, operations=[{"sequence": 10, "operation_name": "Press", "workstation_id": other["id"]}])
    assert resp.status_code == 404 and f"#{other['id']}" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Lifecycle + version rules
# ---------------------------------------------------------------------------

def test_activate_requires_components(client, ctx):
    bom = _create(client, ctx, items=[]).json()
    resp = client.post(f"{API}/boms/{bom['id']}/activate", headers=ctx["h"])
    assert resp.status_code == 400 and "no components" in resp.json()["detail"]
    assert bom["bom_number"] in resp.json()["detail"]


def test_activation_records_who_and_when(client, ctx):
    bom = _create(client, ctx).json()
    active = client.post(f"{API}/boms/{bom['id']}/activate", headers=ctx["h"]).json()
    assert active["status"] == "active"
    assert active["activated_by_id"] == ctx["user"].id and active["activated_by_name"] == "bom.planner"
    assert active["activated_at"] is not None


def test_invalid_transitions_give_actionable_messages(client, ctx):
    h = ctx["h"]
    bom = _create(client, ctx).json()

    draft_obsolete = client.post(f"{API}/boms/{bom['id']}/obsolete", headers=h)
    assert draft_obsolete.status_code == 409
    assert "Only an active BOM can be made obsolete" in draft_obsolete.json()["detail"] and "draft" in draft_obsolete.json()["detail"]

    client.post(f"{API}/boms/{bom['id']}/activate", headers=h)
    again = client.post(f"{API}/boms/{bom['id']}/activate", headers=h)
    assert again.status_code == 409 and "is active, so it can't be activated" in again.json()["detail"]

    no_delete = client.delete(f"{API}/boms/{bom['id']}", headers=h)
    assert no_delete.status_code == 409 and "can't be deleted" in no_delete.json()["detail"]

    obsolete = client.post(f"{API}/boms/{bom['id']}/obsolete", headers=h)
    assert obsolete.status_code == 200 and obsolete.json()["status"] == "obsolete"

    edit_obsolete = client.patch(f"{API}/boms/{bom['id']}", json={"remarks": "x"}, headers=h)
    assert edit_obsolete.status_code == 409 and "is obsolete" in edit_obsolete.json()["detail"]
    reactivate = client.post(f"{API}/boms/{bom['id']}/activate", headers=h)
    assert reactivate.status_code == 409

    wo = client.post(f"{API}/work-orders", json={"bom_id": bom["id"], "quantity_planned": 1}, headers=h)
    assert wo.status_code == 409 and "obsolete" in wo.json()["detail"] and "activate it first" in wo.json()["detail"]


def test_new_version_rules(client, ctx):
    h = ctx["h"]
    v1 = _create(client, ctx).json()
    # A draft already open for the product: no second draft via New Version.
    blocked = client.post(f"{API}/boms/{v1['id']}/new-version", headers=h)
    assert blocked.status_code == 409
    assert v1["bom_number"] in blocked.json()["detail"] and "already an open draft" in blocked.json()["detail"]

    client.post(f"{API}/boms/{v1['id']}/activate", headers=h)
    v2 = client.post(f"{API}/boms/{v1['id']}/new-version", headers=h).json()
    assert v2["version"] == 2 and v2["status"] == "draft"
    assert v2["remarks"] == f"Copied from {v1['bom_number']} v1"
    assert v2["bom_number"] != v1["bom_number"]
    assert [o["operation_name"] for o in v2["operations"]] == ["Turning"]
    # The copy is independent: editing v2 leaves v1 alone.
    client.patch(f"{API}/boms/{v2['id']}", json={"items": [{"component_item_id": ctx["grease"].id, "quantity": 3}]}, headers=h)
    assert [i["item_code"] for i in client.get(f"{API}/boms/{v1['id']}", headers=h).json()["items"]] == ["RM-SFT-01"]

    # Deleting the draft frees the slot; version numbers keep climbing.
    assert client.delete(f"{API}/boms/{v2['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/boms/{v2['id']}", headers=h).status_code == 404
    v3 = client.post(f"{API}/boms/{v1['id']}/new-version", headers=h).json()
    assert v3["version"] == 3

    # Activating v3 obsoletes v1 — exactly one active version per product.
    client.post(f"{API}/boms/{v3['id']}/activate", headers=h)
    statuses = {b["version"]: b["status"] for b in client.get(f"{API}/boms", params={"product_item_id": ctx["product"].id}, headers=h).json()}
    assert statuses == {1: "obsolete", 3: "active"}


def test_new_version_can_be_cut_from_an_obsolete_bom(client, ctx):
    h = ctx["h"]
    v1 = _create(client, ctx).json()
    client.post(f"{API}/boms/{v1['id']}/activate", headers=h)
    client.post(f"{API}/boms/{v1['id']}/obsolete", headers=h)
    v2 = client.post(f"{API}/boms/{v1['id']}/new-version", headers=h)
    assert v2.status_code == 200 and v2.json()["version"] == 2


def test_existing_work_orders_keep_their_lines_after_new_version(client, db, ctx):
    h = ctx["h"]
    v1 = _create(client, ctx).json()
    client.post(f"{API}/boms/{v1['id']}/activate", headers=h)
    wo = client.post(f"{API}/work-orders", json={"bom_id": v1["id"], "quantity_planned": 3}, headers=h).json()
    v2 = client.post(f"{API}/boms/{v1['id']}/new-version", headers=h).json()
    client.patch(f"{API}/boms/{v2['id']}", json={"items": [{"component_item_id": ctx["grease"].id, "quantity": 1}]}, headers=h)
    client.post(f"{API}/boms/{v2['id']}/activate", headers=h)

    again = client.get(f"{API}/work-orders/{wo['id']}", headers=h).json()
    assert [(m["item_id"], m["required_qty"]) for m in again["materials"]] == [(ctx["shaft"].id, 6.0)]
    assert again["bom_version"] == 1
    assert client.get(f"{API}/boms/{v1['id']}", headers=h).json()["work_order_count"] == 1


def test_list_filters_by_status_and_search(client, ctx):
    h = ctx["h"]
    bom = _create(client, ctx).json()
    assert [b["id"] for b in client.get(f"{API}/boms", params={"status": "draft"}, headers=h).json()] == [bom["id"]]
    assert client.get(f"{API}/boms", params={"status": "active"}, headers=h).json() == []
    assert len(client.get(f"{API}/boms", params={"search": "axle"}, headers=h).json()) == 1
    assert client.get(f"{API}/boms", params={"search": "nothing-like-this"}, headers=h).json() == []


def test_bom_numbers_are_sequential_per_year(client, ctx):
    year = date.today().year
    a = _create(client, ctx).json()
    client.post(f"{API}/boms/{a['id']}/activate", headers=ctx["h"])
    b = client.post(f"{API}/boms/{a['id']}/new-version", headers=ctx["h"]).json()
    assert a["bom_number"] == f"BOM-{year}-0001"
    assert b["bom_number"] == f"BOM-{year}-0002"


def test_second_draft_for_same_product_is_blocked_on_create(client, ctx):
    _create(client, ctx)
    second = _create(client, ctx)
    assert second.status_code == 409


def test_number_series_survives_rolling_past_9999(db, ctx):
    from app.modules.production.service import generate_bom_number
    year = date.today().year
    for n in ("9999", "10000"):
        db.add(ProductionBom(bom_number=f"BOM-{year}-{n}", product_item_id=ctx["product"].id, version=int(n), status="obsolete"))
    db.commit()
    assert generate_bom_number(db) == f"BOM-{year}-10001"


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

def test_bom_endpoints_need_the_production_app(client, db, ctx):
    outsider = make_user(db, "store.only@premnathrail.com", apps=("store",))
    h = auth(outsider)
    assert client.get(f"{API}/boms", headers=h).status_code == 403
    resp = _create(client, {**ctx, "h": h})
    assert resp.status_code == 403 and "Production" in resp.json()["detail"]


def test_bom_tab_and_action_matrix(client, db, ctx):
    bom = _create(client, ctx).json()

    wo_only = make_user(db, "wo.only@premnathrail.com", grants=["production:work_orders:view"])
    denied = client.get(f"{API}/boms", headers=auth(wo_only))
    assert denied.status_code == 403 and place("production:bom:view") in denied.json()["detail"]

    viewer = make_user(db, "bom.viewer@premnathrail.com", grants=["production:bom:view"])
    hv = auth(viewer)
    assert client.get(f"{API}/boms", headers=hv).status_code == 200
    create = _create(client, {**ctx, "h": hv})
    assert create.status_code == 403 and "'Create' permission on Production › BOM & Routing" in create.json()["detail"]
    assert client.patch(f"{API}/boms/{bom['id']}", json={"remarks": "x"}, headers=hv).status_code == 403
    assert client.delete(f"{API}/boms/{bom['id']}", headers=hv).status_code == 403

    author = make_user(db, "bom.author@premnathrail.com",
                       grants=["production:bom:view", "production:bom:create", "production:bom:edit"])
    ha = auth(author)
    assert client.patch(f"{API}/boms/{bom['id']}", json={"remarks": "ok"}, headers=ha).status_code == 200
    viewer_activate = client.post(f"{API}/boms/{bom['id']}/activate", headers=hv)
    assert viewer_activate.status_code == 403 and "'Approve' (to activate)" in viewer_activate.json()["detail"]

    approver = make_user(db, "bom.approver@premnathrail.com", grants=["production:bom:view", "production:bom:approve"])
    # Central approval engine: an author without Approve submits the draft
    # for activation (it stays a draft) …
    submitted = client.post(f"{API}/boms/{bom['id']}/activate", headers=ha)
    assert submitted.status_code == 200 and submitted.json()["status"] == "draft"
    assert client.patch(f"{API}/boms/{bom['id']}", json={"remarks": "late edit"}, headers=ha).status_code == 409
    # … and the approver's Activate click decides it.
    activated = client.post(f"{API}/boms/{bom['id']}/activate", headers=auth(approver))
    assert activated.status_code == 200 and activated.json()["status"] == "active"


def test_bom_detail_respects_tab_restriction(client, db, ctx):
    bom = _create(client, ctx).json()
    floor_only = make_user(db, "floor.only2@premnathrail.com", grants=["production:shop_floor:view"])
    assert client.get(f"{API}/boms/{bom['id']}", headers=auth(floor_only)).status_code == 403
    # The New Work Order form loads the chosen BOM, so Work Orders users may read it.
    wo_only = make_user(db, "wo.only2@premnathrail.com", grants=["production:work_orders:view"])
    assert client.get(f"{API}/boms/{bom['id']}", headers=auth(wo_only)).status_code == 200
