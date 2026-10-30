"""Production review fixes: finished goods received through a Quality
final-inspection lot, workstation vs Maintenance, RRV build guards on work
orders / rework, and the RRV Builds tab permission on detail endpoints."""
from datetime import date, datetime, timezone

from app.modules.erp.models.project import Project
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.organization.models.branch import Branch
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.production.models.work_order import ProductionWorkOrder
from app.tests.test_rrv_builds import (  # noqa: F401  (fixtures + helpers)
    API, TODAY, _sqlite_numbers, plant, new_build, raise_wo, make_user, auth,
)


def _plain_wo(client, p, bom):
    r = client.post(f"{API}/work-orders", json={
        "bom_id": bom["id"], "quantity_planned": 1, "source_location_id": p["raw"].id, "target_location_id": p["fg"].id,
    }, headers=p["h"])
    assert r.status_code == 200, r.text
    return r.json()


def test_output_through_final_inspection_lot_is_reported(client, db, plant):
    p, h = plant, plant["h"]
    p["bogie"].inspection_on_receipt = True
    db.commit()
    wo = _plain_wo(client, p, p["bogie_bom"])
    wo = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h).json()
    lines = [{"item_id": m["item_id"], "quantity": m["required_qty"]} for m in wo["materials"]]
    assert client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": lines}, headers=h).status_code == 200
    op = wo["operations"][0]
    client.post(f"{API}/time-logs", json={"work_order_id": wo["id"], "operation_id": op["id"], "log_date": str(TODAY), "hours": 8, "qty_good": 1}, headers=h)
    assert client.post(f"{API}/work-orders/{wo['id']}/operations/{op['id']}/complete", json={}, headers=h).status_code == 200
    r = client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1, "batch_number": "SN-1"}, headers=h)
    assert r.status_code == 200, r.text

    moves = client.get(f"{API}/work-orders/{wo['id']}/stock-movements", headers=h).json()
    types = {m["transaction_type"] for m in moves}
    assert "quality_in" in types and "issue" in types
    assert next(m for m in moves if m["transaction_type"] == "quality_in")["quantity"] == 1

    kpis = client.get(f"{API}/dashboard", headers=h).json()["kpis"]
    assert kpis["output_30d"] >= 1
    report = client.get(f"{API}/reports", headers=h).json()
    row = next(o for o in report["output"] if o["item_id"] == p["bogie"].id)
    assert row["quantity"] == 1 and row["work_orders"] == 1


def test_workstation_blocked_by_maintenance_and_null_fields(client, db, plant):
    h = plant["h"]
    ws = client.get(f"{API}/workstations", headers=h).json()[0]
    r = client.patch(f"{API}/workstations/{ws['id']}", json={"name": None, "hourly_rate": None}, headers=h)
    assert r.status_code == 400 and "Name" in r.json()["detail"] and "Hourly rate" in r.json()["detail"]

    branch = Branch(name="Faridabad Plant", code="FBD")
    db.add(branch)
    db.commit()
    asset = MaintenanceAsset(asset_code="EQ-ASM-01", name="Assembly crane", branch_id=branch.id, workstation_id=ws["id"], status="breakdown")
    db.add(asset)
    db.commit()
    client.patch(f"{API}/workstations/{ws['id']}", json={"status": "under_maintenance"}, headers=h)
    r = client.patch(f"{API}/workstations/{ws['id']}", json={"status": "active"}, headers=h)
    assert r.status_code == 409 and "EQ-ASM-01" in r.json()["detail"] and "breakdown" in r.json()["detail"]

    asset.status = "operational"
    db.commit()
    assert client.patch(f"{API}/workstations/{ws['id']}", json={"status": "active"}, headers=h).json()["status"] == "active"


def test_wo_edit_keeps_build_machine_and_priority(client, db, plant):
    h = plant["h"]
    m1, m2 = Project(serial_number="PR-RRV-2026-101", machine_type="RRV"), Project(serial_number="PR-RRV-2026-102", machine_type="RRV")
    db.add_all([m1, m2])
    db.commit()
    b = new_build(client, plant, erp_project_id=m1.id)
    wo = raise_wo(client, plant, b, plant["bogie_bom"], "sub_assembly")
    r = client.patch(f"{API}/work-orders/{wo['id']}", json={"erp_project_id": m2.id}, headers=h)
    assert r.status_code == 409 and b["build_number"] in r.json()["detail"] and "PR-RRV-2026-101" in r.json()["detail"]
    r = client.patch(f"{API}/work-orders/{wo['id']}", json={"priority": None}, headers=h)
    assert r.status_code == 400 and "Priority" in r.json()["detail"]
    assert client.patch(f"{API}/work-orders/{wo['id']}", json={"priority": "urgent"}, headers=h).json()["priority"] == "urgent"


def test_draft_wo_on_closed_build(client, db, plant):
    h, hm = plant["h"], plant["hm"]
    b = new_build(client, plant)
    wo = raise_wo(client, plant, b, plant["bogie_bom"], "sub_assembly")
    r = client.post(f"{API}/rrv-builds/{b['id']}/cancel", json={"reason": "Order lost"}, headers=hm)
    assert r.status_code == 409 and wo["wo_number"] in r.json()["detail"]

    # A build closed before this guard existed may still hold a draft WO.
    db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == b["id"]).update({"status": "cancelled"})
    db.commit()
    r = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h)
    assert r.status_code == 409 and "cancelled" in r.json()["detail"]
    assert db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == wo["id"]).first().status == "draft"


def test_rework_guards_on_delete_cancel_and_list(client, db, plant):
    h, hm = plant["h"], plant["hm"]
    b = new_build(client, plant)
    r = client.post(f"{API}/rrv-builds/{b['id']}/rework", json={"title": "Fix weld spatter"}, headers=h)
    assert r.status_code == 201, r.text
    rw = r.json()["rework_orders"][0]
    r = client.delete(f"{API}/rrv-builds/{b['id']}", headers=h)
    assert r.status_code == 409 and "rework" in r.json()["detail"]

    # Open rework blocks cancelling the build, naming the rework order.
    r = client.post(f"{API}/rrv-builds/{b['id']}/cancel", json={"reason": "Order lost"}, headers=hm)
    assert r.status_code == 409 and rw["rework_number"] in r.json()["detail"]

    # A build cancelled before that guard existed may still hold open rework — it can still be closed out.
    db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == b["id"]).update({"status": "cancelled"})
    db.commit()
    r = client.post(f"{API}/rrv-builds/rework/{rw['id']}/start", headers=h)
    assert r.status_code == 409 and "cancelled" in r.json()["detail"]
    r = client.post(f"{API}/rrv-builds/rework/{rw['id']}/cancel", json={"reason": "No longer needed"}, headers=hm)
    assert r.status_code == 200, r.text
    assert next(x for x in r.json()["rework_orders"] if x["id"] == rw["id"])["status"] == "cancelled"

    # Once the rework is closed, a build can be cancelled normally.
    nb = new_build(client, plant, rrv_model="Second")
    nrw = client.post(f"{API}/rrv-builds/{nb['id']}/rework", json={"title": "Paint touch-up"}, headers=h).json()["rework_orders"][0]
    assert client.post(f"{API}/rrv-builds/rework/{nrw['id']}/cancel", json={"reason": "Not needed"}, headers=hm).status_code == 200
    assert client.post(f"{API}/rrv-builds/{nb['id']}/cancel", json={"reason": "Order lost"}, headers=hm).json()["status"] == "cancelled"

    other = new_build(client, plant, rrv_model="Orphan")
    client.post(f"{API}/rrv-builds/{other['id']}/rework", json={"title": "Orphaned rework"}, headers=h)
    db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == other["id"]).update({"is_deleted": True, "deleted_at": datetime.now(timezone.utc)})
    db.commit()
    titles = [x["title"] for x in client.get(f"{API}/rrv-builds/rework", headers=h).json()]
    assert "Fix weld spatter" in titles and "Orphaned rework" not in titles


def test_build_detail_needs_rrv_builds_tab(client, db, plant, monkeypatch):
    b = new_build(client, plant)
    monkeypatch.setattr("app.core.permissions.can_view_tab", lambda user, module, tab: tab != "rrv_builds")
    assert client.get(f"{API}/rrv-builds/{b['id']}", headers=plant["h"]).status_code == 403
    assert client.get(f"{API}/rrv-builds/{b['id']}/material-consumption", headers=plant["h"]).status_code == 403
