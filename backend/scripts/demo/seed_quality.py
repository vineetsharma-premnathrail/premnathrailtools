"""Quality: masters, inspection plans, incoming / job-work inspection lots, first articles, NCRs, CAPA, supplier quality, inspection calls, complaints, standards, documents.

Runs after p2p and store. Everything through the Quality API as the right
demo person: quality_inspector records results, quality_manager (Quality
head grants) owns masters / plans / usage decisions / NCR dispositions /
CAPA, purchase_manager (is_purchase_head) signs the "Purchase" stage of a
return-to-vendor disposition through the central /approvals endpoint.

Inputs used when present: grns["in_quality"] (p2p — four incoming lots, all
first articles because every DEMO vendor is new), returns["job_work"] (store
— the job-work lot), customers (foundation). Missing upstream keys are
skipped with a note.

What it leaves (stages differ on purpose):
  masters        13 characteristics, 7 defect codes (disposition codes exist / are seeded)
  standards      4 reference standards; documents: 3 quality documents (SOP, QAP, certificate)
  plans          incoming plans approved for the 4 GRN items, job-work plan for EN8 axle
                 blanks, gear-pump plan waiting for approval, DCV plan still a draft
  inspection_lots dict key → lot dict:
                 bearing  accepted (FAI approved → vendor Approved on the AVL, GRN line passed)
                 sensor   partially rejected 18/2 (NCR raised, FAI rejected)
                 en8      in inspection, results half recorded (MTC received)
                 motor    created, assigned to the inspector, not started (waiting)
                 job_work results recorded, waiting for the usage decision
  ncrs           dict key → NCR dict:
                 sensor_rtv  from the sensor lot — return to vendor approved by Quality
                             + Purchase, action done (debit note), verified
                 weld_rework manual in-process NCR, rework proposed (pending approval)
                 paint_docs  manual incoming documentation NCR, open (no disposition yet)
  capas          dict key → CAPA dict: sensor_vendor (root cause found, actions in
                 progress), audit_preventive (open)
  complaints     dict key → complaint dict: hose_leak (under investigation → NCR + CAPA),
                 manual_missing (rejected — not valid), paint_fade (open)
  avl            approved vendor list rows: ISMC/steel vendor approved, seal kit/hydraulics
                 on trial, sensor/electricals on watch; supplier ratings for this month;
                 one vendor audit completed, one scheduled
  inspection_calls dict key → call: raised, scheduled, accepted (RITES certificate)
Checklists have no API (model only) — not seeded.
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL


def _p(demo):
    return demo.data["people"]


def _item(demo, code):
    return demo.data["items"][code]


def _qm(demo):
    return _p(demo)["quality_manager"]


def _qi(demo):
    return _p(demo)["quality_inspector"]


def _try(demo, module, what, method, url, user, **kw):
    """Optional step: on failure note the exact server message and go on."""
    status, body = demo.try_call(method, url, user, **kw)
    if status >= 400:
        detail = body.get("detail") if isinstance(body, dict) else body
        demo.note(module, f"SKIPPED {what}: {method} {url} as {user.name} → {status}: {detail}")
        return None
    return body


# ── Masters ───────────────────────────────────────────────────────────────

CHARACTERISTICS = [
    # code, name, type, unit, method, gauge, class
    ("DEMO-OD", "Outside / turned diameter", "variable", "mm", "Outside micrometer, 3 positions 120° apart", "Micrometer 50–75 mm", "major"),
    ("DEMO-BORE", "Bore diameter", "variable", "mm", "Bore gauge at both faces", "Bore gauge 50–100 mm", "major"),
    ("DEMO-LEN", "Overall length", "variable", "mm", "Vernier / height gauge", "Vernier 0–600 mm", "minor"),
    ("DEMO-HARD-HB", "Hardness (Brinell)", "variable", "HB", "Brinell 10/3000 on a prepared flat", "Brinell tester", "major"),
    ("DEMO-RA", "Surface roughness Ra", "variable", "µm", "Surface roughness tester, 4 mm cut-off", "Roughness tester", "minor"),
    ("DEMO-SENSE", "Sensing distance (nominal 8 mm, Fe 360 target)", "variable", "mm", "Sensor test jig, approach axial", "Sensor jig SJ-01", "major"),
    ("DEMO-SHAFT", "Output shaft diameter", "variable", "mm", "Outside micrometer", "Micrometer 25–50 mm", "major"),
    ("DEMO-LEAK", "Pressure / leak test at 1.5x working pressure", "attribute", None, "Hold 5 min on the hydraulic test bench — no drop, no seepage", "Test bench HTB-2", "critical"),
    ("DEMO-FUNC", "Functional test", "attribute", None, "Powered test as per data sheet", None, "major"),
    ("DEMO-THREAD", "Thread check (go / no-go)", "attribute", None, "Thread ring / plug gauge", "Thread gauges", "minor"),
    ("DEMO-VIS", "Visual — damage, rust, finish", "attribute", None, "Visual under 500 lux", None, "minor"),
    ("DEMO-MARK", "Marking, make & part number", "attribute", None, "Compare with PO and data sheet", None, "minor"),
    ("DEMO-MTC", "Mill test certificate — chemistry & mechanical", "attribute", None, "Verify MTC values vs IS 2062 / EN8 limits and heat number", None, "critical"),
]

DEFECT_CODES = [
    ("DEMO-D-DIM", "Dimension out of tolerance", "dimensional"),
    ("DEMO-D-SURF", "Surface damage / rust / dents", "surface"),
    ("DEMO-D-FUNC", "Functional failure on test", "functional"),
    ("DEMO-D-MTC", "Test certificate missing or not matching", "documentation"),
    ("DEMO-D-WELD", "Weld porosity / undercut", "assembly"),
    ("DEMO-D-LEAK", "Leakage at pressure test", "functional"),
    ("DEMO-D-MAT", "Wrong material grade", "material"),
]


def seed_masters(demo):
    """Characteristics and defect codes (Quality › Masters); disposition codes are seeded by the app."""
    from app.modules.quality.models.characteristic import QualityCharacteristic
    from app.modules.quality.models.masters import QualityDefectCode, QualityDispositionCode
    qm = _qm(demo)
    chars = {}
    for code, name, ctype, unit, method, gauge, cls in CHARACTERISTICS:
        row = demo.db.query(QualityCharacteristic).filter(QualityCharacteristic.code == code).first()
        chars[code] = {"id": row.id, "code": code} if row else demo.call("POST", "/quality/masters/characteristics", qm, json={
            "code": code, "name": f"{LABEL} {name}", "char_type": ctype, "unit": unit, "method": method, "gauge_type": gauge,
            "classification": cls, "description": f"{LABEL} characteristic for rail-machine bought-out and machined parts."})
    defects = {}
    for code, name, cat in DEFECT_CODES:
        row = demo.db.query(QualityDefectCode).filter(QualityDefectCode.code == code).first()
        defects[code] = {"id": row.id, "code": code} if row else demo.call("POST", "/quality/masters/defect-codes", qm, json={
            "code": code, "name": f"{LABEL} {name}", "category": cat})
    demo.call("GET", "/quality/masters/disposition-codes", qm)  # seeds the five standard ones on a fresh DB
    demo.db.expire_all()
    dispositions = {d.disposition_type: d.id for d in demo.db.query(QualityDispositionCode).filter(QualityDispositionCode.is_active.is_(True)).all()}
    demo.data["quality_masters"] = {"characteristics": chars, "defect_codes": defects, "dispositions": dispositions}
    demo.note("quality", f"{len(chars)} characteristics, {len(defects)} defect codes, {len(dispositions)} disposition types")


def seed_standards_and_documents(demo):
    """Reference standards and controlled quality documents."""
    from app.modules.quality.models.quality_standard import QualityStandard
    qm = _qm(demo)
    out = {}
    for code, title, cat, desc in [
        ("DEMO IS 2062:2011", "Hot rolled medium & high tensile structural steel", "Material", "Chassis plate and sections (E250 BR)."),
        ("DEMO EN 15746-2", "Railway applications — Road-rail machines: general safety requirements", "Product safety", "Design and acceptance basis for RRV-8W."),
        ("DEMO ISO 2859-1", "Sampling procedures for inspection by attributes (AQL)", "Sampling", "Basis of the AQL tables in Quality › Masters."),
        ("DEMO RDSO QAP-RRV", "RDSO quality assurance plan for rail-cum-road vehicles", "Customer / RDSO", "Stage and final inspection points agreed with RDSO."),
    ]:
        row = demo.db.query(QualityStandard).filter(QualityStandard.standard_code == code).first()
        out[code] = {"id": row.id} if row else demo.call("POST", "/quality/standards", qm, json={
            "standard_code": code, "title": f"{LABEL} {title}", "category": cat, "description": f"{LABEL} {desc}",
            "effective_date": str(demo.today - timedelta(days=400)), "status": "active"})
    demo.data["quality_standards"] = out
    docs = []
    for dtype, title, ver, std, fname in [
        ("sop", "Incoming inspection procedure QP-07", "Rev 3", None, "QP-07-incoming-inspection.pdf"),
        ("specification", "Quality assurance plan — RRV-8W", "Rev 1", "DEMO RDSO QAP-RRV", "QAP-RRV-8W.pdf"),
        ("certificate", "ISO 9001:2015 certificate — Unit 1", "2025–2028", None, "ISO-9001-certificate.pdf"),
    ]:
        docs += demo.call("POST", "/quality/documents", qm, data={
            "doc_type": dtype, "title": f"{LABEL} {title}", "version": ver,
            **({"linked_standard_id": str(out[std]["id"])} if std else {}),
            "description": f"{LABEL} controlled document."}, files=[("files", demo.pdf(f"{LABEL}-{fname}"))])
    demo.data["quality_documents"] = docs
    demo.note("quality", f"{len(out)} standards, {len(docs)} quality documents")


# ── Inspection plans ──────────────────────────────────────────────────────

# item code → (type, aql, [(char code, nominal, min, max, class override)])
PLANS = {
    ("DEMO-MEC-BRG-22216", "incoming"): (1.0, [("DEMO-BORE", 80.0, 79.985, 80.0, None), ("DEMO-OD", 140.0, 139.982, 140.0, None),
                                             ("DEMO-MARK", None, None, None, None), ("DEMO-VIS", None, None, None, None)]),
    ("DEMO-ELE-PROX-M18", "incoming"): (1.0, [("DEMO-SENSE", 8.0, 7.2, 8.8, None), ("DEMO-FUNC", None, None, None, None),
                                            ("DEMO-THREAD", None, None, None, None), ("DEMO-MARK", None, None, None, None)]),
    ("DEMO-RM-EN8-RD-60", "incoming"): (2.5, [("DEMO-MTC", None, None, None, None), ("DEMO-OD", 60.0, 59.5, 61.0, None),
                                            ("DEMO-HARD-HB", 228.0, 201.0, 255.0, None), ("DEMO-VIS", None, None, None, None)]),
    ("DEMO-HYD-MOTOR-ORB200", "incoming"): (1.0, [("DEMO-LEAK", None, None, None, None), ("DEMO-SHAFT", 32.0, 31.975, 32.0, None),
                                                ("DEMO-MARK", None, None, None, None), ("DEMO-VIS", None, None, None, None)]),
    ("DEMO-RM-EN8-RD-60", "job_work"): (1.0, [("DEMO-OD", 55.0, 54.97, 55.0, "critical"), ("DEMO-LEN", 420.0, 419.5, 420.5, None),
                                            ("DEMO-RA", 1.2, 0.0, 1.6, None), ("DEMO-VIS", None, None, None, None)]),
    ("DEMO-HYD-PUMP-GP28", "incoming"): (1.0, [("DEMO-LEAK", None, None, None, None), ("DEMO-FUNC", None, None, None, None),
                                             ("DEMO-MARK", None, None, None, None)]),
    ("DEMO-HYD-DCV-43", "incoming"): (1.0, [("DEMO-FUNC", None, None, None, None), ("DEMO-LEAK", None, None, None, None)]),
}
PENDING_PLAN = ("DEMO-HYD-PUMP-GP28", "incoming")
DRAFT_PLAN = ("DEMO-HYD-DCV-43", "incoming")


def create_plan(demo, code, itype):
    """One inspection plan (draft) by the Quality head; reused if it exists."""
    from app.modules.quality.models.inspection_plan import QualityInspectionPlan
    item = _item(demo, code)
    row = demo.db.query(QualityInspectionPlan).filter(
        QualityInspectionPlan.item_id == item["id"], QualityInspectionPlan.inspection_type == itype,
        QualityInspectionPlan.status.in_(("draft", "pending_approval", "approved")), QualityInspectionPlan.is_deleted == False).first()  # noqa: E712
    if row:
        return demo.call("GET", f"/quality/inspection-plans/{row.id}", _qm(demo))
    aql, lines = PLANS[(code, itype)]
    chars = demo.data["quality_masters"]["characteristics"]
    return demo.call("POST", "/quality/inspection-plans", _qm(demo), json={
        "item_id": item["id"], "inspection_type": itype, "title": f"{LABEL} {itype.replace('_', ' ')} inspection — {item['name']}",
        "sampling_type": "aql", "aql": aql, "inspection_level": "II", "remarks": f"{LABEL} as per QP-07 / QAP-RRV-8W.",
        "lines": [{"characteristic_id": chars[c]["id"], "sequence": (i + 1) * 10, "nominal": nom, "min_value": lo, "max_value": hi,
                   "classification": cls} for i, (c, nom, lo, hi, cls) in enumerate(lines)]})


def seed_plans(demo):
    qm = _qm(demo)
    plans = {}
    for key in PLANS:
        plan = create_plan(demo, *key)
        if key == DRAFT_PLAN or plan["status"] != "draft":
            pass
        elif key == PENDING_PLAN:
            plan = demo.call("POST", f"/quality/inspection-plans/{plan['id']}/submit", qm)
        else:
            plan = demo.call("POST", f"/quality/inspection-plans/{plan['id']}/approve", qm)
        plans[f"{key[0]}:{key[1]}"] = plan
    demo.data["inspection_plans"] = plans
    demo.note("quality", "plans: " + ", ".join(f"{p['plan_number']}={p['status']}" for p in plans.values()))


# ── Inspection lots ───────────────────────────────────────────────────────

def _values(res, n_bad=0):
    """Measured values for a variable result: nominal-ish, with n_bad below min."""
    n = max(1, min(res["sample_size"] or 1, 8))
    lo, hi, nom = res["min_value"], res["max_value"], res["nominal"]
    if lo is not None and hi is not None:
        mid, span = (lo + hi) / 2, (hi - lo) / 6        # readings spread over the middle third of the band
    else:
        mid, span = (nom if nom is not None else (lo if lo is not None else hi or 0)), 0
    vals = [round(mid + span * ((i % 3) - 1), 4) for i in range(n)]
    for i in range(min(n_bad, n)):
        vals[i] = round((lo if lo is not None else mid) - max(span, 0.1) * 2, 4)
    return vals


def record_lot(demo, lot, *, fail=None, partial=False):
    """Inspector records every (or, partial=True, only the first half) result.
    `fail` = {characteristic code prefix → (bad count, defect code)}."""
    fail = fail or {}
    defects = demo.data["quality_masters"]["defect_codes"]
    chars = {v["id"]: k for k, v in demo.data["quality_masters"]["characteristics"].items()}
    rows = lot["results"][: max(1, len(lot["results"]) // 2)] if partial else lot["results"]
    entries = []
    for res in rows:
        code = chars.get(res["characteristic_id"], "")
        bad, defect = fail.get(code, (0, None))
        e = {"result_id": res["id"], "remarks": f"{LABEL} checked on the receipt sample"}
        if res["char_type"] == "variable":
            e["measured_values"] = _values(res, bad)
        else:
            e["defects_found"] = bad
        if bad:
            e["defect_code_id"] = defects[defect]["id"]
        entries.append(e)
    return demo.call("POST", f"/quality/inspection-lots/{lot['id']}/results", _qi(demo), json={"entries": entries})


def _lot_for(demo, *, grn_item_id=None, source_type=None, source_id=None):
    from app.modules.quality.models.inspection_lot import QualityInspectionLot
    q = demo.db.query(QualityInspectionLot)
    q = q.filter(QualityInspectionLot.grn_item_id == grn_item_id) if grn_item_id else \
        q.filter(QualityInspectionLot.source_type == source_type, QualityInspectionLot.source_id == source_id)
    row = q.order_by(QualityInspectionLot.id.desc()).first()
    return demo.call("GET", f"/quality/inspection-lots/{row.id}", _qm(demo)) if row else None


def _start(demo, lot):
    qi = _qi(demo)
    demo.call("POST", f"/quality/inspection-lots/{lot['id']}/assign", _qm(demo), json={"user_id": qi.id})
    return demo.call("POST", f"/quality/inspection-lots/{lot['id']}/start", qi)


def _fai_of(demo, lot):
    from app.modules.quality.models.first_article import QualityFirstArticle
    row = demo.db.query(QualityFirstArticle).filter(QualityFirstArticle.lot_id == lot["id"]).first()
    return row.id if row else None


def seed_grn_lots(demo):
    """The four incoming (first-article) lots raised by the p2p GRN."""
    grn = (demo.data.get("grns") or {}).get("in_quality")
    if not grn:
        demo.note("quality", "no grns['in_quality'] from the p2p seeder — incoming lots skipped")
        return
    qm, qi = _qm(demo), _qi(demo)
    by_name = {it["item_name"]: it for it in grn["items"]}
    lots = demo.data["inspection_lots"]

    def lot_of(code):
        line = by_name.get(_item(demo, code)["name"])
        return _lot_for(demo, grn_item_id=line["id"]) if line else None

    # Bearing — accepted, first article approved (vendor → Approved on the AVL).
    lot = lot_of("DEMO-MEC-BRG-22216")
    if lot and lot["status"] == "created":
        _start(demo, lot)
        record_lot(demo, demo.call("GET", f"/quality/inspection-lots/{lot['id']}", qi))
        demo.call("POST", f"/quality/inspection-lots/{lot['id']}/submit-results", qi)
        lot = demo.call("POST", f"/quality/inspection-lots/{lot['id']}/decision", qm, json={
            "decision": "accept", "remarks": f"{LABEL} All dimensions within ISO 492 normal tolerance; make & marking as PO."})
        fai = _fai_of(demo, lot)
        if fai:
            demo.call("POST", f"/quality/first-articles/{fai}/decision", qm, json={
                "approve": True, "remarks": f"{LABEL} First supply from this vendor conforms — released for regular receipts."})
    lots["bearing"] = lot

    # Proximity sensors — 2 of 20 short sensing distance → partial rejection, NCR, FAI rejected.
    lot = lot_of("DEMO-ELE-PROX-M18")
    if lot and lot["status"] == "created":
        _start(demo, lot)
        record_lot(demo, demo.call("GET", f"/quality/inspection-lots/{lot['id']}", qi), fail={"DEMO-SENSE": (2, "DEMO-D-FUNC")})
        demo.call("POST", f"/quality/inspection-lots/{lot['id']}/submit-results", qi)
        lot = demo.call("POST", f"/quality/inspection-lots/{lot['id']}/decision", qm, json={
            "decision": "partial", "accepted_qty": 18, "rejected_qty": 2,
            "remarks": f"{LABEL} 2 sensors switch at < 6.5 mm — segregated, NCR raised for return to vendor."})
        fai = _fai_of(demo, lot)
        if fai:
            _try(demo, "quality", "sensor FAI rejection", "POST", f"/quality/first-articles/{fai}/decision", qm, json={
                "approve": False, "remarks": f"{LABEL} Sensing distance below data sheet on 2 pieces — vendor to submit a fresh first article."})
    lots["sensor"] = lot

    # EN8 bar — in inspection, MTC received, half the results recorded.
    lot = lot_of("DEMO-RM-EN8-RD-60")
    if lot and lot["status"] == "created":
        _start(demo, lot)
        demo.call("POST", f"/quality/inspection-lots/{lot['id']}/test-certificate", qi, json={
            "received": True, "reference": f"{LABEL} MTC 24/EN8/5531, heat H-77812"})
        lot = record_lot(demo, demo.call("GET", f"/quality/inspection-lots/{lot['id']}", qi), partial=True)
    lots["en8"] = lot

    # Orbital motors — created and assigned, waiting for the test bench.
    lot = lot_of("DEMO-HYD-MOTOR-ORB200")
    if lot and lot["status"] == "created":
        lot = demo.call("POST", f"/quality/inspection-lots/{lot['id']}/assign", qm, json={"user_id": qi.id})
    lots["motor"] = lot
    demo.note("quality", "GRN lots: " + ", ".join(f"{k} {v['lot_number']}={v['status']}" for k, v in lots.items() if v))


def seed_job_work_lot(demo):
    """Job-work lot from the machined EN8 blanks returned by the vendor (store seeder)."""
    ret = (demo.data.get("returns") or {}).get("job_work")
    if not ret:
        demo.note("quality", "no returns['job_work'] from the store seeder — job-work lot skipped")
        return
    lot = _lot_for(demo, source_type="material_return", source_id=ret["id"])
    if not lot:
        demo.note("quality", f"return {ret['return_number']} raised no job-work lot (item not inspection-controlled?) — skipped")
        return
    qi = _qi(demo)
    if lot["status"] == "created":
        _start(demo, lot)
        record_lot(demo, demo.call("GET", f"/quality/inspection-lots/{lot['id']}", qi))
        lot = demo.call("POST", f"/quality/inspection-lots/{lot['id']}/submit-results", qi)
    demo.data["inspection_lots"]["job_work"] = lot
    demo.note("quality", f"job-work lot {lot['lot_number']} ({lot['inspection_type']}) = {lot['status']} — waiting for the usage decision")


# ── NCRs ──────────────────────────────────────────────────────────────────

def _ncr_from_lot(demo, lot):
    from app.modules.quality.models.ncr import QualityNcr
    row = demo.db.query(QualityNcr).filter(QualityNcr.lot_id == lot["id"]).order_by(QualityNcr.id).first()
    return demo.call("GET", f"/quality/ncr/{row.id}", _qm(demo)) if row else None


def _engine_decide(demo, entity_type, entity_id, user, comment):
    st = demo.call("GET", f"/approvals/entity/{entity_type}/{entity_id}", user)
    cur = (st or {}).get("current")
    if not cur or cur.get("status") != "pending":
        return False
    return _try(demo, "quality", f"{entity_type} #{entity_id} approval by {user.name}", "POST",
                f"/approvals/requests/{cur['id']}/decide", user, json={"decision": "approve", "comment": comment}) is not None


def seed_ncrs(demo):
    qm = _qm(demo)
    m = demo.data["quality_masters"]
    ncrs = demo.data["ncrs"]

    sensor_lot = demo.data["inspection_lots"].get("sensor")
    ncr = _ncr_from_lot(demo, sensor_lot) if sensor_lot else None
    if ncr and ncr["status"] == "open":
        ncr = demo.call("POST", f"/quality/ncr/{ncr['id']}/propose-disposition", qm, json={
            "disposition_code_id": next(d.id for d in _disp_rows(demo) if d.disposition_type == "return_to_vendor"),
            "remarks": f"{LABEL} Return the 2 sensors for replacement free of cost; debit note if not replaced in 7 days."})
        ncr = demo.call("POST", f"/quality/ncr/{ncr['id']}/approve-disposition", qm, json={
            "remarks": f"{LABEL} Vendor non-conformance confirmed on the test jig."})
        _engine_decide(demo, "quality_ncr", ncr["id"], _p(demo)["purchase_manager"],
                       f"{LABEL} Vendor informed; replacement agreed against the same PO.")
        ncr = demo.call("GET", f"/quality/ncr/{ncr['id']}", qm)
        if ncr["status"] == "disposition_decided":
            ncr = demo.call("POST", f"/quality/ncr/{ncr['id']}/action", qm, json={
                "action_reference": f"{LABEL}-DN-{demo.today:%y%m%d}-01", "remarks": f"{LABEL} 2 sensors dispatched back with debit note."})
            ncr = demo.call("POST", f"/quality/ncr/{ncr['id']}/verify", qm, json={"remarks": f"{LABEL} Vendor acknowledged receipt of the rejected sensors."})
    if ncr:
        ncrs["sensor_rtv"] = ncr
    elif sensor_lot:
        demo.note("quality", "sensor lot raised no NCR — sensor_rtv skipped")

    ncr = demo.call("POST", "/quality/ncr", qm, json={
        "source": "in_process", "severity": "major", "item_name": f"{LABEL} RRV-8W chassis long member LH (weldment)",
        "item_code": "DEMO-WLD-CH-LH", "quantity": 1, "uom": "NOS", "defect_code_id": m["defect_codes"]["DEMO-D-WELD"]["id"],
        "source_reference": demo.data.get("issues", {}).get("work_order", {}).get("project_or_work_order") or f"{LABEL} WO-RRV8W-001",
        "description": f"{LABEL} Porosity cluster ~40 mm long on fillet weld W12 (bracket to long member), found at stage inspection.",
        "root_cause": "Wire stick-out too long, shielding gas flow low at the end of shift.",
        "ncr_date": str(demo.today)})
    ncr = demo.call("POST", f"/quality/ncr/{ncr['id']}/propose-disposition", qm, json={
        "disposition_code_id": next(d.id for d in _disp_rows(demo) if d.disposition_type == "rework"),
        "remarks": f"{LABEL} Gouge out and re-weld W12 per WPS-07, DPT after rework."})
    ncrs["weld_rework"] = ncr

    ncrs["paint_docs"] = demo.call("POST", "/quality/ncr", qm, json={
        "source": "incoming", "severity": "minor", "item_id": _item(demo, "DEMO-PNT-PU-RAL1003")["id"], "quantity": 20,
        "vendor_name": demo.data["vendors"]["steel"]["name"], "defect_code_id": m["defect_codes"]["DEMO-D-MTC"]["id"],
        "description": f"{LABEL} PU paint batch received without batch certificate of analysis (shade / DFT).", "ncr_date": str(demo.today)})
    demo.note("quality", "NCRs: " + ", ".join(f"{k} {v['ncr_number']}={v['status']}" for k, v in ncrs.items()))


def _disp_rows(demo):
    from app.modules.quality.models.masters import QualityDispositionCode
    return demo.db.query(QualityDispositionCode).filter(QualityDispositionCode.is_active.is_(True)).all()


# ── CAPA ──────────────────────────────────────────────────────────────────

def seed_capas(demo):
    qm, qi, pm = _qm(demo), _qi(demo), _p(demo)["purchase_manager"]
    capas = demo.data["capas"]
    m = demo.data["quality_masters"]
    ncr = demo.data["ncrs"].get("sensor_rtv")
    capa = _existing_capa(demo, ncr) if ncr else None
    if not capa:
        capa = demo.call("POST", "/quality/capa", qm, json={
            "action_type": "corrective", "severity": "major", "title": f"{LABEL} Proximity sensors short of rated sensing distance",
            "ncr_ids": [ncr["id"]] if ncr else [], "item_id": _item(demo, "DEMO-ELE-PROX-M18")["id"],
            "vendor_name": demo.data["vendors"]["electricals"]["name"], "defect_code_id": m["defect_codes"]["DEMO-D-FUNC"]["id"],
            "responsible_user_id": qm.id, "due_date": str(demo.today + timedelta(days=30)),
            "problem_statement": f"{LABEL} 2 of 20 M18 sensors switch at < 6.5 mm against 8 mm rated (Fe 360 target)."})
    if capa["status"] in ("open", "reopened"):
        demo.call("PATCH", f"/quality/capa/{capa['id']}", qm, json={"responsible_user_id": qm.id,
                                                                  "due_date": str(demo.today + timedelta(days=30))})
        demo.call("PUT", f"/quality/capa/{capa['id']}/team", qm, json={"members": [
            {"user_id": qm.id, "role": "leader", "department": "Quality"},
            {"user_id": qi.id, "role": "member", "department": "Quality"},
            {"user_id": pm.id, "role": "member", "department": "Purchase"}]})
        demo.call("PATCH", f"/quality/capa/{capa['id']}", qm, json={
            "problem_statement": f"{LABEL} 2 of 20 M18 sensors (PO for RRV-8W control panel) switch at < 6.5 mm against 8 mm rated.",
            "containment_actions": f"{LABEL} Balance 18 sensors re-tested 100% on the jig; panel builds use only tested sensors.",
            "root_cause_method": "why_why",
            "why_analysis": ["Sensors switched early on our jig", "Vendor ships mixed lots from two factories",
                             "Vendor has no outgoing sensing-distance test", "Vendor's QAP covers visual check only"],
            "root_cause": f"{LABEL} Vendor has no outgoing functional test; mixed lots reach us untested."})
        capa = demo.call("POST", f"/quality/capa/{capa['id']}/advance", qm)
        demo.call("POST", f"/quality/capa/{capa['id']}/actions", qm, json={
            "kind": "corrective", "description": f"{LABEL} Vendor to add 100% sensing-distance test with test report per lot.",
            "owner_id": pm.id, "due_date": str(demo.today + timedelta(days=21))})
        demo.call("POST", f"/quality/capa/{capa['id']}/actions", qm, json={
            "kind": "preventive", "prevention_type": "update_inspection_plan",
            "description": f"{LABEL} Add test-report check to the incoming plan for sensors.",
            "owner_id": qm.id, "due_date": str(demo.today + timedelta(days=14))})
        capa = _try(demo, "quality", "CAPA advance to actions in progress", "POST", f"/quality/capa/{capa['id']}/advance", qm) or \
            demo.call("GET", f"/quality/capa/{capa['id']}", qm)
    capas["sensor_vendor"] = capa

    capas["audit_preventive"] = demo.call("POST", "/quality/capa", qm, json={
        "action_type": "preventive", "severity": "minor", "title": f"{LABEL} Calibration status labels missing on 3 shop-floor gauges",
        "audit_reference": f"{LABEL} Internal audit IA-2026-03, finding 4", "responsible_user_id": qm.id,
        "due_date": str(demo.today + timedelta(days=45)),
        "problem_statement": f"{LABEL} Vernier V-14, micrometer M-07 and bore gauge B-02 had no calibration due-date label."})
    demo.note("quality", "CAPA: " + ", ".join(f"{k} {v['capa_number']}={v['status']}" for k, v in capas.items()))


def _existing_capa(demo, ncr):
    """A CAPA the app already opened for this NCR (repeat-defect trigger), if any."""
    from app.modules.quality.models.capa import QualityCapa
    from app.modules.quality.services.capa import covering_capas
    from app.modules.quality.models.ncr import QualityNcr
    row = demo.db.get(QualityNcr, ncr["id"])
    found = covering_capas(demo.db, row) if row else []
    return demo.call("GET", f"/quality/capa/{found[0].id}", _qm(demo)) if found else None


# ── Customer complaints ───────────────────────────────────────────────────

def seed_complaints(demo):
    qm = _qm(demo)
    cust = demo.data.get("customers") or {}
    out = demo.data["complaints"]

    def create(key, org_key, **body):
        org = cust.get(org_key) or {}
        out[key] = demo.call("POST", "/quality/complaints", qm, json={
            "customer_name": org.get("name") or f"{LABEL} Customer", "customer_org_id": org.get("id"),
            "contact_person": (org.get("contacts") or [{}])[0].get("name"), "owner_id": qm.id, **body})
        return out[key]

    c = create("hose_leak", "northern_railway", source="site_visit", source_reference=f"{LABEL} Site visit report SV-114",
               item_id=_item(demo, "DEMO-HYD-HOSE-12")["id"], serial_number=f"{LABEL}-RRV8W-0007", quantity_affected=2,
               category="product_failure", severity="major", complaint_date=str(demo.today - timedelta(days=3)),
               description=f"{LABEL} Hydraulic hose on the rail-gear lift cylinder weeping at the crimp after 300 h; machine stopped twice in block.")
    _try(demo, "quality", "complaint investigation", "POST", f"/quality/complaints/{c['id']}/investigate", qm, json={"owner_id": qm.id})
    out["hose_leak"] = demo.call("GET", f"/quality/complaints/{c['id']}", qm)

    c = create("manual_missing", "dmrc", source="email", source_reference=f"{LABEL} DMRC letter TRK/2026/552", category="documentation",
               severity="minor", item_name=f"{LABEL} Operation & maintenance manual", description=f"{LABEL} O&M manual not supplied with the machine.")
    out["manual_missing"] = demo.call("POST", f"/quality/complaints/{c['id']}/reject", qm, json={
        "reason": f"{LABEL} Manual was handed over with the machine — signed delivery note DN-2026-118 (copy re-sent)."})

    create("paint_fade", "lt_metro", source="phone", category="other", severity="minor",
           item_id=_item(demo, "DEMO-PNT-PU-RAL1003")["id"],
           description=f"{LABEL} Signal yellow fading on the cab roof after one monsoon (machine at Uppal depot).")
    demo.note("quality", "complaints: " + ", ".join(f"{k} {v['complaint_number']}={v['status']}" for k, v in out.items()))


# ── Supplier quality ──────────────────────────────────────────────────────

def seed_supplier_quality(demo):
    qm = _qm(demo)
    vendors = demo.data["vendors"]
    from app.modules.quality.models.supplier_quality import QualityApprovedVendor
    from app.modules.quality.services.supplier_quality import vendor_key
    avl = {}

    def row(code, vkey):
        item = _item(demo, code)
        r = demo.db.query(QualityApprovedVendor).filter(QualityApprovedVendor.item_id == item["id"],
                                                        QualityApprovedVendor.vendor_key == vendor_key(vendors[vkey]["name"])).first()
        if r:
            return demo.call("GET", f"/quality/supplier-quality/avl/{r.id}", qm)
        return demo.call("POST", "/quality/supplier-quality/avl", qm, json={
            "item_id": item["id"], "vendor_name": vendors[vkey]["name"], "vendor_id": vendors[vkey]["id"],
            "remarks": f"{LABEL} added to the approved vendor list"})

    a = row("DEMO-RM-ISMC-100", "steel")
    if a["status"] == "trial":
        a = demo.call("POST", f"/quality/supplier-quality/avl/{a['id']}/approve", qm, json={
            "reason": f"{LABEL} Trial order of 2 t accepted; mill TCs from SAIL Bhilai verified."})
    avl["ismc_steel"] = a
    avl["seal_hydraulics"] = row("DEMO-HYD-SEAL-KIT-63", "hydraulics")
    a = row("DEMO-ELE-PROX-M18", "electricals")
    if a["status"] in ("trial", "approved"):
        a = _try(demo, "quality", "AVL watch", "POST", f"/quality/supplier-quality/avl/{a['id']}/watch", qm, json={
            "reason": f"{LABEL} Partial rejection on first supply (sensing distance) — tightened inspection until 3 clean lots."}) or a
    avl["sensor_electricals"] = a
    demo.data["avl"] = avl

    _try(demo, "quality", "supplier ratings", "POST", "/quality/supplier-quality/ratings/run", qm, json={"period": f"{demo.today:%Y-%m}"})
    audit = demo.call("POST", "/quality/supplier-quality/audits", qm, json={
        "vendor_name": vendors["bearings"]["name"], "planned_date": str(demo.today - timedelta(days=12)),
        "scope": f"{LABEL} Storage, traceability and counterfeit-bearing controls", "auditor_id": qm.id})
    _try(demo, "quality", "vendor audit completion", "POST", f"/quality/supplier-quality/audits/{audit['id']}/complete", qm, json={
        "audit_date": str(demo.today - timedelta(days=10)), "score": 82, "result": "satisfactory",
        "findings": [{"type": "observation", "description": f"{LABEL} FIFO not followed in rack 3"}],
        "remarks": f"{LABEL} Authorised distributor certificate verified."})
    demo.call("POST", "/quality/supplier-quality/audits", qm, json={
        "vendor_name": vendors["hydraulics"]["name"], "planned_date": str(demo.today + timedelta(days=10)),
        "scope": f"{LABEL} Hose crimping process and pressure-test records (complaint follow-up)", "auditor_id": qm.id})
    demo.note("quality", "AVL: " + ", ".join(f"{k}={v['status']}" for k, v in avl.items()) + "; 2 vendor audits")


# ── Third-party inspection calls ──────────────────────────────────────────

def seed_inspection_calls(demo):
    qm = _qm(demo)
    order = (demo.data.get("sales_orders") or {})
    ref = next((o.get("order_number") or o.get("so_number") for o in order.values() if isinstance(o, dict)), None) \
        if isinstance(order, dict) else None
    ref = ref or f"{LABEL} NR/LKO/RRV/2026/07"
    cust = (demo.data.get("customers") or {}).get("northern_railway", {}).get("name") or f"{LABEL} Northern Railway"
    calls = demo.data["inspection_calls"]

    def call(key, code, qty, **extra):
        calls[key] = demo.call("POST", "/quality/inspection-calls", qm, json={
            "order_reference": ref, "customer_name": cust, "item_id": _item(demo, code)["id"], "quantity": qty,
            "agency": "rites", "requested_date": str(demo.today),
            "remarks": f"{LABEL} Stage inspection as per the RDSO QAP.", **extra})
        return calls[key]

    call("raised", "DEMO-MEC-WHEEL-430", 4)
    c = call("scheduled", "DEMO-MEC-ENGINE-74KW", 1)
    calls["scheduled"] = demo.call("POST", f"/quality/inspection-calls/{c['id']}/schedule", qm, json={
        "call_date": str(demo.today + timedelta(days=3)), "inspector_name": f"{LABEL} RITES IE — Sh. A. K. Verma"})
    c = call("accepted", "DEMO-HYD-PUMP-GP28", 2)
    demo.call("POST", f"/quality/inspection-calls/{c['id']}/schedule", qm, json={"call_date": str(demo.today), "inspector_name": f"{LABEL} RITES IE"})
    calls["accepted"] = _try(demo, "quality", "inspection call result", "POST", f"/quality/inspection-calls/{c['id']}/result", qm, json={
        "result": "accepted", "certificate_number": f"{LABEL}-RITES-IC-55021", "result_date": str(demo.today),
        "inspector_name": f"{LABEL} RITES IE", "remarks": f"{LABEL} Witnessed pressure test at 280 bar — accepted."}) or c
    demo.note("quality", "inspection calls: " + ", ".join(f"{k} {v['call_number']}={v['status']}" for k, v in calls.items()))


def _refresh(demo):
    qm = _qm(demo)
    for k, v in list(demo.data["inspection_lots"].items()):
        if v:
            demo.data["inspection_lots"][k] = demo.call("GET", f"/quality/inspection-lots/{v['id']}", qm)
    for k, v in list(demo.data["ncrs"].items()):
        demo.data["ncrs"][k] = demo.call("GET", f"/quality/ncr/{v['id']}", qm)


def seed(demo) -> None:
    for key in ("inspection_lots", "ncrs", "capas", "complaints", "inspection_calls"):
        demo.data.setdefault(key, {})
    seed_masters(demo)
    seed_standards_and_documents(demo)
    seed_plans(demo)
    seed_grn_lots(demo)
    seed_job_work_lot(demo)
    seed_ncrs(demo)
    seed_capas(demo)
    seed_complaints(demo)
    seed_supplier_quality(demo)
    seed_inspection_calls(demo)
    _refresh(demo)
    demo.note("quality", "checklists have no API (model only) — not seeded")
