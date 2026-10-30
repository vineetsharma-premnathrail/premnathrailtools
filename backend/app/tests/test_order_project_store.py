"""Store ↔ Order Projects (2026-10-17): project stock through reservations —
holds for a vehicle / lot block free stock, an issue for the same element
consumes them first, other issues are refused unless a Store Manager overrides
with a reason; GRN material of a project PO line is held automatically; issues
for an RRV order must carry the element; the 360 'store' column."""
from datetime import date

import pytest

from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.production.models.work_order import ProductionWorkOrder
from app.modules.projects import so_projects as ops
from app.modules.sales.models.order import SalesOrder
from app.modules.projects.models.project import PmProject
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.material_issue import StoreMaterialIssue
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.services import project_stock
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests._stock_seed import seed_opening_stock
from app.tests._so_project_helpers import hdr, make_user, order_with_project

ISS = "/api/v1/store/material-issues"
RES = "/api/v1/store/stock-reservations"


@pytest.fixture
def env(client, db):
    so = order_with_project(db, qty=2, price=1000000)
    db.expire_all()
    project = db.query(PmProject).filter(PmProject.sales_order_id == so["id"]).one()
    v1, v2 = sorted(project.elements, key=lambda e: e.element_no)
    keeper = make_user(db, "op.keeper@premnathrail.com", apps=("store",))
    manager = make_user(db, "op.storemgr@premnathrail.com", apps=("store",), is_store_manager=True)
    loc = StoreLocation(name="OP Store", code="OPS")
    item = StoreItem(item_code="MT-OPS-0001", item_name="Hydraulic pump", uom="NOS", item_type="material")
    db.add_all([loc, item])
    db.commit()
    seed_opening_stock(db, item.id, loc.id, 10, created_by_id=manager.id)
    return {"so": so, "project": project, "v1": v1, "v2": v2, "keeper": keeper, "manager": manager, "loc": loc, "item": item}


def _vehicle_build(db, env, el, number, status="planned"):
    """The RRV build of a vehicle (Production may already plan one per vehicle at confirmation)."""
    b = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.sales_schedule_id == el.sales_schedule_id).first()
    if b is None:
        b = ProductionRrvBuild(build_number=number, rrv_model="RRV-10T", status=status,
                               sales_order_id=env["so"]["id"], sales_schedule_id=el.sales_schedule_id)
        db.add(b)
        db.flush()
    return b


def _reserve(client, env, el, qty, user=None):
    r = client.post(RES, json={"item_id": env["item"].id, "location_id": env["loc"].id, "quantity": qty,
                               "order_project_id": env["project"].id, "order_project_element_id": el.id},
                    headers=hdr(user or env["keeper"]))
    assert r.status_code == 200, r.text
    return r.json()


def _issue(client, env, qty, user=None, **body):
    payload = {"location_id": env["loc"].id, "issue_type": "production", "items": [{"item_id": env["item"].id, "quantity": qty}]}
    payload.update(body)
    return client.post(ISS, json=payload, headers=hdr(user or env["keeper"]))


def _balance(db, env):
    db.expire_all()
    return db.query(StoreStockBalance).filter(StoreStockBalance.item_id == env["item"].id,
                                              StoreStockBalance.location_id == env["loc"].id).one()


def test_project_reservation_blocks_free_stock_and_is_consumed_by_its_element(client, db, env):
    res = _reserve(client, env, env["v1"], 8)
    assert res["op_number"] == env["project"].project_code and res["element_no"] == env["v1"].element_no
    assert res["original_qty"] == 8 and res["source_type"] == "manual"
    assert _balance(db, env).reserved_qty == 8

    # Element required when a project is picked.
    r = client.post(RES, json={"item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 1,
                               "order_project_id": env["project"].id}, headers=hdr(env["keeper"]))
    assert r.status_code == 422 and "vehicle / lot" in r.json()["detail"]

    # Non-project issue of 5: only 2 free, the rest is held for vehicle 1 → refused, naming the holder.
    r = _issue(client, env, 5, project_or_work_order="Shop stock")
    assert r.status_code == 409, r.text
    assert env["v1"].element_no.split("/")[0] in r.json()["detail"] and res["reservation_number"] in r.json()["detail"]
    assert "Store Manager" in r.json()["detail"]

    # Issue 5 for vehicle 1 → its hold is consumed first.
    r = _issue(client, env, 5, order_project_id=env["project"].id, order_project_element_id=env["v1"].id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["order_project_element_id"] == env["v1"].id and body["op_number"] == env["project"].project_code
    assert body["items"][0]["order_project_element_id"] == env["v1"].id
    assert env["v1"].label in body["items"][0]["element_display"]
    bal = _balance(db, env)
    assert bal.on_hand_qty == 5 and bal.reserved_qty == 3
    row = db.get(StoreStockReservation, res["id"])
    assert row.status == "active" and row.quantity == 3

    # Issue 3 more → the hold is fulfilled.
    r = _issue(client, env, 3, order_project_id=env["project"].id, order_project_element_id=env["v1"].id)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(StoreStockReservation, res["id"]).status == "fulfilled"
    assert _balance(db, env).reserved_qty == 0


def test_other_element_needs_store_manager_override_with_reason(client, db, env):
    res = _reserve(client, env, env["v1"], 9)
    body = {"order_project_id": env["project"].id, "order_project_element_id": env["v2"].id}
    # Keeper: refused.
    r = _issue(client, env, 4, **body)
    assert r.status_code == 409 and "another project / vehicle" in r.json()["detail"]
    # Store Manager without a reason: asked for one.
    r = _issue(client, env, 4, user=env["manager"], **body)
    assert r.status_code == 422 and "Reason for using project stock" in r.json()["detail"]
    # With a reason: allowed, only the shortfall (3) released from vehicle 1's hold, reason recorded.
    r = _issue(client, env, 4, user=env["manager"], project_stock_override_reason="Vehicle 2 dispatch moved earlier", **body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["project_stock_override_reason"] == "Vehicle 2 dispatch moved earlier"
    assert res["reservation_number"] in out["remarks"]
    db.expire_all()
    row = db.get(StoreStockReservation, res["id"])
    assert row.status == "active" and row.quantity == 6 and "Store Manager override" in row.remarks
    bal = _balance(db, env)
    assert bal.on_hand_qty == 6 and bal.reserved_qty == 6


def test_rrv_order_issue_must_carry_the_element(client, db, env):
    v1, v2 = env["v1"], env["v2"]
    build = _vehicle_build(db, env, v1, "RRV-2026-0901")
    bno = build.build_number
    wo = ProductionWorkOrder(wo_number="WO-OPS-0001", product_item_id=env["item"].id, bom_id=1, quantity_planned=1,
                             status="released", sales_order_id=env["so"]["id"])
    db.add(wo)
    db.commit()

    # Issue against the build → element auto-filled from its delivery row.
    r = _issue(client, env, 1, project_or_work_order=bno.lower())
    assert r.status_code == 200, r.text
    assert r.json()["order_project_element_id"] == v1.id and r.json()["order_project_id"] == env["project"].id

    # Picking another vehicle than the build's → refused.
    r = _issue(client, env, 1, project_or_work_order=bno, order_project_element_id=v2.id)
    assert r.status_code == 422 and v1.element_no.split("/")[1] in r.json()["detail"]

    # Work order of the RRV order without a build → the element is mandatory.
    r = _issue(client, env, 1, project_or_work_order="WO-OPS-0001")
    assert r.status_code == 422 and env["project"].project_code in r.json()["detail"]
    r = _issue(client, env, 1, project_or_work_order="WO-OPS-0001", order_project_element_id=v2.id)
    assert r.status_code == 200, r.text
    assert r.json()["order_project_element_id"] == v2.id

    # Non-project types never carry an element.
    r = client.post(ISS, json={"location_id": env["loc"].id, "issue_type": "scrap", "remarks": "Damaged",
                               "order_project_element_id": v1.id,
                               "items": [{"item_id": env["item"].id, "quantity": 1}]}, headers=hdr(env["manager"]))
    assert r.status_code == 200, r.text
    assert r.json()["order_project_element_id"] is None


def test_dispatch_lines_take_the_delivery_row_element(client, db, env):
    from types import SimpleNamespace as NS
    v1, v2 = env["v1"], env["v2"]
    payload = NS(order_project_id=None, order_project_element_id=None, project_or_work_order=None, sales_order_id=env["so"]["id"],
                 items=[NS(sales_schedule_id=v1.sales_schedule_id, order_project_element_id=None),
                        NS(sales_schedule_id=v2.sales_schedule_id, order_project_element_id=None)])
    link = project_stock.resolve_issue_project(db, "dispatch", payload)
    assert link["line_elements"] == [v1.id, v2.id]
    assert link["project_id"] == env["project"].id and link["element_id"] is None

    # A line naming another element than its row → refused.
    payload.items[0].order_project_element_id = v2.id
    with pytest.raises(Exception) as e:
        project_stock.resolve_issue_project(db, "dispatch", payload)
    assert "delivery row" in str(getattr(e.value, "detail", e.value))

    # Sales order with a project but no rows / element → the element is mandatory.
    bare = NS(order_project_id=None, order_project_element_id=None, project_or_work_order=None, sales_order_id=env["so"]["id"],
              items=[NS(sales_schedule_id=None, order_project_element_id=None)])
    with pytest.raises(Exception) as e:
        project_stock.resolve_issue_project(db, "dispatch", bare)
    assert env["project"].project_code in str(getattr(e.value, "detail", e.value))


def test_grn_of_project_line_is_held_for_the_element_and_released_on_reversal(client, db, env):
    v2 = env["v2"]
    grn = P2PGoodsReceipt(grn_number="GRN-OPS-0001", purchase_order_id=999, store_location_id=env["loc"].id, status="completed",
                          received_date=date.today())
    db.add(grn)
    db.flush()
    line = P2PGoodsReceiptItem(goods_receipt_id=grn.id, po_item_id=999, store_item_id=env["item"].id, item_name="Hydraulic pump",
                               ordered_quantity=4, received_quantity=4, accepted_quantity=4, quality_status="accepted")
    line.order_project_element_id = v2.id
    db.add(line)
    db.commit()

    post_stock_transaction(db, item_id=env["item"].id, location_id=env["loc"].id, transaction_type="receipt", quantity=3,
                           reference_type="grn", reference_number="GRN-OPS-0001", created_by_id=env["manager"].id)
    db.commit()
    holds = db.query(StoreStockReservation).filter(StoreStockReservation.source_id == line.id).all()
    assert len(holds) == 1
    h = holds[0]
    assert h.order_project_element_id == v2.id and h.quantity == 3 and h.source_type == "grn_item"
    assert h.source_reference == "GRN-OPS-0001" and h.order_project_id == env["project"].id

    # A later release of the same line tops the hold up — never past the line's received quantity.
    post_stock_transaction(db, item_id=env["item"].id, location_id=env["loc"].id, transaction_type="receipt", quantity=3,
                           reference_type="grn", reference_number="GRN-OPS-0001", created_by_id=env["manager"].id)
    db.commit()
    db.expire_all()
    h = db.get(StoreStockReservation, h.id)
    assert h.quantity == 4 and h.original_qty == 4
    assert _balance(db, env).reserved_qty == 4

    # Reservations list: project stock filter.
    r = client.get(RES, params={"order_project_id": env["project"].id}, headers=hdr(env["keeper"]))
    assert [x["id"] for x in r.json()] == [h.id] and r.json()[0]["source_reference"] == "GRN-OPS-0001"
    r = client.get(RES, params={"project_stock": "false"}, headers=hdr(env["keeper"]))
    assert h.id not in [x["id"] for x in r.json()]

    # 360 store column.
    db.expire_all()
    project = db.get(PmProject, env["project"].id)
    so = db.get(SalesOrder, project.sales_order_id)
    cells = ops.department_cells(db, project, so, list(project.elements))
    assert cells[v2.id]["store"]["tone"] == "info" and cells[v2.id]["store"]["label"] == "1 item(s) held"
    assert cells[env["v1"].id]["store"] is None

    # GRN reversal takes its stock back out: the hold it made is released first.
    post_stock_transaction(db, item_id=env["item"].id, location_id=env["loc"].id, transaction_type="return_out", quantity=4,
                           reference_type="grn_reversal", reference_number="GRN-OPS-0001", created_by_id=env["manager"].id)
    db.commit()
    db.expire_all()
    assert db.get(StoreStockReservation, h.id).status == "cancelled"
    assert _balance(db, env).reserved_qty == 0


def test_store_cell_warns_when_build_material_is_not_held(client, db, env):
    from app.modules.production.models.work_order import ProductionWorkOrderMaterial
    v1 = env["v1"]
    build = _vehicle_build(db, env, v1, "RRV-2026-0902", status="in_progress")
    wo = ProductionWorkOrder(wo_number="WO-OPS-0002", product_item_id=env["item"].id, bom_id=1, quantity_planned=1,
                             status="released", rrv_build_id=build.id)
    wo.materials.append(ProductionWorkOrderMaterial(item_id=env["item"].id, required_qty=5))
    db.add(wo)
    db.commit()
    _reserve(client, env, v1, 2)
    db.expire_all()
    project = db.get(PmProject, env["project"].id)
    so = db.get(SalesOrder, project.sales_order_id)
    cell = ops.department_cells(db, project, so, list(project.elements))[v1.id]["store"]
    assert cell["tone"] == "warning" and cell["label"] == "Short: 1 item(s)" and "MT-OPS-0001" in cell["detail"]
    _reserve(client, env, v1, 3)
    db.expire_all()
    project = db.get(PmProject, env["project"].id)
    cell = ops.department_cells(db, project, so, list(project.elements))[v1.id]["store"]
    assert cell["tone"] == "info"


def test_form_standard_flags_project_types(client, db, env):
    r = client.get(f"{ISS}/form-standard", headers=hdr(env["keeper"]))
    std = r.json()
    assert std["production"]["order_project"] and std["dispatch"]["order_project"] and std["rework"]["order_project"]
    assert not std["scrap"]["order_project"] and not std["maintenance"]["order_project"]
    assert db.query(StoreMaterialIssue).count() == 0
