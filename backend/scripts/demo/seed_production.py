"""Production: workstations, production BOMs + routings, work orders at every stage, in-process QC gate lots, RRV builds with tests, rework and machine registration.

Acts as the real people: the Production Manager owns workstations, BOM
activation, work-order release / completion / closure and RRV sign-offs;
the Shop Floor Supervisor raises BOMs and work orders, issues material,
books time, runs operations and requests QC gates; the Quality Inspector
records gate results and the Quality Manager makes the usage decision; the
Store Keeper creates the finished-good / sub-assembly items in the item
master. Everything goes through the API, so numbering (BOM-/WO-/RRV-),
reservations, stock issues/receipts, gate lots and approvals are real.

What a demo user sees afterwards:
  * 8 workstations (one under maintenance).
  * BOMs for 3 RRV sub-assemblies and 5 finished machines (RRV-8W, RGM-16,
    TIC-01, HRE-150, CW-BOX); the chassis BOM also has a v2 draft. When the
    Design seeder left a released design BOM for a product's store item,
    its lines are used for the production BOM.
  * Work orders: completed + closed (TIC-01, HRE-150 — finished machines
    received into stock under their serial numbers), in progress waiting
    for Quality's in-process gate lot (HRE-150), released with material
    shortages (RGM-16), draft and overdue (TIC-01), release waiting for
    approval (CW-BOX — parked for you), cancelled (CW-BOX).
  * RRV builds: handed over (all 12 stages, failed rail-brake test →
    rework → retest → verified, final inspection passed, machine registered
    in ERP), in progress (sub-assemblies done, main assembly overdue, tyres
    short), planned, on hold.
  * Sales-order links: work orders / builds name the sales order and the
    customer from `demo.data["sales_orders"]` when the Sales seeder ran
    (matched on the order line's store item / RRV model); otherwise the
    foundation customer is used and the run says so.

Dispatch is not done here: it is a Store material issue of type "dispatch"
against the ERP machine (Store owns it), so the handed-over vehicle stays in
FG stock until the Store / ERP seeders dispatch it.

demo.data keys set here:
  workstations       dict code -> workstation dict.
  production_items   dict key -> store item dict for what Production makes
                     (product codes DEMO-RRV-8W … and sub-assemblies
                     "SA-CHASSIS", "SA-BOGIE", "SA-HPU").
  production_boms    dict key (same keys) -> active BOM dict.
  work_orders        dict key -> latest work order dict. Keys: tic_done,
                     hre_done, hre_qc_gate, rgm_released, tic_draft_overdue,
                     cw_pending_release, cw_cancelled, rrv1_chassis,
                     rrv1_bogie, rrv1_hpu, rrv1_main, rrv2_chassis,
                     rrv2_bogie, rrv2_hpu, rrv2_main, rrv3_main.
  rrv_builds         dict key -> build detail dict: handed_over, in_progress,
                     planned, on_hold.
  finished_machines  list of {"product_code", "serial_no", "work_order_id",
                     "work_order_number", "erp_project_id" (RRV only, the
                     machine registered at RRV Completion), "rrv_build_id",
                     "customer", "sales_order"} — the ERP / Service seeder
                     uses the serial numbers.
"""
from __future__ import annotations

import math
from datetime import timedelta

from demo._common import LABEL

# ── Masters ───────────────────────────────────────────────────────────────

# code, name, type, capacity h/day, rate ₹/h, status, description
WORKSTATIONS = [
    ("DEMO-WS-CUT", f"{LABEL} CNC Plasma Cutting Table 3x12 m", "machine", 16, 1400, "active", "Plate & profile cutting for chassis and frames."),
    ("DEMO-WS-WLD", f"{LABEL} Chassis Welding Bay (MIG)", "work_center", 16, 950, "active", "Fixture welding of RRV chassis and machine frames."),
    ("DEMO-WS-MCH", f"{LABEL} VMC Machining Centre", "machine", 16, 1600, "active", "Axles, pads, cylinder bores."),
    ("DEMO-WS-ASM1", f"{LABEL} Assembly Bay 1 – RRV Line", "assembly_bay", 8, 850, "active", "RRV main assembly with 10 t EOT crane."),
    ("DEMO-WS-ASM2", f"{LABEL} Assembly Bay 2 – Track Machines", "assembly_bay", 8, 850, "active", "Grinding, inspection and re-railing equipment."),
    ("DEMO-WS-HYD", f"{LABEL} Hydraulic & Function Test Bench", "test_bench", 8, 1100, "active", "Pressure testing up to 700 bar, function checks."),
    ("DEMO-WS-PNT", f"{LABEL} Paint Booth (PU, RAL 1003)", "paint_booth", 8, 700, "active", "Blasting-free PU top coat booth."),
    ("DEMO-WS-BLAST", f"{LABEL} Shot Blasting Machine", "machine", 8, 900, "under_maintenance", "Down for impeller replacement — routings avoid it."),
]

# Store items Production makes: key -> (item code, name, hsn, standard cost, serial-numbered?)
MADE_ITEMS = {
    "DEMO-RRV-8W": ("DEMO-FG-RRV-8W", f"{LABEL} Rail-cum-Road Vehicle 8-wheel (finished machine)", "8714", 9_200_000, True),
    "DEMO-RGM-16": ("DEMO-FG-RGM-16", f"{LABEL} Rail Grinding Machine 16-stone (finished machine)", "8460", 14_500_000, True),
    "DEMO-TIC-01": ("DEMO-FG-TIC-01", f"{LABEL} Track Inspection Car (finished machine)", "8606", 6_800_000, True),
    "DEMO-HRE-150": ("DEMO-FG-HRE-150", f"{LABEL} Hydraulic Re-railing Equipment 150 t (finished set)", "8425", 2_400_000, True),
    "DEMO-CW-BOX": ("DEMO-FG-CW-BOX", f"{LABEL} Carriage Wagon – material (finished)", "8606", 1_900_000, False),
    "SA-CHASSIS": ("DEMO-SA-CHASSIS-RRV8W", f"{LABEL} Welded Chassis Frame – RRV 8W", "8708", 420_000, False),
    "SA-BOGIE": ("DEMO-SA-GUIDE-BOGIE", f"{LABEL} Rail Guide-Wheel Bogie Assembly", "8607", 260_000, False),
    "SA-HPU": ("DEMO-SA-HPU-28CC", f"{LABEL} Hydraulic Power Unit 28 cc/rev", "8413", 120_000, False),
}

# BOM components: key -> [(item code or MADE_ITEMS key, qty per unit, scrap %, remark)]
COMPONENTS = {
    "SA-CHASSIS": [("DEMO-RM-MS-PLATE-10", 600, 5, "Long members, cross members, gussets"), ("DEMO-RM-ISMC-100", 250, 3, "Outriggers"),
                   ("DEMO-RM-RHS-80X40", 18, 0, "Cab & panel supports"), ("DEMO-CN-ELECTRODE-7018", 15, 0, None),
                   ("DEMO-CN-GRIND-DISC-4", 12, 0, None), ("DEMO-HWF-BOLT-M16X60", 80, 0, None), ("DEMO-PNT-PU-RAL1003", 10, 0, "Primer + top coat")],
    "SA-BOGIE": [("DEMO-MEC-WHEEL-430", 2, 0, "Matched pair, profile per RDSO"), ("DEMO-MEC-BRG-22216", 4, 0, None),
                 ("DEMO-RM-EN8-RD-60", 60, 4, "Axle stock"), ("DEMO-HYD-SEAL-KIT-63", 1, 0, "Deployment cylinder"), ("DEMO-HWF-BOLT-M16X60", 24, 0, None)],
    "SA-HPU": [("DEMO-HYD-PUMP-GP28", 1, 0, None), ("DEMO-HYD-DCV-43", 2, 0, "Guide-wheel up/down + spare circuit"),
               ("DEMO-HYD-HOSE-12", 10, 5, None), ("DEMO-HYD-OIL-68", 60, 0, "First fill")],
    "DEMO-RRV-8W": [("SA-CHASSIS", 1, 0, None), ("SA-BOGIE", 2, 0, "Front + rear"), ("SA-HPU", 1, 0, None),
                    ("DEMO-MEC-ENGINE-74KW", 1, 0, None), ("DEMO-MEC-TYRE-1000R20", 4, 0, None), ("DEMO-ELE-BATT-12V100", 2, 0, "24 V bank"),
                    ("DEMO-ELE-CABLE-4C25", 60, 5, None), ("DEMO-ELE-RELAY-24V", 12, 0, None), ("DEMO-ELE-PROX-M18", 8, 0, "Guide-wheel position"),
                    ("DEMO-HYD-OIL-68", 40, 0, None), ("DEMO-HWF-BOLT-M16X60", 150, 0, None), ("DEMO-PNT-PU-RAL1003", 15, 0, None)],
    "DEMO-RGM-16": [("DEMO-RM-MS-PLATE-10", 400, 5, None), ("DEMO-RM-ISMC-100", 200, 3, None), ("DEMO-MEC-ENGINE-74KW", 1, 0, None),
                    ("DEMO-HYD-PUMP-GP28", 2, 0, "Stone carriage circuits"), ("DEMO-HYD-DCV-43", 2, 0, None), ("DEMO-HYD-HOSE-12", 30, 5, None),
                    ("DEMO-ELE-PLC-CPU", 1, 0, None), ("DEMO-ELE-PROX-M18", 12, 0, None), ("DEMO-ELE-CABLE-4C25", 120, 5, None),
                    ("DEMO-HWF-BOLT-M16X60", 300, 0, None), ("DEMO-PNT-PU-RAL1003", 20, 0, None)],
    "DEMO-TIC-01": [("DEMO-RM-RHS-80X40", 40, 3, "Body frame"), ("DEMO-ELE-CABLE-4C25", 200, 5, None), ("DEMO-ELE-PROX-M18", 10, 0, "Gauge / twist sensors"),
                    ("DEMO-ELE-BATT-12V100", 2, 0, None), ("DEMO-ELE-RELAY-24V", 20, 0, None), ("DEMO-HWF-BOLT-M16X60", 120, 0, None)],
    "DEMO-HRE-150": [("DEMO-HYD-SEAL-KIT-63", 4, 0, "Lifting + traverse rams"), ("DEMO-HYD-HOSE-12", 20, 5, None), ("DEMO-HYD-DCV-43", 1, 0, None),
                     ("DEMO-HYD-PUMP-GP28", 1, 0, None), ("DEMO-HYD-OIL-68", 40, 0, None), ("DEMO-RM-MS-PLATE-10", 120, 5, "Bridge & base plates"),
                     ("DEMO-RM-EN8-RD-60", 30, 4, "Ram rods")],
    "DEMO-CW-BOX": [("DEMO-RM-MS-PLATE-10", 300, 5, None), ("DEMO-RM-ISMC-100", 400, 3, "Underframe"), ("DEMO-HWF-BOLT-M16X60", 150, 0, None),
                    ("DEMO-PNT-PU-RAL1003", 15, 0, None)],
}

# Routing: key -> [(seq, operation, workstation code, setup h, run h/unit, QC gate?, instructions)]
ROUTINGS = {
    "SA-CHASSIS": [(10, "Plate & channel cutting", "DEMO-WS-CUT", 1, 6, False, "Nest per drawing DEMO-RRV8W-CH-001 rev B."),
                   (20, "Chassis fixture welding", "DEMO-WS-WLD", 2, 16, True, "Weld per WPS-DEMO-07; QC gate: weld visual + diagonal check."),
                   (30, "Mounting pad machining", "DEMO-WS-MCH", 1, 5, False, None),
                   (40, "Primer & PU painting", "DEMO-WS-PNT", 0.5, 6, False, "RAL 1003, DFT 120 µm.")],
    "SA-BOGIE": [(10, "Axle turning & bearing seats", "DEMO-WS-MCH", 1, 4, False, None),
                 (20, "Bogie assembly & wheel gauge setting", "DEMO-WS-ASM1", 0.5, 5, True, "QC gate: back-to-back 1600 ±2 mm."),
                 (30, "Deployment cylinder fitment", "DEMO-WS-HYD", 0.5, 2, False, None)],
    "SA-HPU": [(10, "HPU assembly & plumbing", "DEMO-WS-HYD", 1, 5, False, None),
               (20, "Proof pressure test 210 bar", "DEMO-WS-HYD", 0.5, 2, True, "Hold 10 min, no leakage. QC gate.")],
    "DEMO-RRV-8W": [(10, "Engine & driveline mounting", "DEMO-WS-ASM1", 2, 22, False, None),
                    (20, "Guide-wheel bogies & HPU fitment", "DEMO-WS-ASM1", 1, 14, False, None),
                    (30, "Electrical harness & control panel", "DEMO-WS-ASM1", 1, 14, False, None),
                    (40, "Final paint touch-up & decals", "DEMO-WS-PNT", 0.5, 6, False, None),
                    (50, "Pre-delivery functional check", "DEMO-WS-HYD", 0.5, 6, True, "Road/rail mode change-over, brakes, lights. QC gate.")],
    "DEMO-RGM-16": [(10, "Main frame fabrication", "DEMO-WS-WLD", 2, 30, False, None),
                    (20, "Grinding module assembly", "DEMO-WS-ASM2", 2, 40, False, None),
                    (30, "Hydraulic plumbing", "DEMO-WS-HYD", 1, 16, False, None),
                    (40, "PLC panel & wiring", "DEMO-WS-ASM2", 1, 20, False, None),
                    (50, "Functional test – stone pressure & traverse", "DEMO-WS-HYD", 1, 8, True, None)],
    "DEMO-TIC-01": [(10, "Body frame welding", "DEMO-WS-WLD", 1, 12, False, None),
                    (20, "Sensor beam assembly", "DEMO-WS-ASM2", 1, 10, False, None),
                    (30, "Wiring & data logger", "DEMO-WS-ASM2", 1, 12, False, None),
                    (40, "Calibration run on test track", "DEMO-WS-HYD", 0.5, 4, True, "Gauge ±1 mm, twist ±2 mm/3.6 m.")],
    "DEMO-HRE-150": [(10, "Ram & cylinder machining", "DEMO-WS-MCH", 1, 8, False, None),
                     (20, "Bridge & traverse assembly", "DEMO-WS-ASM2", 1, 6, False, None),
                     (30, "Proof pressure test 700 bar", "DEMO-WS-HYD", 0.5, 3, True, "Hold 15 min at 700 bar. QC gate."),
                     (40, "Painting & marking", "DEMO-WS-PNT", 0.5, 3, False, None)],
    "DEMO-CW-BOX": [(10, "Plate & channel cutting", "DEMO-WS-CUT", 1, 4, False, None),
                    (20, "Underframe & body welding", "DEMO-WS-WLD", 2, 18, True, None),
                    (30, "Painting", "DEMO-WS-PNT", 0.5, 5, False, None)],
}

# In-process gate plan characteristics: code -> (name, type, unit, class)
CHARACTERISTICS = {
    "DEMO-PRD-WELD-VIS": ("DEMO Weld visual & fillet size (IS 9595)", "attribute", None, "major"),
    "DEMO-PRD-DIAG": ("DEMO Frame diagonal difference", "variable", "mm", "major"),
    "DEMO-PRD-B2B": ("DEMO Wheel back-to-back distance", "variable", "mm", "critical"),
    "DEMO-PRD-PROOF": ("DEMO Proof pressure held for test time", "variable", "bar", "critical"),
    "DEMO-PRD-LEAK": ("DEMO No leakage at joints", "attribute", None, "major"),
    "DEMO-PRD-FUNC": ("DEMO Functional check per test sheet", "attribute", None, "major"),
}
# item key -> [(characteristic code, nominal, min, max)]
GATE_PLANS = {
    "SA-CHASSIS": [("DEMO-PRD-WELD-VIS", None, None, None), ("DEMO-PRD-DIAG", 0, 0, 3)],
    "SA-BOGIE": [("DEMO-PRD-B2B", 1600, 1598, 1602)],
    "SA-HPU": [("DEMO-PRD-PROOF", 210, 205, 230), ("DEMO-PRD-LEAK", None, None, None)],
    "DEMO-RRV-8W": [("DEMO-PRD-FUNC", None, None, None)],
    "DEMO-RGM-16": [("DEMO-PRD-FUNC", None, None, None)],
    "DEMO-TIC-01": [("DEMO-PRD-FUNC", None, None, None)],
    "DEMO-HRE-150": [("DEMO-PRD-PROOF", 700, 700, 735), ("DEMO-PRD-LEAK", None, None, None)],
    "DEMO-CW-BOX": [("DEMO-PRD-WELD-VIS", None, None, None)],
}

# Which product each fallback customer buys (when no sales order exists).
FALLBACK_CUSTOMER = {"DEMO-RRV-8W": "northern_railway", "DEMO-RGM-16": "dmrc", "DEMO-TIC-01": "ircon",
                     "DEMO-HRE-150": "rvnl", "DEMO-CW-BOX": "central_railway_workshop"}

# Issued from the shop-floor store instead of the work order's main store.
FLOOR_ITEMS = {"DEMO-CN-ELECTRODE-7018", "DEMO-CN-GRIND-DISC-4"}
WHOLE_UNITS = {"NOS", "KIT", "SET", "PCS"}


# ── Small helpers ─────────────────────────────────────────────────────────

def _people(demo):
    p = demo.data["people"]
    return p["production_manager"], p["production_supervisor"], p["quality_inspector"], p["quality_manager"]


def _day(demo, offset: int):
    return demo.today + timedelta(days=offset)


def _item_id(demo, key: str) -> int:
    if key in MADE_ITEMS:
        return demo.data["production_items"][key]["id"]
    return demo.data["items"][key]["id"]


def _loc(demo, key: str) -> int:
    return demo.data["locations"][key]


def _customer_name(demo, key: str) -> str:
    c = (demo.data.get("customers") or {}).get(key) or {}
    return c.get("name") or c.get("organization_name") or f"{LABEL} Customer"


def _sales_orders(demo) -> list[dict]:
    """Sales orders the Sales seeder registered, read back with their lines."""
    reg = demo.data.get("sales_orders")
    values = reg.values() if isinstance(reg, dict) else (reg if isinstance(reg, list) else [])
    ids = [v["id"] if isinstance(v, dict) else v for v in values if (isinstance(v, dict) and v.get("id")) or isinstance(v, int)]
    if not ids:
        return []
    from app.modules.sales.models.order import SalesOrder, SalesOrderLine
    out = []
    for so in demo.db.query(SalesOrder).filter(SalesOrder.id.in_(ids)).order_by(SalesOrder.id).all():
        lines = demo.db.query(SalesOrderLine).filter(SalesOrderLine.so_id == so.id).all()
        out.append({"number": so.so_number or f"Draft #{so.id}", "customer": so.customer_name, "po": so.customer_po_number,
                    "po_date": so.customer_po_date, "status": so.status,
                    "lines": [{"item_id": l.product_item_id, "text": " ".join(filter(None, [l.rrv_model, l.description])).upper(),
                               "qty": l.quantity} for l in lines]})
    return out


def _order_for(demo, product_code: str) -> dict:
    """The sales order this product is built against (or the fallback customer)."""
    item_id = demo.data["production_items"][product_code]["id"]
    product = demo.data["products"][product_code]
    model = (product.get("model_number") or product_code.replace("DEMO-", "")).upper()
    for so in demo.data["_prod_sales_orders"]:
        for line in so["lines"]:
            if line["item_id"] == item_id or model in line["text"] or product_code in line["text"]:
                return so
    return {"number": None, "customer": _customer_name(demo, FALLBACK_CUSTOMER[product_code]), "po": None, "po_date": None}


def _order_remark(order: dict) -> str:
    if order.get("number"):
        return f"Against sales order {order['number']} ({order['customer']})."
    return f"For {order['customer']} (sales order not seeded in this run)."


# ── Masters: workstations, items, gate plans ──────────────────────────────

def seed_workstations(demo) -> None:
    """Shop-floor workstations with capacity and hourly rate (costing)."""
    from app.modules.production.models.workstation import ProductionWorkstation
    manager = demo.data["people"]["production_manager"]
    dept = (demo.data.get("departments") or {}).get("Production")
    out = {}
    for code, name, wtype, cap, rate, status, desc in WORKSTATIONS:
        row = demo.db.query(ProductionWorkstation).filter(ProductionWorkstation.code == code, ProductionWorkstation.is_deleted == False).first()  # noqa: E712
        out[code] = demo.call("GET", f"/production/workstations/{row.id}", manager) if row else demo.call(
            "POST", "/production/workstations", manager, json={
                "code": code, "name": name, "workstation_type": wtype, "branch_id": demo.data["branch_id"], "department_id": dept,
                "capacity_hours_per_day": cap, "hourly_rate": rate, "status": status, "description": desc})
    demo.data["workstations"] = out
    demo.note("production", f"{len(out)} workstations (1 under maintenance)")


def seed_production_items(demo) -> None:
    """Finished-machine and sub-assembly items in the Store item master,
    linked to the Product master (Products › store item) when not linked yet."""
    from app.modules.products.models.product import FinishedProduct
    from app.modules.quality.services.lots import needs_inspection_on_receipt
    from app.modules.store.models.item import StoreItem

    keeper = demo.data["people"]["store_keeper"]
    owner = demo.data["people"]["rnd_head"]
    demo.db.expire_all()
    out, linked = {}, []
    for key, (code, name, hsn, cost, serial) in MADE_ITEMS.items():
        product = demo.data["products"].get(key)
        prow = demo.db.get(FinishedProduct, product["id"]) if product else None
        if prow and prow.store_item_id:   # e.g. the Sales / Design seeder already made the FG item
            linked_item = demo.db.get(StoreItem, prow.store_item_id)
            if linked_item and not needs_inspection_on_receipt(demo.db, linked_item, "final"):
                out[key] = demo.call("GET", f"/store/items/{prow.store_item_id}", keeper)
                continue
            # A final-inspection item would send every build through a first
            # article + final lot (rule 9) — keep Production's own FG item.
            demo.note("production", f"{key} is linked to {linked_item.item_code if linked_item else '?'}, which needs final inspection — "
                                    f"work orders use {code} instead")
            prow = None
        row = demo.db.query(StoreItem).filter(StoreItem.item_code == code).first()
        item = demo.call("GET", f"/store/items/{row.id}", keeper) if row else demo.call("POST", "/store/items", keeper, json={
            "item_code": code, "item_name": name, "item_type": "material", "category": "Production Material",
            "uom": "NOS", "hsn_sac_code": hsn, "gst_rate": 18, "standard_cost": cost, "serial_controlled": serial,
            "preferred_warehouse_id": _loc(demo, "main_store" if key.startswith("DEMO-") else "production_floor"),
            "description": f"{LABEL} item made in-house by Production ({'finished machine' if key.startswith('DEMO-') else 'sub-assembly'}).",
        })
        out[key] = item
        if prow:
            status, body = demo.try_call("PATCH", f"/products/{prow.id}", owner, json={"store_item_id": item["id"]})
            if status == 200:
                linked.append(key)
            else:
                demo.note("production", f"couldn't link {key} to store item {code}: {status} {body}")
    demo.data["production_items"] = out
    demo.note("production", f"{len(out)} made-in-house items (5 finished machines, 3 sub-assemblies); {len(linked)} linked to the Product master")


def seed_gate_plans(demo) -> None:
    """Quality: approved in-process inspection plans for every item with a QC
    gate in its routing (rule 2 — a gate lot needs an approved plan)."""
    from app.modules.quality.models.characteristic import QualityCharacteristic
    from app.modules.quality.models.inspection_plan import QualityInspectionPlan

    qm = demo.data["people"]["quality_manager"]
    chars = {}
    for code, (name, ctype, unit, cls) in CHARACTERISTICS.items():
        row = demo.db.query(QualityCharacteristic).filter(QualityCharacteristic.code == code).first()
        chars[code] = row.id if row else demo.call("POST", "/quality/masters/characteristics", qm, json={
            "code": code, "name": name, "char_type": ctype, "unit": unit, "classification": cls,
            "method": "Visual / gauge" if ctype == "attribute" else "Measured", "description": f"{LABEL} production gate check"})["id"]
    made = 0
    for key, lines in GATE_PLANS.items():
        item = demo.data["production_items"][key]
        exists = demo.db.query(QualityInspectionPlan).filter(
            QualityInspectionPlan.item_id == item["id"], QualityInspectionPlan.inspection_type == "in_process",
            QualityInspectionPlan.status == "approved", QualityInspectionPlan.is_deleted == False).first()  # noqa: E712
        if exists:
            continue
        plan = demo.call("POST", "/quality/inspection-plans", qm, json={
            "item_id": item["id"], "inspection_type": "in_process", "title": f"{LABEL} in-process gate – {item['item_name']}",
            "sampling_type": "fixed", "fixed_sample_size": 1, "remarks": f"{LABEL} gate plan used by Production QC gates.",
            "lines": [{"characteristic_id": chars[c], "sequence": (i + 1) * 10, "nominal": nom, "min_value": lo, "max_value": hi}
                      for i, (c, nom, lo, hi) in enumerate(lines)]})
        demo.call("POST", f"/quality/inspection-plans/{plan['id']}/approve", qm)
        made += 1
    demo.note("quality", f"{made} approved in-process gate plans for Production items")


# ── BOMs ──────────────────────────────────────────────────────────────────

def _design_lines(demo, key: str) -> list[tuple[int, float]]:
    """Lines of the latest RELEASED design BOM revision for this item, if the
    Design seeder made one (store items only)."""
    from app.modules.design.models.bom import DesignBom, DesignBomLine, DesignBomRevision
    item_id = demo.data["production_items"][key]["id"]
    bom = demo.db.query(DesignBom).filter(DesignBom.product_item_id == item_id, DesignBom.is_deleted == False).order_by(DesignBom.id.desc()).first()  # noqa: E712
    if not bom:
        return []
    rev = demo.db.query(DesignBomRevision).filter(DesignBomRevision.bom_id == bom.id, DesignBomRevision.status == "released",
                                                  DesignBomRevision.is_deleted == False).order_by(DesignBomRevision.revision_index.desc()).first()  # noqa: E712
    if not rev:
        return []
    lines = demo.db.query(DesignBomLine).filter(DesignBomLine.revision_id == rev.id).order_by(DesignBomLine.position).all()
    merged: dict[int, float] = {}
    for l in lines:
        if l.store_item_id and l.store_item_id != item_id:
            merged[l.store_item_id] = merged.get(l.store_item_id, 0) + (l.quantity or 1)
    if merged:
        demo.note("production", f"{key}: production BOM components taken from design BOM {bom.bom_number} rev {rev.revision_label}")
    return list(merged.items())


def seed_boms(demo) -> None:
    """Production BOM + routing per made item: raised by the supervisor,
    activated by the production manager. The chassis BOM also gets a v2
    draft (new version in progress)."""
    from app.modules.production.models.bom import ProductionBom
    manager, supervisor, _qi, _qm = _people(demo)
    ws = demo.data["workstations"]
    out = {}
    for key in COMPONENTS:
        item = demo.data["production_items"][key]
        active = demo.db.query(ProductionBom).filter(ProductionBom.product_item_id == item["id"], ProductionBom.status == "active",
                                                     ProductionBom.is_deleted == False).first()  # noqa: E712
        if active:
            out[key] = demo.call("GET", f"/production/boms/{active.id}", manager)
            continue
        design = _design_lines(demo, key)
        if design:
            items = [{"component_item_id": i, "quantity": q, "scrap_percent": 0, "remarks": "From design BOM"} for i, q in design]
            have = {i for i, _q in design}
            items += [{"component_item_id": _item_id(demo, c), "quantity": q, "scrap_percent": s, "remarks": r}
                      for c, q, s, r in COMPONENTS[key] if c in MADE_ITEMS and _item_id(demo, c) not in have]
        else:
            items = [{"component_item_id": _item_id(demo, c), "quantity": q, "scrap_percent": s, "remarks": r} for c, q, s, r in COMPONENTS[key]]
        bom = demo.call("POST", "/production/boms", supervisor, json={
            "product_item_id": item["id"], "base_quantity": 1, "description": f"{LABEL} manufacturing BOM – {item['item_name']}",
            "items": items,
            "operations": [{"sequence": s, "operation_name": n, "workstation_id": ws[w]["id"], "setup_hours": su,
                            "run_hours_per_unit": run, "requires_inspection": gate, "instructions": ins}
                           for s, n, w, su, run, gate, ins in ROUTINGS[key]]})
        out[key] = demo.call("POST", f"/production/boms/{bom['id']}/activate", manager)
    demo.data["production_boms"] = out

    # A v2 of the chassis BOM being worked on (heavier outriggers) — stays draft.
    chassis = out["SA-CHASSIS"]
    draft = demo.db.query(ProductionBom).filter(ProductionBom.product_item_id == chassis["product_item_id"], ProductionBom.status == "draft",
                                                ProductionBom.is_deleted == False).first()  # noqa: E712
    if not draft:
        v2 = demo.call("POST", f"/production/boms/{chassis['id']}/new-version", supervisor)
        lines = [{"component_item_id": l["component_item_id"], "quantity": l["quantity"] + (30 if l["item_code"] == "DEMO-RM-ISMC-100" else 0),
                  "scrap_percent": l["scrap_percent"], "remarks": l["remarks"]} for l in v2["items"]]
        demo.call("PATCH", f"/production/boms/{v2['id']}", supervisor, json={
            "items": lines, "remarks": "DEMO v2: outriggers upgraded to heavier ISMC section after field feedback (draft, not yet activated)."})
    demo.note("production", f"{len(out)} active BOMs with routings; chassis BOM v2 left as draft")


# ── Work-order steps ──────────────────────────────────────────────────────

def _create_wo(demo, key: str, qty: float, start: int, end: int, priority="normal", target="main_store",
               build_id=None, role=None, remarks="") -> dict:
    _m, supervisor, _qi, _qm = _people(demo)
    wo = demo.call("POST", "/production/work-orders", supervisor, json={
        "bom_id": demo.data["production_boms"][key]["id"], "quantity_planned": qty, "branch_id": demo.data["branch_id"],
        "priority": priority, "source_location_id": _loc(demo, "main_store"), "target_location_id": _loc(demo, target),
        "planned_start_date": str(_day(demo, start)), "planned_end_date": str(_day(demo, end)),
        "supervisor_id": supervisor.id, "remarks": f"{LABEL} — {remarks}".strip(), "rrv_build_id": build_id, "build_role": role})
    return wo


def _release(demo, wo: dict, user=None) -> dict:
    manager = _people(demo)[0]
    return demo.call("POST", f"/production/work-orders/{wo['id']}/release", user or manager)


def _get(demo, wo: dict) -> dict:
    return demo.call("GET", f"/production/work-orders/{wo['id']}", _people(demo)[0])


def _issue(demo, wo: dict, fraction: float = 1.0, only=None) -> dict:
    """Issue what's outstanding (× fraction) from where the stock is: the
    order's main store, or the shop floor for consumables / sub-assemblies.
    Never more than is on hand — short lines stay outstanding."""
    from app.modules.production.service import available_qty
    supervisor = _people(demo)[1]
    wo = _get(demo, wo)
    sub_codes = {MADE_ITEMS[k][0] for k in ("SA-CHASSIS", "SA-BOGIE", "SA-HPU")}
    by_loc: dict[int, list] = {}
    for m in wo["materials"]:
        if only and m["item_code"] not in only:
            continue
        want = m["outstanding_qty"] * fraction
        if (m.get("uom") or "").upper() in WHOLE_UNITS:
            want = math.floor(want + 1e-9)
        if want <= 0:
            continue
        floor = m["item_code"] in FLOOR_ITEMS or m["item_code"] in sub_codes
        loc = _loc(demo, "production_floor") if floor else wo["source_location_id"]
        have = available_qty(demo.db, [m["item_id"]], loc).get(m["item_id"], 0.0) if floor else m["reserved_qty"] + m["available_qty"]
        qty = round(min(want, max(have, 0)), 3)
        if (m.get("uom") or "").upper() in WHOLE_UNITS:
            qty = math.floor(qty + 1e-9)
        if qty > 0:
            by_loc.setdefault(loc, []).append({"item_id": m["item_id"], "quantity": qty})
    for loc, lines in by_loc.items():
        wo = demo.call("POST", f"/production/work-orders/{wo['id']}/issue-materials", supervisor, json={
            "location_id": loc, "lines": lines, "remarks": f"Kitted against {wo['wo_number']} (DEMO)"})
    return wo


def _book(demo, wo: dict, op: dict, hours: float, days_back: int, qty_good: float = 0) -> None:
    """Shop-floor time booking in ≤ 8 h shifts on consecutive past days."""
    supervisor = _people(demo)[1]
    operator = demo.data["people"].get("employee") or supervisor
    left, day = hours, days_back
    while left > 1e-9:
        h = min(8.0, left)
        left -= h
        demo.call("POST", "/production/time-logs", supervisor, json={
            "work_order_id": wo["id"], "operation_id": op["id"], "operator_id": operator.id,
            "log_date": str(_day(demo, -max(day, 0))), "hours": round(h, 2),
            "qty_good": qty_good if left <= 1e-9 else 0, "remarks": f"{op['operation_name']} (DEMO shift booking)"})
        day -= 1


def _pass_gate(demo, lot_id: int, note: str) -> None:
    """Quality: inspector records the gate results, Quality Manager accepts."""
    _m, _s, qi, qm = _people(demo)
    base = f"/quality/inspection-lots/{lot_id}"
    demo.call("POST", f"{base}/start", qi)
    lot = demo.call("GET", base, qi)
    entries = []
    for r in lot["results"]:
        if r["char_type"] == "variable":
            nominal = r["nominal"] if r["nominal"] is not None else ((r["min_value"] or 0) + (r["max_value"] or 0)) / 2
            entries.append({"result_id": r["id"], "measured_values": [nominal] * max(r["sample_size"], 1), "remarks": note})
        else:
            entries.append({"result_id": r["id"], "defects_found": 0, "remarks": note})
    demo.call("POST", f"{base}/results", qi, json={"entries": entries})
    demo.call("POST", f"{base}/submit-results", qi)
    demo.call("POST", f"{base}/decision", qm, json={"decision": "accept", "remarks": f"{LABEL}: gate accepted — {note}"})


def _run_ops(demo, wo: dict, days_back: int, stop_before: int | None = None, leave_gate_open_at: int | None = None,
             in_progress_at: int | None = None) -> dict:
    """Runs the routing in order: time booked, QC gate requested and passed,
    operation completed. stop_before = leave that sequence (and later) pending;
    in_progress_at = book part of that op's time and leave it running;
    leave_gate_open_at = request the gate lot there and leave it for Quality."""
    supervisor = _people(demo)[1]
    wo = _get(demo, wo)
    qty = wo["quantity_planned"]
    day = days_back
    for op in sorted(wo["operations"], key=lambda o: o["sequence"]):
        if op["status"] == "completed":
            continue
        if stop_before is not None and op["sequence"] >= stop_before:
            break
        if in_progress_at == op["sequence"]:
            _book(demo, wo, op, max(op["planned_hours"] * 0.4, 1), day)
            break
        _book(demo, wo, op, max(op["planned_hours"], 1), day, qty_good=qty)
        day -= max(math.ceil(op["planned_hours"] / 8), 1)
        if op["requires_inspection"]:
            wo = demo.call("POST", f"/production/work-orders/{wo['id']}/operations/{op['id']}/request-inspection", supervisor)
            lot_id = next(o for o in wo["operations"] if o["id"] == op["id"])["quality_lot_id"]
            if leave_gate_open_at == op["sequence"]:
                break
            _pass_gate(demo, lot_id, f"{wo['wo_number']} op {op['sequence']} {op['operation_name']}")
        wo = demo.call("POST", f"/production/work-orders/{wo['id']}/operations/{op['id']}/complete", supervisor,
                       json={"remarks": "Done as per routing (DEMO)."})
    return _get(demo, wo)


def _receive(demo, wo: dict, serials: list[str] | None = None, qty: float | None = None) -> dict:
    supervisor = _people(demo)[1]
    if serials:
        for s in serials:
            wo = demo.call("POST", f"/production/work-orders/{wo['id']}/receive-output", supervisor, json={
                "quantity": 1, "batch_number": s, "remarks": f"Finished machine {s} received into stock (DEMO)"})
        return wo
    return demo.call("POST", f"/production/work-orders/{wo['id']}/receive-output", supervisor, json={
        "quantity": qty or wo["quantity_planned"], "remarks": "Received into shop-floor WIP store (DEMO)"})


def _finish(demo, wo: dict, close: bool = False) -> dict:
    manager = _people(demo)[0]
    wo = demo.call("POST", f"/production/work-orders/{wo['id']}/complete", manager)
    if close:
        wo = demo.call("POST", f"/production/work-orders/{wo['id']}/close", manager)
    return wo


def _serial(product_code: str, n: int) -> str:
    return f"{product_code}-26-{n:03d}"


def _machine(demo, product_code, serial, wo, order, **extra) -> None:
    demo.data["finished_machines"].append({
        "product_code": product_code, "serial_no": serial, "work_order_id": wo["id"], "work_order_number": wo["wo_number"],
        "customer": order.get("customer"), "sales_order": order.get("number"), **extra})


# ── Standalone work orders (one per document stage) ───────────────────────

def seed_completed_work_orders(demo) -> None:
    """Completed & closed builds: TIC-01 and HRE-150, finished machines
    received into the main store under their serial numbers."""
    wos = demo.data["work_orders"]
    for key, product, start, end, days in (("tic_done", "DEMO-TIC-01", -40, -12, 34), ("hre_done", "DEMO-HRE-150", -30, -8, 24)):
        order = _order_for(demo, product)
        wo = _create_wo(demo, product, 1, start, end, priority="high", remarks=f"Build of 1 × {product}. {_order_remark(order)}")
        wo = _release(demo, wo)
        _issue(demo, wo)
        _run_ops(demo, wo, days_back=days)
        serial = _serial(product, 1)
        _receive(demo, wo, serials=[serial])
        wos[key] = _finish(demo, wo, close=True)
        _machine(demo, product, serial, wos[key], order)
    demo.note("production", f"completed & closed: {wos['tic_done']['wo_number']} (TIC-01), {wos['hre_done']['wo_number']} (HRE-150) — finished machines in stock")


def seed_open_work_orders(demo) -> None:
    """Work orders still running: in progress at the QC gate, released with
    shortages, overdue draft, release waiting for approval, cancelled."""
    manager, supervisor, _qi, _qm = _people(demo)
    wos = demo.data["work_orders"]

    order = _order_for(demo, "DEMO-HRE-150")
    wo = _create_wo(demo, "DEMO-HRE-150", 1, -10, 6, priority="high", remarks=f"Second re-railing set. {_order_remark(order)}")
    wo = _release(demo, wo)
    _issue(demo, wo)
    wos["hre_qc_gate"] = _run_ops(demo, wo, days_back=8, leave_gate_open_at=30)

    order = _order_for(demo, "DEMO-RGM-16")
    wo = _create_wo(demo, "DEMO-RGM-16", 1, 3, 45, remarks=f"Rail grinding machine. {_order_remark(order)} Waiting for engine, pumps and PLC from Purchase.")
    wos["rgm_released"] = _release(demo, wo)

    order = _order_for(demo, "DEMO-TIC-01")
    wos["tic_draft_overdue"] = _create_wo(demo, "DEMO-TIC-01", 1, -20, -3, priority="urgent",
                                         remarks=f"Second inspection car. {_order_remark(order)} Not released: sensor beam drawing under revision.")

    order = _order_for(demo, "DEMO-CW-BOX")
    wo = _create_wo(demo, "DEMO-CW-BOX", 2, 5, 30, remarks=f"2 material wagons. {_order_remark(order)}")
    wos["cw_pending_release"] = _release(demo, wo, user=supervisor)   # supervisor can only submit → waits for an approver

    wo = _create_wo(demo, "DEMO-CW-BOX", 1, -5, 20, priority="low", remarks=f"Extra wagon. {_order_remark(order)}")
    wo = _release(demo, wo)
    wos["cw_cancelled"] = demo.call("POST", f"/production/work-orders/{wo['id']}/cancel", manager, json={
        "reason": "Customer amendment reduced the wagon quantity — material reservation released back to Store."})
    demo.note("production", f"in progress at QC gate {wos['hre_qc_gate']['wo_number']}; released short {wos['rgm_released']['wo_number']}; "
                            f"overdue draft {wos['tic_draft_overdue']['wo_number']}; cancelled {wos['cw_cancelled']['wo_number']}")
    demo.note("production", f"{wos['cw_pending_release']['wo_number']} release submitted by the supervisor — waiting for a work-order approver (you)")


# ── RRV builds ────────────────────────────────────────────────────────────

def _build(demo, key: str, n: int, order: dict, start: int, done: int, handover: int, priority="normal", **extra) -> dict:
    manager = _people(demo)[0]
    serial = _serial("DEMO-RRV-8W", n)
    return demo.call("POST", "/production/rrv-builds", manager, json={
        "rrv_model": "DEMO RRV-8W (8-wheel rail-cum-road vehicle)", "customer_name": order["customer"],
        "customer_po_number": order.get("po"), "customer_po_date": str(order["po_date"]) if order.get("po_date") else None,
        "order_reference": order.get("number"), "vehicle_serial_number": serial, "chassis_number": f"DEMO-CH-26-{n:04d}",
        "engine_number": f"DEMO-ENG74-{8800 + n}", "year_of_manufacture": str(demo.today.year), "branch_id": demo.data["branch_id"],
        "build_manager_id": manager.id, "priority": priority, "planned_start_date": str(_day(demo, start)),
        "target_completion_date": str(_day(demo, done)), "target_handover_date": str(_day(demo, handover)), "warranty_months": 24,
        "remarks": f"{LABEL} RRV build {n}. {_order_remark(order)}", **extra})


def _stage(demo, build: dict, key: str, action: str, user=None, **payload) -> dict:
    supervisor = _people(demo)[1]
    path = f"/production/rrv-builds/{build['id']}/stages/{key}"
    if action == "start":
        return demo.call("POST", f"{path}/start", user or supervisor)
    if action == "na":
        return demo.call("POST", f"{path}/not-applicable", user or supervisor, json=payload)
    if action == "plan":
        return demo.call("PATCH", path, user or supervisor, json=payload)
    return demo.call("POST", f"{path}/complete", user or supervisor, json=payload or {"remarks": None})


def _sub_assemblies(demo, build: dict, prefix: str, days: int) -> None:
    """Chassis, 2 guide-wheel bogies and the HPU, built and received into
    the shop-floor (WIP) store."""
    wos = demo.data["work_orders"]
    for key, qty in (("SA-CHASSIS", 1), ("SA-BOGIE", 2), ("SA-HPU", 1)):
        wo = _create_wo(demo, key, qty, -days, -days + 12, target="production_floor", build_id=build["id"], role="sub_assembly",
                        remarks=f"Sub-assembly for {build['build_number']}.")
        wo = _release(demo, wo)
        _issue(demo, wo)
        _run_ops(demo, wo, days_back=days)
        _receive(demo, wo)
        wos[f"{prefix}_{key.split('-')[1].lower()}"] = _finish(demo, wo)


def seed_rrv_handed_over(demo) -> None:
    """RRV build 1: every stage done, a failed rail-brake test reworked and
    retested, final inspection passed, RRV Completion (machine registered in
    ERP) and Production Handover signed off by the production manager."""
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    manager, supervisor, _qi, qm = _people(demo)
    order = _order_for(demo, "DEMO-RRV-8W")
    build = _build(demo, "handed_over", 1, order, -60, -10, -3, priority="high")
    main = _create_wo(demo, "DEMO-RRV-8W", 1, -45, -14, priority="high", build_id=build["id"], role="main",
                      remarks=f"Final vehicle assembly for {build['build_number']}.")
    _stage(demo, build, "planning", "complete", remarks="Build plan frozen with customer delivery schedule.")
    _sub_assemblies(demo, build, "rrv1", days=58)
    main = _release(demo, main)
    _issue(demo, main)
    _run_ops(demo, main, days_back=40)
    serial = build["vehicle_serial_number"]
    _receive(demo, main, serials=[serial])
    demo.data["work_orders"]["rrv1_main"] = _finish(demo, main)

    _stage(demo, build, "material_kitting", "complete", remarks="All lines kitted from Main Store and WIP.")
    _stage(demo, build, "sub_assembly", "complete")
    _stage(demo, build, "main_assembly", "complete")
    _stage(demo, build, "electrical_integration", "na",
           reason="Harness and control panel fitted and checked on main WO operation 30; no separate Electrical job for this vehicle.")
    _stage(demo, build, "hydraulic_integration", "na",
           reason="Hydraulics proved on the HPU work order (210 bar proof test, QC gate accepted).")
    _stage(demo, build, "final_assembly", "complete")
    b = demo.call("POST", f"/production/rrv-builds/{build['id']}/request-final-inspection", supervisor)
    demo.db.expire_all()
    insp_id = demo.db.get(ProductionRrvBuild, build["id"]).final_inspection_id
    demo.call("PATCH", f"/quality/inspections/{insp_id}", qm, json={
        "status": "passed", "quantity_inspected": 1, "quantity_accepted": 1, "remarks": "DEMO final vehicle inspection — all checks OK.",
        "results": [{"parameter": p, "acceptance_criteria": c, "observed_value": o, "result": "pass", "sort_order": i}
                    for i, (p, c, o) in enumerate([("Overall dimensions", "Per GA drawing ±10 mm", "Within limits"),
                                                   ("Paint DFT", "≥ 120 µm", "135 µm"),
                                                   ("Weld quality", "No visible defects", "OK"),
                                                   ("Name plate & markings", "Present, legible", "OK")])]})
    _stage(demo, build, "final_inspection", "complete", remarks=f"Final inspection {b.get('final_inspection_number') or ''} passed.")

    tests = {"static_inspection": "Weight 18.4 t, dimensions OK", "guide_wheel_deployment": "Deploy 14 s / retract 12 s",
             "brake_test_road": "Stopping distance 9.8 m at 30 km/h", "road_trial": "25 km road run OK", "rail_trial": "12 km rail run OK at 40 km/h",
             "emergency_stop": "All E-stops cut engine & hydraulics"}
    for t, obs in tests.items():
        demo.call("POST", f"/production/rrv-builds/{build['id']}/tests", supervisor, json={
            "test_type": t, "test_date": str(_day(demo, -9)), "result": "pass", "observed": obs, "witnessed_by": f"{LABEL} QA – Quality Manager"})
    b = demo.call("POST", f"/production/rrv-builds/{build['id']}/tests", supervisor, json={
        "test_type": "brake_test_rail", "test_date": str(_day(demo, -9)), "result": "fail", "expected": "Stop within 60 m from 40 km/h on rail",
        "observed": "Stopped in 74 m — rail brake shoes not bedded, left-rear cylinder slow to apply", "rework_assignee_id": supervisor.id})
    failed = next(t for t in b["tests"] if t["test_type"] == "brake_test_rail")
    rw = next(r for r in b["rework_orders"] if r["source_test_id"] == failed["id"])
    demo.call("POST", f"/production/rrv-builds/rework/{rw['id']}/start", supervisor)
    demo.call("POST", f"/production/rrv-builds/rework/{rw['id']}/done", supervisor, json={
        "corrective_action": "Bled left-rear brake cylinder, replaced seal kit, bedded shoes over 2 km.",
        "root_cause": "Air trapped in brake line after HPU fitment.", "hours_spent": 6})
    demo.call("POST", f"/production/rrv-builds/{build['id']}/tests", supervisor, json={
        "test_type": "brake_test_rail", "test_date": str(_day(demo, -7)), "result": "pass", "observed": "Stopped in 52 m from 40 km/h",
        "retest_of_id": failed["id"], "witnessed_by": f"{LABEL} QA – Quality Manager"})
    demo.call("POST", f"/production/rrv-builds/rework/{rw['id']}/verify", manager, json={"remarks": "Retest passed — verified."})
    _stage(demo, build, "testing", "complete")
    _stage(demo, build, "rework_closure", "complete")
    b = _stage(demo, build, "rrv_completion", "complete", user=manager, remarks="Vehicle complete, registered in the machine registry.")
    demo.call("PATCH", f"/production/rrv-builds/{build['id']}", manager, json={
        "handover_date": str(_day(demo, -3)), "handed_over_to_name": f"{LABEL} SSE/Track Machines", "handed_over_to_organization": order["customer"],
        "handover_location": "Premnath Unit 1 dispatch bay", "customer_acceptance_ref": f"DEMO/ACC/{demo.today.year}/017",
        "handover_remarks": "Joint inspection done; tools kit and manuals handed over."})
    b = _stage(demo, build, "handover", "complete", user=manager, remarks="Handed over to customer's representative.")
    demo.data["rrv_builds"]["handed_over"] = b
    _machine(demo, "DEMO-RRV-8W", serial, demo.data["work_orders"]["rrv1_main"], order,
             erp_project_id=b.get("erp_project_id"), rrv_build_id=b["id"])
    demo.note("production", f"{b['build_number']} handed over — machine {serial} registered in ERP (#{b.get('erp_project_id')})")


def seed_rrv_in_progress(demo) -> None:
    """RRV build 2: sub-assemblies done, main assembly running and overdue,
    road tyres short (material kitting still open)."""
    supervisor = _people(demo)[1]
    order = _order_for(demo, "DEMO-RRV-8W")
    build = _build(demo, "in_progress", 2, order, -30, 15, 25, priority="high")
    main = _create_wo(demo, "DEMO-RRV-8W", 1, -14, -2, priority="high", build_id=build["id"], role="main",
                      remarks=f"Final vehicle assembly for {build['build_number']}.")
    _stage(demo, build, "planning", "complete")
    _stage(demo, build, "material_kitting", "start")
    _sub_assemblies(demo, build, "rrv2", days=28)
    _stage(demo, build, "sub_assembly", "complete")
    main = _release(demo, main)
    _issue(demo, main)
    main = _run_ops(demo, main, days_back=10, in_progress_at=30)
    demo.data["work_orders"]["rrv2_main"] = main
    _stage(demo, build, "main_assembly", "start")
    _stage(demo, build, "main_assembly", "plan", assignee_id=supervisor.id, planned_start_date=str(_day(demo, -12)),
           planned_end_date=str(_day(demo, -2)), remarks="Waiting for 2 road tyres from Purchase.")
    b = _stage(demo, build, "final_assembly", "plan", planned_start_date=str(_day(demo, 2)), planned_end_date=str(_day(demo, 9)))
    demo.data["rrv_builds"]["in_progress"] = b
    short = [m["item_code"] for m in main["materials"] if m["outstanding_qty"] > 0]
    demo.note("production", f"{b['build_number']} in progress — main WO {main['wo_number']} overdue; still outstanding: {', '.join(short) or 'nothing'}")


def seed_rrv_planned_and_hold(demo) -> None:
    """RRV build 3 planned (main WO draft); build 4 on hold for a gauge change."""
    manager = _people(demo)[0]
    order = _order_for(demo, "DEMO-RRV-8W")
    build = _build(demo, "planned", 3, order, 20, 80, 90)
    demo.data["work_orders"]["rrv3_main"] = _create_wo(demo, "DEMO-RRV-8W", 1, 35, 75, build_id=build["id"], role="main",
                                                       remarks=f"Final vehicle assembly for {build['build_number']}.")
    demo.data["rrv_builds"]["planned"] = demo.call("GET", f"/production/rrv-builds/{build['id']}", manager)

    build = _build(demo, "on_hold", 4, order, -5, 70, 85, priority="low")
    _stage(demo, build, "planning", "start", user=manager)
    demo.data["rrv_builds"]["on_hold"] = demo.call("POST", f"/production/rrv-builds/{build['id']}/hold", manager, json={
        "reason": "Customer asked for standard-gauge (1435 mm) guide wheels — waiting for Design's ECN before kitting."})
    demo.note("production", f"{demo.data['rrv_builds']['planned']['build_number']} planned; {demo.data['rrv_builds']['on_hold']['build_number']} on hold")


# ── Re-run ────────────────────────────────────────────────────────────────

def _reuse(demo) -> bool:
    """A real re-run on a seeded database: keep the existing documents and
    just fill the registry (work orders / builds aren't duplicated)."""
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    from app.modules.production.models.work_order import ProductionWorkOrder
    item_ids = [i["id"] for k, i in demo.data["production_items"].items() if k.startswith("DEMO-")]
    rows = demo.db.query(ProductionWorkOrder).filter(ProductionWorkOrder.product_item_id.in_(item_ids),
                                                     ProductionWorkOrder.is_deleted == False).all()  # noqa: E712
    if not rows:
        return False
    manager = _people(demo)[0]
    demo.data["work_orders"] = {r.wo_number: demo.call("GET", f"/production/work-orders/{r.id}", manager) for r in rows}
    builds = demo.db.query(ProductionRrvBuild).filter(ProductionRrvBuild.rrv_model.like(f"{LABEL} %")).all()
    demo.data["rrv_builds"] = {b.status: demo.call("GET", f"/production/rrv-builds/{b.id}", manager) for b in builds}
    codes = {i["id"]: k for k, i in demo.data["production_items"].items()}
    from app.modules.production.models.work_order import WORK_ORDER_REFERENCE_TYPE
    from app.modules.store.models.stock_transaction import StoreStockTransaction as T
    for r in rows:
        for (batch,) in demo.db.query(T.batch_number).filter(T.reference_type == WORK_ORDER_REFERENCE_TYPE, T.reference_number == r.wo_number,
                                                            T.transaction_type == "receipt").all():
            demo.data["finished_machines"].append({"product_code": codes.get(r.product_item_id), "serial_no": batch,
                                                   "work_order_id": r.id, "work_order_number": r.wo_number,
                                                   "erp_project_id": r.erp_project_id, "rrv_build_id": r.rrv_build_id})
    demo.note("production", f"already seeded — reused {len(rows)} work orders and {len(builds)} RRV builds")
    return True


def seed(demo) -> None:
    demo.data.setdefault("work_orders", {})
    demo.data.setdefault("rrv_builds", {})
    demo.data.setdefault("finished_machines", [])
    demo.data["_prod_sales_orders"] = _sales_orders(demo)
    if not demo.data["_prod_sales_orders"]:
        demo.note("production", "no sales orders in demo.data['sales_orders'] — work orders name the foundation customers instead")
    seed_workstations(demo)
    seed_production_items(demo)
    seed_gate_plans(demo)
    seed_boms(demo)
    if _reuse(demo):
        return
    seed_completed_work_orders(demo)
    seed_rrv_handed_over(demo)
    seed_rrv_in_progress(demo)      # before the open orders: they'd reserve the last pump / tyres
    seed_open_work_orders(demo)
    seed_rrv_planned_and_hold(demo)
    demo.note("production", f"{len(demo.data['work_orders'])} work orders, {len(demo.data['rrv_builds'])} RRV builds, "
                            f"{len(demo.data['finished_machines'])} finished machines with serials")
