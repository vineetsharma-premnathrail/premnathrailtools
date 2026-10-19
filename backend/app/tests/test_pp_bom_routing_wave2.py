"""SAP PP wave 2: BOM validity / change number / item categories (CS01-02),
multi-level explosion + dependent work orders (CS11/CS12), ECN effectivity
into Production (CC01/ECM), discipline BOMs (CWBPP), routing control keys
(CA01), SO assignment + yield continuity (CO01 / CO11N), and gauge
calibration control (QM-IM)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.modules.accounts.models.vendor import Vendor
from app.modules.design.models.bom import DesignBom, DesignBomLine, DesignBomRevision
from app.modules.design.models.change_notice import DesignChangeNotice, DesignChangeNoticeBom
from app.modules.electrical.models.bom import ElectricalBomItem
from app.modules.electrical.models.job import ElectricalJob, ElectricalJobStage
from app.modules.hydraulic.models.bom import HydBom, HydBomItem
from app.modules.hydraulic.models.component import HydComponent
from app.modules.production import ecm, effectivity
from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.work_order import ProductionWorkOrder
from app.modules.quality.models.gauge import QualityGauge
from app.modules.quality.services import gauges as gauge_svc
from app.modules.sales.models.order import SalesOrder, SalesOrderLine
from app.modules.store.models.item import StoreItem
from app.modules.store.models.material_issue import StoreMaterialIssue
from app.modules.store.models.material_return import StoreMaterialReturn
from app.tests.test_cov_production_execution import (  # noqa: F401 — fixtures
    API, TODAY, _sqlite_document_numbers, auth, make_user, new_wo, s,
)

Q = "/api/v1/quality"
D = lambda n: str(date.today() + timedelta(days=n))  # noqa: E731


def _item(db, code, name, kind="raw_material", cost=10.0):
    it = StoreItem(item_code=code, item_name=name, item_type=kind, uom="NOS", standard_cost=cost, status="active")
    db.add(it)
    db.commit()
    return it


def _bom(client, h, product_id, items, ops=None, **extra):
    resp = client.post(f"{API}/boms", json={"product_item_id": product_id, "items": items, "operations": ops or [], **extra}, headers=h)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# CS01 item categories
# ---------------------------------------------------------------------------

def test_item_categories_text_and_non_stock(client, db, s):
    h = s["h"]
    product = _item(db, "FG-CAT-01", "Category product", "finished_good")
    bolt = _item(db, "NS-BLT-01", "Special bolt (bought for order)")
    bad = client.post(f"{API}/boms", json={"product_item_id": product.id, "items": [{"item_category": "text", "quantity": 1}]}, headers=h)
    assert bad.status_code == 400 and "text line" in bad.json()["detail"]
    bad = client.post(f"{API}/boms", json={"product_item_id": product.id, "items": [{"item_category": "stock", "quantity": 1}]}, headers=h)
    assert bad.status_code == 400 and "no component" in bad.json()["detail"]

    bom = _bom(client, h, product.id, [
        {"component_item_id": s["rod"].id, "quantity": 2},
        {"component_item_id": bolt.id, "quantity": 4, "item_category": "non_stock"},
        {"item_category": "text", "quantity": 1, "line_text": "Torque all M16 to 210 Nm"},
    ], [{"sequence": 10, "operation_name": "Assembly", "workstation_id": s["asm"]["id"]}])
    cats = sorted(i["item_category"] for i in bom["items"])
    assert cats == ["non_stock", "stock", "text"]
    assert client.post(f"{API}/boms/{bom['id']}/activate", headers=h).status_code == 200

    wo = client.post(f"{API}/work-orders", json={"bom_id": bom["id"], "quantity_planned": 1,
                                                  "source_location_id": s["raw"].id, "target_location_id": s["fg"].id}, headers=h).json()
    assert {m["item_category"] for m in wo["materials"]} == {"stock", "non_stock"} and len(wo["materials"]) == 2
    wo = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h).json()
    ns = next(m for m in wo["materials"] if m["item_category"] == "non_stock")
    assert ns["reserved_qty"] == 0 and wo["shortage_count"] == 0  # non-stock is never a Store shortage


# ---------------------------------------------------------------------------
# CS02 validity / scheduled versions
# ---------------------------------------------------------------------------

def test_future_valid_from_schedules_version_and_work_orders_pick_by_date(client, db, s):
    h, old = s["h"], s["bom"]
    draft = client.post(f"{API}/boms/{old['id']}/new-version", headers=h).json()
    r = client.patch(f"{API}/boms/{draft['id']}", json={"valid_from": D(10), "change_number": "ECN-TEST-1"}, headers=h)
    assert r.status_code == 200
    bad = client.patch(f"{API}/boms/{draft['id']}", json={"valid_to": D(5)}, headers=h)
    assert bad.status_code == 400 and "before 'Valid from'" in bad.json()["detail"]
    act = client.post(f"{API}/boms/{draft['id']}/activate", headers=h).json()
    assert act["status"] == "scheduled"
    cur = client.get(f"{API}/boms/{old['id']}", headers=h).json()
    assert cur["status"] == "active" and cur["valid_to"] == D(9)

    body = {"quantity_planned": 1, "source_location_id": s["raw"].id, "target_location_id": s["fg"].id}
    early = client.post(f"{API}/work-orders", json={**body, "bom_id": draft["id"]}, headers=h)
    assert early.status_code == 409 and "valid from" in early.json()["detail"] and old["bom_number"] in early.json()["detail"]
    late_old = client.post(f"{API}/work-orders", json={**body, "bom_id": old["id"], "planned_start_date": D(12)}, headers=h)
    assert late_old.status_code == 409 and "only valid until" in late_old.json()["detail"] and draft["bom_number"] in late_old.json()["detail"]
    ok = client.post(f"{API}/work-orders", json={**body, "bom_id": draft["id"], "planned_start_date": D(12)}, headers=h)
    assert ok.status_code == 200, ok.text

    # The day comes: the scheduled version takes over.
    assert effectivity.apply_due_effectivity(db, today=date.today() + timedelta(days=10)) == 1
    db.commit()
    db.expire_all()
    assert db.get(ProductionBom, draft["id"]).status == "active" and db.get(ProductionBom, old["id"]).status == "obsolete"


def test_serial_effectivity_keeps_old_version_for_earlier_machines():
    assert effectivity.serial_before("RRV-9", "RRV-10")
    assert not effectivity.serial_before("RRV-12", "RRV-10")
    assert not effectivity.serial_before(None, "RRV-10")


# ---------------------------------------------------------------------------
# CS11/CS12 explosion + dependent orders
# ---------------------------------------------------------------------------

def test_multi_level_explosion_and_dependent_work_orders(client, db, s):
    h = s["h"]
    machine = _item(db, "FG-MCH-01", "Machine", "finished_good")
    # The bogie frame (s["product"]) is a sub-assembly with its own active BOM.
    top = _bom(client, h, machine.id, [{"component_item_id": s["product"].id, "quantity": 2}, {"component_item_id": s["paint"].id, "quantity": 1}],
               [{"sequence": 10, "operation_name": "Final assembly", "workstation_id": s["asm"]["id"]}])
    assert client.post(f"{API}/boms/{top['id']}/activate", headers=h).status_code == 200
    assert next(i for i in client.get(f"{API}/boms/{top['id']}", headers=h).json()["items"] if i["component_item_id"] == s["product"].id)["has_bom"]

    ex = client.get(f"{API}/boms/{top['id']}/explosion", params={"qty": 3}, headers=h).json()
    by_path = {r["path"]: r for r in ex["rows"]}
    assert ex["max_level"] == 2
    assert by_path["1"]["total_quantity"] == 6 and by_path["1"]["has_bom"] is True
    rods = next(r for r in ex["rows"] if r["level"] == 2 and r["item_id"] == s["rod"].id)
    assert rods["total_quantity"] == 12 and rods["path"].startswith("1.")
    # cost from leaves only: 6 frames×1000 + 12 rods×100 + 3 primer×10
    assert ex["total_material_cost"] == 6 * 1000 + 12 * 100 + 3 * 10

    wo = client.post(f"{API}/work-orders", json={"bom_id": top["id"], "quantity_planned": 3, "planned_start_date": D(20),
                                                  "source_location_id": s["raw"].id, "target_location_id": s["fg"].id}, headers=h).json()
    deps = client.post(f"{API}/work-orders/{wo['id']}/sub-orders", json={}, headers=h)
    assert deps.status_code == 200, deps.text
    deps = deps.json()
    assert len(deps) == 1 and deps[0]["quantity_planned"] == 6 and deps[0]["level"] == 1
    child = client.get(f"{API}/work-orders/{deps[0]['id']}", headers=h).json()
    assert child["parent_wo_number"] == wo["wo_number"] and child["planned_end_date"] == D(19) and child["status"] == "draft"
    again = client.post(f"{API}/work-orders/{wo['id']}/sub-orders", json={}, headers=h).json()
    assert [d["id"] for d in again] == [d["id"] for d in deps]  # idempotent
    assert client.get(f"{API}/work-orders/{wo['id']}", headers=h).json()["child_count"] == 1

    leaf = new_wo(client, s, qty=1, release=False)
    none = client.post(f"{API}/work-orders/{leaf['id']}/sub-orders", json={}, headers=h)
    assert none.status_code == 409 and "no sub-assemblies" in none.json()["detail"]


# ---------------------------------------------------------------------------
# CC01 / ECM
# ---------------------------------------------------------------------------

def test_implemented_ecn_creates_effective_draft_and_flags_open_orders(client, db, s):
    h, user = s["h"], s["user"]
    product = s["product"]
    dbom = DesignBom(bom_number="DBOM-ECM-1", product_item_id=product.id, title="Frame", status="active")
    db.add(dbom)
    db.flush()
    rev0 = DesignBomRevision(bom_id=dbom.id, revision_index=0, revision_label="B0", status="superseded")
    db.add(rev0)
    ecn = DesignChangeNotice(ecn_number="ECN-2026-0007", title="Stronger tie rods", status="approved",
                             effectivity_type="date", effectivity_date=date.today() + timedelta(days=7), wip_disposition="rework")
    db.add(ecn)
    db.flush()
    rev1 = DesignBomRevision(bom_id=dbom.id, revision_index=1, revision_label="B1", status="released", ecn_id=ecn.id,
                             released_at=datetime.now(timezone.utc))
    db.add(rev1)
    db.flush()
    db.add_all([DesignBomLine(revision_id=rev1.id, position=10, store_item_id=s["frame"].id, quantity=1, make_buy="make"),
                DesignBomLine(revision_id=rev1.id, position=20, store_item_id=s["rod"].id, quantity=3, make_buy="buy"),
                DesignChangeNoticeBom(ecn_id=ecn.id, bom_id=dbom.id)])
    db.commit()

    open_wo = new_wo(client, s, qty=1)
    db.refresh(ecn)
    notes = ecm.on_ecn_implemented(db, ecn, user)
    db.commit()
    assert notes and "draft" in notes[0] and "1 open work order(s) flagged" in notes[0]

    mbom = db.query(ProductionBom).filter(ProductionBom.ecn_id == ecn.id).one()
    assert mbom.status == "draft" and mbom.change_number == "ECN-2026-0007" and mbom.valid_from == ecn.effectivity_date
    assert [o.operation_name for o in mbom.operations] == ["Cutting", "Assembly"]  # routing kept
    wo = client.get(f"{API}/work-orders/{open_wo['id']}", headers=h).json()
    assert wo["change_flag"] and "ECN-2026-0007" in wo["change_flag"] and "rework" in wo["change_flag"]

    aff = client.get(f"{API}/ecm/change-notices/{ecn.id}/affected-orders", headers=h).json()
    assert aff["orders"][0]["flagged"] and aff["production_boms"][0]["bom_number"] == mbom.bom_number

    short = client.post(f"{API}/work-orders/{open_wo['id']}/clear-change-flag", json={"resolution": ""}, headers=h)
    assert short.status_code == 422
    cleared = client.post(f"{API}/work-orders/{open_wo['id']}/clear-change-flag", json={"resolution": "Old rods used up; no rework"}, headers=h)
    assert cleared.status_code == 200 and cleared.json()["change_flag_resolution"] == "Old rods used up; no rework"

    # Activation honours the ECN date: scheduled, current version runs until the day before.
    act = client.post(f"{API}/boms/{mbom.id}/activate", headers=h).json()
    assert act["status"] == "scheduled" and act["ecn_number"] == "ECN-2026-0007"


# ---------------------------------------------------------------------------
# CWBPP discipline BOMs
# ---------------------------------------------------------------------------

def test_hydraulic_and_electrical_boms_merge_with_source_tag(client, db, s):
    h = s["h"]
    pump_item = _item(db, "HY-PMP-01", "Gear pump", cost=5000)
    cable_item = _item(db, "EL-CBL-01", "Cable 4 sq mm", cost=50)
    pump = HydComponent(code="PMP-001", name="Gear pump 20cc", category="pump", store_item_id=pump_item.id)
    valve = HydComponent(code="VLV-001", name="Relief valve", category="valve")  # not linked to Store yet
    db.add_all([pump, valve])
    db.flush()
    hbom = HydBom(bom_number="HB-2026-0001", revision="A", title="Lifting circuit", status="draft")
    db.add(hbom)
    db.flush()
    db.add_all([HydBomItem(bom_id=hbom.id, component_id=pump.id, tag_number="P1", quantity=1),
                HydBomItem(bom_id=hbom.id, component_id=valve.id, tag_number="V1", quantity=1)])
    job = ElectricalJob(job_number="ELJ-2026-0003", title="RRV electrics", status="in_progress")
    db.add(job)
    db.flush()
    stage = ElectricalJobStage(job_id=job.id, stage_key="electrical_bom", sequence=5, status="in_progress")
    db.add_all([stage, ElectricalBomItem(job_id=job.id, line_no=1, description="Cable", store_item_id=cable_item.id, quantity=20),
                ElectricalBomItem(job_id=job.id, line_no=2, description="Cable spare", store_item_id=cable_item.id, quantity=5)])
    db.commit()

    draft = client.post(f"{API}/boms/{s['bom']['id']}/new-version", headers=h).json()
    url = f"{API}/boms/{draft['id']}/merge-discipline"
    r = client.post(url, json={"source_type": "hydraulic", "source_id": hbom.id}, headers=h)
    assert r.status_code == 409 and "released" in r.json()["detail"]
    hbom.status = "released"
    db.commit()
    r = client.post(url, json={"source_type": "hydraulic", "source_id": hbom.id}, headers=h)
    assert r.status_code == 409 and "VLV-001" in r.json()["detail"] and "Item Master" in r.json()["detail"]
    valve.store_item_id = s["rod"].id  # mapped onto an item already on the BOM → quantities add up
    db.commit()
    r = client.post(url, json={"source_type": "hydraulic", "source_id": hbom.id}, headers=h)
    assert r.status_code == 200, r.text
    lines = {i["component_item_id"]: i for i in r.json()["items"]}
    assert lines[pump_item.id]["source_tag"] == "HYD HB-2026-0001 rev A" and lines[s["rod"].id]["quantity"] == 3
    # merging again doesn't double count
    r = client.post(url, json={"source_type": "hydraulic", "source_id": hbom.id}, headers=h).json()
    assert {i["component_item_id"]: i["quantity"] for i in r["items"]}[s["rod"].id] == 3

    e = client.post(url, json={"source_type": "electrical", "source_id": job.id}, headers=h)
    assert e.status_code == 409 and "Electrical BOM stage" in e.json()["detail"]
    stage.status = "completed"
    db.commit()
    e = client.post(url, json={"source_type": "electrical", "source_id": job.id}, headers=h).json()
    assert {i["component_item_id"]: i["quantity"] for i in e["items"]}[cable_item.id] == 25
    assert {m["source_label"] for m in e["discipline_merges"]} == {"HYD HB-2026-0001 rev A", "ELEC ELJ-2026-0003"}
    sources = client.get(f"{API}/boms/discipline-sources/list", headers=h).json()
    assert {x["label"] for x in sources if x["mergeable"]} >= {"HYD HB-2026-0001 rev A", "ELEC ELJ-2026-0003"}

    # A new version keeps the merge record; removing the merge takes the parts out.
    hyd = next(m for m in e["discipline_merges"] if m["source_type"] == "hydraulic")
    out = client.delete(f"{API}/boms/{draft['id']}/discipline-merges/{hyd['id']}", headers=h).json()
    qty = {i["component_item_id"]: i["quantity"] for i in out["items"]}
    assert pump_item.id not in qty and qty[s["rod"].id] == 2


# ---------------------------------------------------------------------------
# CA01 control keys + CO11N yield + CO01 SO assignment
# ---------------------------------------------------------------------------

def test_external_operation_needs_vendor_challan_and_return(client, db, s):
    h = s["h"]
    vendor = Vendor(code="V-JW-01", name="Precision Plating", status="active")
    db.add(vendor)
    db.commit()
    product = _item(db, "FG-PLT-01", "Plated pin", "finished_good")
    body_ops = [{"sequence": 10, "operation_name": "Turning", "workstation_id": s["cut"]["id"], "confirmation": "required"},
                {"sequence": 20, "operation_name": "Zinc plating", "control_key": "external"}]
    bad = client.post(f"{API}/boms", json={"product_item_id": product.id, "items": [{"component_item_id": s["rod"].id, "quantity": 1}],
                                            "operations": body_ops}, headers=h)
    assert bad.status_code == 400 and "job-work vendor" in bad.json()["detail"]
    body_ops[1]["vendor_id"] = vendor.id
    body_ops[1]["print_on_job_card"] = False
    bom = _bom(client, h, product.id, [{"component_item_id": s["rod"].id, "quantity": 1}], body_ops)
    assert client.post(f"{API}/boms/{bom['id']}/activate", headers=h).status_code == 200
    wo = client.post(f"{API}/work-orders", json={"bom_id": bom["id"], "quantity_planned": 2, "source_location_id": s["raw"].id,
                                                  "target_location_id": s["fg"].id}, headers=h).json()
    wo = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h).json()
    turn, plate = wo["operations"]
    assert plate["control_key"] == "external" and plate["vendor_name"] == "Precision Plating"

    # confirmation required: no completion without yield (unless a reason is given)
    r = client.post(f"{API}/work-orders/{wo['id']}/operations/{turn['id']}/complete", json={}, headers=h)
    assert r.status_code == 409 and "yield confirmation" in r.json()["detail"]
    log = client.post(f"{API}/time-logs", json={"work_order_id": wo["id"], "operation_id": turn["id"], "log_date": TODAY, "hours": 1, "qty_good": 1}, headers=h)
    assert log.status_code == 200, log.text
    # yield continuity: plating can't confirm more than turning produced
    assert client.post(f"{API}/work-orders/{wo['id']}/operations/{turn['id']}/complete", json={}, headers=h).status_code == 200

    start = client.post(f"{API}/work-orders/{wo['id']}/operations/{plate['id']}/start", headers=h)
    assert start.status_code == 409 and "Job Work challan" in start.json()["detail"]
    issue = StoreMaterialIssue(issue_number="MI-JW-0001", location_id=s["raw"].id, issue_type="job_work", vendor_id=vendor.id,
                               vendor_name=vendor.name, issue_date=date.today())
    general = StoreMaterialIssue(issue_number="MI-GEN-0001", location_id=s["raw"].id, issue_type="general", issue_date=date.today())
    db.add_all([issue, general])
    db.commit()
    wrong = client.post(f"{API}/work-orders/{wo['id']}/operations/{plate['id']}/job-work", json={"issue_id": general.id}, headers=h)
    assert wrong.status_code == 400 and "not a job-work challan" in wrong.json()["detail"]
    linked = client.post(f"{API}/work-orders/{wo['id']}/operations/{plate['id']}/job-work", json={"issue_id": issue.id}, headers=h).json()
    assert next(o for o in linked["operations"] if o["id"] == plate["id"])["job_work_issue_number"] == "MI-JW-0001"
    assert client.post(f"{API}/work-orders/{wo['id']}/operations/{plate['id']}/start", headers=h).status_code == 200
    over = client.post(f"{API}/time-logs", json={"work_order_id": wo["id"], "operation_id": plate["id"], "log_date": TODAY, "hours": 1, "qty_good": 2}, headers=h)
    assert over.status_code == 409 and "can't have more good units than the step before it" in over.json()["detail"]
    pending = client.post(f"{API}/work-orders/{wo['id']}/operations/{plate['id']}/complete", json={}, headers=h)
    assert pending.status_code == 409 and "still at the job-work vendor" in pending.json()["detail"]
    db.add(StoreMaterialReturn(return_number="MR-JW-0001", location_id=s["raw"].id, source_issue_id=issue.id, status="approved",
                               return_date=date.today()))
    db.commit()
    done = client.post(f"{API}/work-orders/{wo['id']}/operations/{plate['id']}/complete", json={}, headers=h)
    assert done.status_code == 200, done.text

    # print flag: the external step isn't on the traveller
    card = client.get(f"{API}/work-orders/{wo['id']}/job-card", headers=h)
    assert card.status_code in (200, 403)


def test_sales_order_assignment_on_work_order(client, db, s):
    h = s["h"]
    so = SalesOrder(so_number="SO-2026-0901", status="confirmed", customer_id=1, customer_name="Central Railway")
    other = SalesOrder(so_number="SO-2026-0902", status="draft", customer_id=1)
    db.add_all([so, other])
    db.flush()
    line = SalesOrderLine(so_id=so.id, line_number=1, line_type="rrv", product_item_id=s["product"].id, description="Frame", quantity=2)
    oline = SalesOrderLine(so_id=other.id, line_number=1, line_type="rrv", description="x", quantity=1)
    db.add_all([line, oline])
    db.commit()
    base = {"bom_id": s["bom"]["id"], "quantity_planned": 1}
    mismatch = client.post(f"{API}/work-orders", json={**base, "sales_order_id": so.id, "sales_order_line_id": oline.id}, headers=h)
    assert mismatch.status_code == 400 and "different sales order" in mismatch.json()["detail"]
    draft = client.post(f"{API}/work-orders", json={**base, "sales_order_id": other.id}, headers=h)
    assert draft.status_code == 409 and "draft" in draft.json()["detail"]
    ok = client.post(f"{API}/work-orders", json={**base, "sales_order_line_id": line.id}, headers=h)
    assert ok.status_code == 200, ok.text
    assert ok.json()["sales_order_id"] == so.id and "SO-2026-0901" in ok.json()["sales_order_label"] and "line 1" in ok.json()["sales_order_label"]


# ---------------------------------------------------------------------------
# QM-IM gauges
# ---------------------------------------------------------------------------

def test_gauge_register_calibration_and_usability(client, db, s):
    head = make_user(db, "gauge.head@premnathrail.com", apps=("quality",), grants=["quality:masters:view", "quality:masters:create", "quality:masters:edit"])
    hh = auth(head)
    r = client.post(f"{Q}/gauges", json={"code": "vc-001", "name": "Vernier caliper 0-150", "gauge_type": "Vernier caliper",
                                        "calibration_interval_days": 180}, headers=hh)
    assert r.status_code == 201, r.text
    g = r.json()
    assert g["code"] == "VC-001" and g["calibration_state"] == "never_calibrated" and not g["usable"]
    dup = client.post(f"{Q}/gauges", json={"code": "VC-001", "name": "x"}, headers=hh)
    assert dup.status_code == 409

    cal = client.post(f"{Q}/gauges/{g['id']}/calibrations", json={"calibrated_on": TODAY, "result": "pass", "certificate_ref": "NABL/123"}, headers=hh).json()
    assert cal["usable"] and cal["next_due_on"] == D(180) and cal["certificate_ref"] == "NABL/123"
    fail = client.post(f"{Q}/gauges/{g['id']}/calibrations", json={"calibrated_on": TODAY, "result": "fail"}, headers=hh).json()
    assert fail["status"] == "out_of_calibration" and "out of calibration" in fail["blocked_reason"]
    back = client.patch(f"{Q}/gauges/{g['id']}", json={"status": "active"}, headers=hh)
    assert back.status_code == 409

    gauge = db.get(QualityGauge, g["id"])
    gauge.status, gauge.next_due_on = "active", date.today() - timedelta(days=3)
    db.commit()
    problem = gauge_svc.usable_problem(gauge)
    assert "overdue" in problem and "VC-001" in problem
    with pytest.raises(gauge_svc.GaugeError):
        gauge_svc.check_usable(db, gauge.id)
    assert [x.code for x in gauge_svc.due_soon(db, 15)] == ["VC-001"]

    from app.tasks.gauge_calibration_reminders import send_gauge_reminders_db
    gauge.custodian_id = head.id
    db.commit()
    assert send_gauge_reminders_db(db) == 1
    assert send_gauge_reminders_db(db) == 0  # once per day

    listed = client.get(f"{Q}/gauges", params={"usable_only": True}, headers=hh).json()
    assert listed == []
