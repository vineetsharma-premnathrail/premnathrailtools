"""Design: design requests, drawings with four-eyes release, BOM revisions per product, ECR → ECN, customer submissions, library.

Everything goes through the real Design API as the right demo person, so
DRQ / GA / BOM / ECR / ECN / TRN numbers, the Design rules (author ≠ checker
≠ approver) and the central approval engine (Organization › Approval
Workflows: "Drawing / document revision release", "BOM revision release",
"Engineering change notice") are real. Re-running on a database that already
has the DEMO design requests only rebuilds the registry keys.

Who does what:
  design_engineer   author of the mechanical drawings and the BOMs
  design_checker    checker (first signature) — "DEMO Design Checker" role
  design_head       approver / releaser, accepts requests, chairs the change board
  electrical_engineer / hydraulic_engineer  author E/H/P drawings in the Design
                    register; electrical_head / hydraulic_head release them
                    (owner decision 2026-10-07 — E/H/P drawings are released by the
                    discipline head; Design keeps the numbering and revisions)
  bd, rnd_head      raise design requests; bd revises a requirement
  production / quality / purchase managers  raise ECRs, vote on the board,
                    acknowledge released ECNs (production, store)
  demo.me           one HRE-150 calculation waits for YOUR approval
                    (Design › Documents, or My Approvals)

Design team (Design › Settings) is NOT configured: on a database with no team
every Design user acts as head; turning the team on would turn every real
Design user into a viewer, so it is left as a deliberate Settings step.

Records left at different stages:
  requests   in progress (RRV-8W) · accepted with a revised requirement not yet
             reviewed (RGM-16) · open & overdue (TIC-01) · on hold, waiting on the
             requester (HRE-150) · completed (CW-BOX) · cancelled
  drawings   released · released then revised under an ECN (R0 superseded) ·
             in review · in approval (E/H/P, with the Electrical head) · in approval
             with demo.me · returned by the checker · customer-rejected + next
             revision in draft · approved & waiting for the customer (overdue
             transmittal) · draft · obsolete
  BOMs       sub-assembly BOMs released (multi-level) · RRV-8W R0 superseded,
             R1 released under the ECN, R2 draft (with a new-item request line) ·
             RGM-16 R1 in review · TIC-01 R0 in approval · CW-BOX R0 draft with a
             new-item request · HRE-150 R0 released + R1 draft
  ECR/ECN    ECR approved → ECN implemented, 2 of 4 departments acknowledged ·
             ECR waiting for the board · ECR rejected · ECR open · legacy ECN
             submitted (with the Design head) · legacy ECN draft
  customer   TRN approved with comments (open action item) → GA released ·
             TRN rejected · TRN sent, no answer, past the response date
  library    standards (RDSO / IS / EN / ISO / IEC), approved makes, standard
             parts, a title-block template, a GA review checklist

demo.data keys set here:
  design_requests  dict key (rrv, rgm, tic, hre, cw, cab_ac) -> request dict from the API
  design_documents dict key -> document dict (detail) from the API:
                   rrv_ga, rrv_chassis, rrv_guidewheel, rrv_lift_arm, rrv_hyd_circuit,
                   rrv_wiring, rrv_panel, rgm_ga, rgm_carriage, tic_ga, tic_spec,
                   cw_bracket, hre_calc, hre_circuit, rrv_cab_old
  design_boms      dict code -> BOM dict (detail from the API) + convenience keys
                   "id", "bom_number", "product_code", "status" and "lines" (the
                   released — else the open — revision's lines: store_item_id,
                   item_code, item_name, quantity, uom, make_buy, document_id).
                   Codes: the five product codes (DEMO-RRV-8W, DEMO-RGM-16,
                   DEMO-TIC-01, DEMO-CW-BOX, DEMO-HRE-150) and the sub-assemblies
                   (DEMO-SA-HPU-RRV, DEMO-SA-EPNL-RRV, DEMO-SA-GWU-RRV).
  design_ecrs      dict key -> ECR dict;  design_ecns  dict key -> ECN dict
  design_submissions dict key -> customer submission (transmittal) dict
  design_library   {"standards": code -> standard dict, "checklist": GA review checklist dict}
  (+ people / product_items / subassembly_items from _engineering.py)
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL
from demo._engineering import (
    customer_id, customer_name, ensure_engineering, number_of, reply_requirement_shares, sales_order_for, upstream,
)

MOD = "design"


# ── small helpers ─────────────────────────────────────────────────────────

def _p(demo, key):
    return demo.data["people"][key]


def _item_id(demo, code):
    for reg in ("items", "subassembly_items", "product_items"):
        it = (demo.data.get(reg) or {}).get(code)
        if it:
            return it["id"]
    raise SystemExit(f"design seeder: item {code} isn't in the registry (foundation / _engineering didn't make it).")


def _upload(demo, user, rev_id, name):
    return demo.call("POST", f"/design/revisions/{rev_id}/files", user, files=[("files", demo.pdf(name))], data={"file_role": "primary"})


def _checklist_answers(doc):
    cl = doc.get("checklist") or {}
    return [{"checklist_item_id": i["id"], "result": "ok"} for i in cl.get("items") or []]


def _doc_get(demo, doc, user=None):
    return demo.call("GET", f"/design/documents/{doc['id']}", user or _p(demo, "design_head"))


def _bom_get(demo, bom, user=None):
    return demo.call("GET", f"/design/boms/{bom['id']}", user or _p(demo, "design_head"))


# ── Library ───────────────────────────────────────────────────────────────

STANDARDS = [
    ("RDSO", "RDSO/2019/CG-12", "Specification for Rail-cum-Road Vehicle for track maintenance", "Rev 2"),
    ("IS", "IS 2062:2011", "Hot rolled medium and high tensile structural steel", "2011"),
    ("EN", "EN 14033-1", "Railway applications — Track — Railbound construction and maintenance machines — Technical requirements for running", "2017"),
    ("ISO", "ISO 1219-1", "Fluid power systems and components — Graphical symbols and circuit diagrams", "2012"),
    ("IEC", "IEC 60077-1", "Railway applications — Electric equipment for rolling stock — General service conditions", "2017"),
    ("UIC", "UIC 505-1", "Railway transport stock — Rolling stock construction gauge", "2006"),
]

MAKES = [  # item code, make, part number, status
    ("DEMO-MEC-BRG-22216", "SKF", "22216 E/C3", "approved"),
    ("DEMO-MEC-BRG-22216", "FAG", "22216-E1-XL-C3", "approved"),
    ("DEMO-MEC-BRG-22216", "NBC", "22216 EAW33C3", "provisional"),
    ("DEMO-HYD-PUMP-GP28", "Bosch Rexroth", "AZPF-12-028RCB20MB", "approved"),
    ("DEMO-HYD-PUMP-GP28", "Parker", "PGP511A0280", "approved"),
    ("DEMO-HYD-DCV-43", "Bosch Rexroth", "4WE10J3X/CG24N9K4", "approved"),
    ("DEMO-ELE-PLC-CPU", "Siemens", "6ES7214-1AG40-0XB0", "approved"),
    ("DEMO-MEC-ENGINE-74KW", "Cummins", "QSF3.8 CEV-V", "approved"),
]


def seed_library(demo):
    """Standards, approved makes, standard parts, a template and the GA review checklist (Design head)."""
    head = _p(demo, "design_head")
    standards = {}
    for body, code, title, version in STANDARDS:
        standards[code] = demo.call("POST", "/design/library/standards", head, json={
            "body": body, "code": code, "title": f"{LABEL} {title}", "version": version, "is_current": True,
            "remarks": f"{LABEL} reference standard for RRV / track machine design."})
    rdso = standards["RDSO/2019/CG-12"]
    demo.call("POST", f"/design/library/standards/{rdso['id']}/file", head, files=[("file", demo.pdf("DEMO-RDSO-RRV-spec.pdf"))])
    for code, make, part, status in MAKES:
        demo.call("POST", "/design/library/approved-makes", head, json={
            "store_item_id": _item_id(demo, code), "make": make, "part_number": part, "status": status,
            "remarks": f"{LABEL} " + ("approved after type test" if status == "approved" else "trial order — pending field feedback")})
    for code, disc, std, note in (("DEMO-HWF-BOLT-M16X60", "mechanical", "IS 2062:2011", "Standard fastener for all bolted frame joints."),
                                  ("DEMO-MEC-BRG-22216", "mechanical", None, "Standard axle-box bearing for guide wheel units."),
                                  ("DEMO-HYD-HOSE-12", "hydraulic", "ISO 1219-1", "Standard 1/2 in pressure hose — 2SN, crimped ends.")):
        demo.call("POST", "/design/library/standard-parts", head, json={
            "store_item_id": _item_id(demo, code), "discipline": disc,
            "standard_id": standards[std]["id"] if std else None, "notes": f"{LABEL} {note}"})
    demo.call("POST", "/design/library/templates", head, data={
        "kind": "title_block", "name": f"{LABEL} A1 title block (PRT standard)", "description": "Title block with revision table and four-eyes signature boxes."},
        files=[("file", demo.pdf("DEMO-A1-title-block.pdf"))])
    checklist = demo.call("POST", "/design/library/checklists", head, json={
        "name": f"{LABEL} GA drawing review checklist", "document_type": "ga_drawing", "discipline": None, "is_active": True,
        "items": [{"text": t} for t in (
            "Overall dimensions within the RDSO moving dimensions (MMD / SOD)",
            "Kinematic envelope checked on curves and at full lift of the guide wheels",
            "Weight and axle-load table on the drawing",
            "Customer specification / tender clause references listed",
            "Title block, revision table and material notes complete")]})
    demo.data["design_library"] = {"standards": standards, "checklist": checklist}
    demo.note(MOD, f"library: {len(standards)} standards, {len(MAKES)} approved makes, 3 standard parts, 1 template, GA checklist")


# ── Design requests ───────────────────────────────────────────────────────

def seed_requests(demo):
    """Design requests from BD / R&D / internal, each left at a different stage."""
    t = demo.today
    head, bd, rnd = _p(demo, "design_head"), _p(demo, "bd"), _p(demo, "rnd_head")
    eng, checker = _p(demo, "design_engineer"), _p(demo, "design_checker")
    offers = upstream(demo, "technical_offers")
    reqs = {}

    def create(key, user, product_code, cust, **kw):
        so = sales_order_for(demo, product_code)
        refs = []
        if so:
            refs.append(f"Sales order {number_of(so)}")
        if offers:
            refs.append(f"Technical offer {number_of(offers[len(reqs) % len(offers)])}")
        text = kw.pop("requirement") + (f"\n\nReference: {', '.join(refs)}." if refs else "")
        payload = {"customer_id": customer_id(demo, cust), "requirement": text, **kw}
        reqs[key] = demo.call("POST", "/design/requests", user, json=payload)
        return reqs[key]

    def act(key, user, action, reason=None):
        reqs[key] = demo.call("POST", f"/design/requests/{reqs[key]['id']}/status", user, json={"action": action, "reason": reason})

    so_rrv = sales_order_for(demo, "DEMO-RRV-8W")
    create("rrv", bd, "DEMO-RRV-8W", "northern_railway", title=f"{LABEL} RRV-8W for Northern Railway — complete vehicle design",
           source="project" if so_rrv else "bd", priority="high", due_date=str(t + timedelta(days=35)), lead_designer_id=eng.id,
           requirement="Rail-cum-road vehicle, 8 wheels, 1676 mm BG with 1435 mm SG conversion kit. 74 kW CEV Stage V engine, "
                       "40 km/h on rail / 60 km/h on road, haulage 300 t on level track. Hydraulic rail guide wheels with "
                       "independent lift, 24 V DC electrics, PLC-based interlocks (road/rail mode), LED working lights.")
    act("rrv", head, "accept")
    act("rrv", head, "start")

    create("rgm", bd, "DEMO-RGM-16", "rvnl", title=f"{LABEL} RGM-16 stone carriage for RVNL corridor", source="bd", priority="high",
           due_date=str(t + timedelta(days=20)), lead_designer_id=eng.id,
           requirement="16-stone rail grinding machine, working speed 3–8 km/h, stone motors 22 kW each, spark arrestor and dust "
                       "extraction. Stone carriage to suit UIC 60 rail profile.")
    act("rgm", head, "accept")
    # BD revises the requirement after the customer's pre-bid meeting → "changed since your review".
    reqs["rgm"] = demo.call("POST", f"/design/requests/{reqs['rgm']['id']}/revise", bd, json={
        "requirement": reqs["rgm"]["requirement"] + "\n\nREVISED: customer also wants 60E1 profile templates and a water-mist "
                                                    "fire suppression system on the stone carriage.",
        "change_note": "Pre-bid meeting minutes: 60E1 profile + water-mist fire suppression added."})

    create("tic", rnd, "DEMO-TIC-01", "central_railway_workshop", title=f"{LABEL} TIC-01 sensor beam bracket — R&D hand-over",
           source="rnd", priority="medium", due_date=str(t - timedelta(days=6)),
           requirement="R&D prototype of the laser gauge sensor beam is validated. Design to make it production-ready: bracket "
                       "for 2 laser sensors + IMU, vibration isolation, IP67 enclosure, ±2 mm adjustment.")
    # Left open (not accepted) with its due date already gone → overdue.

    create("hre", bd, "DEMO-HRE-150", "lt_metro", title=f"{LABEL} HRE-150 re-railing set for L&T Metro depot", source="bd",
           priority="urgent", due_date=str(t + timedelta(days=10)), lead_designer_id=checker.id,
           requirement="150 t hydraulic re-railing equipment, 700 bar, traverse stroke 500 mm, for metro coaches (standard gauge). "
                       "Jacking points as per coach OEM drawing (to be provided by the customer).")
    act("hre", head, "accept")
    act("hre", head, "start")
    act("hre", head, "hold", "Waiting for the coach OEM's jacking-point drawing from L&T Metro.")
    reqs["hre"] = demo.call("POST", f"/design/requests/{reqs['hre']['id']}/waiting", head, json={
        "waiting_on": "requester", "note": "Need the coach OEM jacking-point drawing and the max permissible point load."})

    prod = _p(demo, "production_manager")
    create("cw", prod, "DEMO-CW-BOX", "ircon", title=f"{LABEL} CW-BOX tail lamp & coupler bracket (shop-floor feedback)",
           source="internal", priority="low", due_date=str(t - timedelta(days=12)), lead_designer_id=eng.id,
           requirement="Tail lamp bracket cracks at the weld toe after 2 months in service. Redesign the bracket and the "
                       "coupler mounting plate; keep the existing bolt pattern.")
    act("cw", head, "accept")
    act("cw", head, "start")
    act("cw", eng, "complete")

    create("cab_ac", bd, "DEMO-RRV-8W", "dmrc", title=f"{LABEL} RRV-8W cab air-conditioning option", source="bd", priority="low",
           requirement="Optional roof-mounted 2 TR cab AC unit with 24 V DC compressor.")
    act("cab_ac", head, "cancel", "Customer dropped the AC option in technical offer rev 2.")

    demo.call("POST", f"/design/requests/{reqs['rrv']['id']}/comments", eng, json={
        "comment": "GA layout frozen with BD. Guide wheel unit and hydraulic power pack go as separate sub-assembly BOMs."})
    demo.data["design_requests"] = reqs
    demo.note(MOD, f"{len(reqs)} design requests: in progress, accepted (requirement revised), open/overdue, on hold, completed, cancelled")


# ── Drawings / documents ──────────────────────────────────────────────────

def _new_doc(demo, key, author, *, title, document_type, discipline="mechanical", checker=None, approver=None, **links):
    doc = demo.call("POST", "/design/documents", author, json={
        "title": f"{LABEL} {title}", "document_type": document_type, "discipline": discipline,
        "reviewer_id": checker.id if checker else None, "approver_id": approver.id if approver else None,
        "description": links.pop("description", None), **links})
    _upload(demo, author, doc["open_revision_id"], f"{doc['doc_number']}-R0.pdf")
    return _doc_get(demo, doc, author)


def _drive(demo, doc, author, checker, approver, upto):
    """Move the open revision of `doc` to: in_review | in_approval | approved/released (final) | returned."""
    rev = doc["open_revision_id"]
    doc = demo.call("POST", f"/design/revisions/{rev}/submit", author, json={"comment": "Ready for check."})
    if upto == "in_review":
        return doc
    if upto == "returned":
        return demo.call("POST", f"/design/revisions/{rev}/review", checker, json={
            "decision": "return", "comment": "Weld symbols missing on sections B-B and C-C; add the stress-relief note.",
            "checklist": _checklist_answers(_doc_get(demo, doc, checker))})
    doc = demo.call("POST", f"/design/revisions/{rev}/review", checker, json={
        "decision": "pass", "comment": "Checked against the GA and the standard parts list.",
        "checklist": _checklist_answers(_doc_get(demo, doc, checker))})
    if upto == "in_approval":
        return doc
    return demo.call("POST", f"/design/revisions/{rev}/approve", approver, json={"decision": "pass", "comment": "Approved for manufacture."})


def seed_documents(demo):
    """Mechanical + E/H/P drawings in the Design register at every revision stage."""
    eng, checker, head = _p(demo, "design_engineer"), _p(demo, "design_checker"), _p(demo, "design_head")
    e_eng, e_head = _p(demo, "electrical_engineer"), _p(demo, "electrical_head")
    h_eng, h_head = _p(demo, "hydraulic_engineer"), _p(demo, "hydraulic_head")
    reqs = demo.data["design_requests"]
    rdso = demo.data["design_library"]["standards"]["RDSO/2019/CG-12"]["id"]
    docs = {}

    def mk(key, author, chk, appr, upto, **kw):
        docs[key] = _new_doc(demo, key, author, checker=chk, approver=appr, **kw)
        if upto != "draft":
            docs[key] = _drive(demo, docs[key], author, chk, appr, upto)

    rrv = {"design_request_id": reqs["rrv"]["id"], "customer_id": customer_id(demo, "northern_railway")}
    mk("rrv_ga", eng, checker, head, "final", title="RRV-8W general arrangement", document_type="ga_drawing",
       customer_approval_required=True, standard_id=rdso, description="GA with road/rail mode views, MMD check and axle-load table.", **rrv)
    mk("rrv_chassis", eng, checker, head, "final", title="RRV-8W main chassis frame weldment", document_type="assembly_drawing", **rrv)
    mk("rrv_guidewheel", eng, checker, head, "final", title="Rail guide wheel dia 430 — machining", document_type="part_drawing",
       store_item_id=_item_id(demo, "DEMO-MEC-WHEEL-430"), **rrv)
    mk("rrv_lift_arm", eng, checker, head, "in_review", title="Guide wheel lifting arm", document_type="part_drawing", **rrv)
    # E/H/P drawings: authored in the discipline, released by the discipline head.
    mk("rrv_hyd_circuit", h_eng, head, h_head, "final", title="RRV-8W hydraulic circuit — guide wheel lift & travel",
       document_type="hydraulic_circuit", discipline="hydraulic", **rrv)
    mk("rrv_wiring", e_eng, checker, e_head, "in_approval", title="RRV-8W wiring diagram — road/rail interlock",
       document_type="wiring_diagram", discipline="electrical", **rrv)
    mk("rrv_panel", e_eng, head, e_head, "final", title="RRV-8W main electrical panel layout", document_type="panel_layout",
       discipline="electrical", store_item_id=_item_id(demo, "DEMO-SA-EPNL-RRV"), **rrv)

    rgm = {"design_request_id": reqs["rgm"]["id"], "customer_id": customer_id(demo, "rvnl")}
    mk("rgm_ga", eng, checker, head, "final", title="RGM-16 general arrangement", document_type="ga_drawing",
       customer_approval_required=True, **rgm)
    mk("rgm_carriage", eng, checker, head, "returned", title="RGM-16 stone carriage frame", document_type="assembly_drawing", **rgm)

    tic = {"design_request_id": reqs["tic"]["id"], "customer_id": customer_id(demo, "central_railway_workshop")}
    mk("tic_ga", eng, checker, head, "final", title="TIC-01 general arrangement with sensor beam", document_type="ga_drawing",
       customer_approval_required=True, **tic)
    mk("tic_spec", eng, checker, head, "draft", title="TIC-01 sensor beam mounting specification", document_type="specification", **tic)

    mk("cw_bracket", eng, checker, head, "final", title="CW-BOX tail lamp bracket (reinforced)", document_type="part_drawing",
       design_request_id=reqs["cw"]["id"], customer_id=customer_id(demo, "ircon"))

    hre = {"design_request_id": reqs["hre"]["id"], "customer_id": customer_id(demo, "lt_metro")}
    mk("hre_calc", eng, checker, demo.me, "in_approval", title="HRE-150 lifting jack — structural calculation",
       document_type="calculation", description="FEA + hand calculation of the 150 t jack beam, safety factor 2.5 on yield.", **hre)
    mk("hre_circuit", h_eng, checker, h_head, "in_review", title="HRE-150 700 bar hydraulic circuit", document_type="hydraulic_circuit",
       discipline="hydraulic", **hre)

    mk("rrv_cab_old", eng, checker, head, "final", title="RRV-8W cab GA — type A (old cab)", document_type="assembly_drawing", **rrv)
    docs["rrv_cab_old"] = demo.call("POST", f"/design/documents/{docs['rrv_cab_old']['id']}/obsolete", eng, json={
        "reason": "Cab type A replaced by the low-profile cab type B to clear the MMD on electrified sections."})
    demo.call("POST", f"/design/documents/{docs['rrv_guidewheel']['id']}/comments", _p(demo, "production_manager"), json={
        "comment": "Machining allowance on the flange back looks tight for our VTL — please confirm 3 mm."})
    demo.data["design_documents"] = docs
    demo.note(MOD, f"{len(docs)} drawings/documents (E/H/P released by the Electrical / Hydraulic head); "
                   f"{docs['hre_calc']['doc_number']} waits for YOUR approval")


# ── BOMs ──────────────────────────────────────────────────────────────────

def _line(demo, pos, code, qty, uom=None, make_buy="buy", doc=None, remarks=None):
    return {"position": pos, "store_item_id": _item_id(demo, code), "quantity": qty, "uom": uom, "make_buy": make_buy,
            "document_id": doc["id"] if doc else None, "remarks": remarks}


def _new_item(pos, name, spec, qty, uom="NOS"):
    return {"position": pos, "new_item_name": f"{LABEL} {name}", "new_item_spec": spec, "quantity": qty, "uom": uom, "make_buy": "buy"}


def _bom_drive(demo, bom, upto, author=None, checker=None, approver=None, comment="Ready for check."):
    """Move the open BOM revision to in_review | in_approval | released."""
    author = author or _p(demo, "design_engineer")
    checker = checker or _p(demo, "design_checker")
    approver = approver or _p(demo, "design_head")
    rev = bom["open_revision_id"]
    bom = demo.call("POST", f"/design/boms/revisions/{rev}/submit", author, json={"reviewer_id": checker.id, "approver_id": approver.id, "comment": comment})
    if upto == "in_review":
        return bom
    bom = demo.call("POST", f"/design/boms/revisions/{rev}/review", checker, json={"decision": "pass", "comment": "Quantities checked against the drawings."})
    if upto == "in_approval":
        return bom
    return demo.call("POST", f"/design/boms/revisions/{rev}/approve", approver, json={"decision": "pass", "comment": "Released to Store / Purchase / Production."})


def _new_bom(demo, product_code, title, lines, upto, **links):
    eng = _p(demo, "design_engineer")
    bom = demo.call("POST", "/design/boms", eng, json={
        "product_item_id": _item_id(demo, product_code), "title": f"{LABEL} {title}", "lines": lines,
        "reviewer_id": _p(demo, "design_checker").id, "approver_id": _p(demo, "design_head").id, **links})
    if upto != "draft":
        bom = _bom_drive(demo, bom, upto)
    return bom


def seed_boms(demo):
    """BOMs per product (single level per item, multi-level through the sub-assemblies), with revisions."""
    docs, reqs = demo.data["design_documents"], demo.data["design_requests"]
    boms = {}
    boms["DEMO-SA-HPU-RRV"] = _new_bom(demo, "DEMO-SA-HPU-RRV", "Hydraulic power pack — RRV 8W", [
        _line(demo, 10, "DEMO-HYD-PUMP-GP28", 1), _line(demo, 20, "DEMO-HYD-DCV-43", 4),
        _line(demo, 30, "DEMO-SP-FILTER-RET10", 2), _line(demo, 40, "DEMO-HYD-HOSE-12", 18, remarks="Cut to length at assembly"),
        _line(demo, 50, "DEMO-HYD-OIL-68", 120, remarks="First fill incl. flushing"),
    ], "released", document_id=docs["rrv_hyd_circuit"]["id"], design_request_id=reqs["rrv"]["id"])
    boms["DEMO-SA-EPNL-RRV"] = _new_bom(demo, "DEMO-SA-EPNL-RRV", "Main electrical panel — RRV 8W", [
        _line(demo, 10, "DEMO-ELE-PLC-CPU", 1), _line(demo, 20, "DEMO-ELE-RELAY-24V", 24),
        _line(demo, 30, "DEMO-ELE-PROX-M18", 8), _line(demo, 40, "DEMO-ELE-CABLE-4C25", 150),
    ], "released", document_id=docs["rrv_panel"]["id"], design_request_id=reqs["rrv"]["id"])
    boms["DEMO-SA-GWU-RRV"] = _new_bom(demo, "DEMO-SA-GWU-RRV", "Rail guide wheel unit — RRV 8W", [
        _line(demo, 10, "DEMO-MEC-WHEEL-430", 2, make_buy="make", doc=docs["rrv_guidewheel"]),
        _line(demo, 20, "DEMO-MEC-BRG-22216", 4), _line(demo, 30, "DEMO-RM-EN8-RD-60", 60, remarks="Axle stub blanks"),
        _line(demo, 40, "DEMO-HWF-BOLT-M16X60", 32),
    ], "released", design_request_id=reqs["rrv"]["id"])

    rrv_lines = [
        _line(demo, 10, "DEMO-MEC-ENGINE-74KW", 1), _line(demo, 20, "DEMO-MEC-TYRE-1000R20", 8),
        _line(demo, 30, "DEMO-SA-GWU-RRV", 2, make_buy="make"), _line(demo, 40, "DEMO-SA-HPU-RRV", 1, make_buy="make", doc=docs["rrv_hyd_circuit"]),
        _line(demo, 50, "DEMO-SA-EPNL-RRV", 1, make_buy="make", doc=docs["rrv_panel"]),
        _line(demo, 60, "DEMO-RM-MS-PLATE-10", 2200, doc=docs["rrv_chassis"]), _line(demo, 70, "DEMO-RM-ISMC-100", 900),
        _line(demo, 80, "DEMO-RM-RHS-80X40", 60), _line(demo, 90, "DEMO-ELE-BATT-12V100", 2),
        _line(demo, 100, "DEMO-HWF-BOLT-M16X60", 400), _line(demo, 110, "DEMO-PNT-PU-RAL1003", 60),
        _line(demo, 120, "DEMO-CN-ELECTRODE-7018", 80),
    ]
    boms["DEMO-RRV-8W"] = _new_bom(demo, "DEMO-RRV-8W", "RRV-8W complete vehicle", rrv_lines, "released",
                                   document_id=docs["rrv_ga"]["id"], design_request_id=reqs["rrv"]["id"])

    rgm_lines = [
        _line(demo, 10, "DEMO-MEC-ENGINE-74KW", 1), _line(demo, 20, "DEMO-SP-GRIND-STONE-150", 32, remarks="16 working + 16 spare set"),
        _line(demo, 30, "DEMO-MEC-BRG-22216", 8), _line(demo, 40, "DEMO-RM-MS-PLATE-10", 1800, remarks="Stone carriage frame (drawing in rework)"),
        _line(demo, 50, "DEMO-HYD-PUMP-GP28", 2), _line(demo, 60, "DEMO-HWF-BOLT-M16X60", 300),
    ]
    rgm = _new_bom(demo, "DEMO-RGM-16", "RGM-16 rail grinding machine", rgm_lines, "released", design_request_id=reqs["rgm"]["id"])
    eng = _p(demo, "design_engineer")
    rgm = demo.call("POST", f"/design/boms/{rgm['id']}/revisions", eng, json={
        "change_summary": "Water-mist fire suppression added (requirement rev 1); stone spares split into a separate kit.",
        "reviewer_id": _p(demo, "design_checker").id, "approver_id": _p(demo, "design_head").id})
    demo.call("PATCH", f"/design/boms/revisions/{rgm['open_revision_id']}", eng, json={"lines": [
        *rgm_lines[:1], _line(demo, 20, "DEMO-SP-GRIND-STONE-150", 16), *rgm_lines[2:],
        _new_item(70, "Water-mist fire suppression kit 2 x 6 L", "Nozzles over each stone head, 24 V DC actuation, EN 45545 compliant", 1, "SET")]})
    boms["DEMO-RGM-16"] = _bom_drive(demo, _bom_get(demo, rgm), "in_review", comment="Rev for the revised requirement.")

    boms["DEMO-TIC-01"] = _new_bom(demo, "DEMO-TIC-01", "TIC-01 track inspection car", [
        _line(demo, 10, "DEMO-ELE-PROX-M18", 6), _line(demo, 20, "DEMO-ELE-PLC-CPU", 1),
        _line(demo, 30, "DEMO-ELE-BATT-12V100", 4), _line(demo, 40, "DEMO-ELE-CABLE-4C25", 220),
        _line(demo, 50, "DEMO-RM-RHS-80X40", 36, remarks="Sensor beam"),
    ], "in_approval", design_request_id=reqs["tic"]["id"])

    boms["DEMO-CW-BOX"] = _new_bom(demo, "DEMO-CW-BOX", "CW-BOX carriage wagon (material)", [
        _line(demo, 10, "DEMO-RM-MS-PLATE-10", 3200), _line(demo, 20, "DEMO-RM-ISMC-100", 1400),
        _line(demo, 30, "DEMO-MEC-BRG-22216", 8), _line(demo, 40, "DEMO-PNT-PU-RAL1003", 40),
        _new_item(50, "Centre buffer coupler CBC-10", "AAR-H type, 1.0 MN, with draft gear — no item code yet", 2),
    ], "draft", design_request_id=reqs["cw"]["id"])

    hre_lines = [
        _line(demo, 10, "DEMO-HYD-PUMP-GP28", 1), _line(demo, 20, "DEMO-HYD-DCV-43", 2),
        _line(demo, 30, "DEMO-HYD-HOSE-12", 30), _line(demo, 40, "DEMO-HYD-SEAL-KIT-63", 4),
        _line(demo, 50, "DEMO-HYD-OIL-68", 60),
    ]
    hre = _new_bom(demo, "DEMO-HRE-150", "HRE-150 re-railing equipment set", hre_lines, "released", design_request_id=reqs["hre"]["id"])
    hre = demo.call("POST", f"/design/boms/{hre['id']}/revisions", eng, json={
        "change_summary": "Hose length 30 → 45 m for 15 m reach from the power pack (metro depot pits).",
        "reviewer_id": _p(demo, "design_checker").id, "approver_id": _p(demo, "design_head").id})
    demo.call("PATCH", f"/design/boms/revisions/{hre['open_revision_id']}", eng, json={"lines": [
        *hre_lines[:2], _line(demo, 30, "DEMO-HYD-HOSE-12", 45), *hre_lines[3:]]})
    boms["DEMO-HRE-150"] = _bom_get(demo, hre)
    demo.call("POST", f"/design/boms/{boms['DEMO-RRV-8W']['id']}/comments", _p(demo, "purchase_manager"), json={
        "comment": "Engine lead time is 90 days — please freeze the engine make before the PR."})
    demo.data["design_boms"] = boms
    demo.note(MOD, f"{len(boms)} BOMs (3 sub-assemblies for the multi-level RRV-8W explosion)")


# ── ECR → ECN, legacy ECN ─────────────────────────────────────────────────

def seed_change_control(demo):
    """ECRs at every stage; the approved one becomes an ECN whose revisions are released and acknowledged."""
    docs, boms = demo.data["design_documents"], demo.data["design_boms"]
    head, eng, checker = _p(demo, "design_head"), _p(demo, "design_engineer"), _p(demo, "design_checker")
    prod, qual, purch, store = (_p(demo, k) for k in ("production_manager", "quality_manager", "purchase_manager", "store_manager"))
    ecrs, ecns = {}, {}

    # 1) Production → approved → ECN → R1 drawing + BOM released → implemented → partly acknowledged.
    e = demo.call("POST", "/design/change-requests", prod, json={
        "title": f"{LABEL} RRV-8W chassis: lifting-arm bracket fouls brake rigging at full lift", "source": "production", "urgency": "high",
        "reason": "On RRV-8W unit 1 the guide wheel lifting-arm bracket touches the brake pull rod at full lift (stage inspection).",
        "proposed_change": "Move the bracket 40 mm outboard on the chassis, add a 10 mm doubler plate; 8 more M16 bolts per side.",
        "items": [{"document_id": docs["rrv_chassis"]["id"], "note": "Bracket position + doubler"},
                  {"bom_id": boms["DEMO-RRV-8W"]["id"], "note": "Bolt quantity + doubler plate"}]})
    demo.call("POST", f"/design/change-requests/{e['id']}/impact", eng, json={
        "impact_summary": "Two units in fabrication; doubler plate cut from stock plate. No customer-visible change.",
        "impact_stock": "MS plate 10 mm in stock (no purchase).", "impact_open_orders": "None — bolts from stock.",
        "impact_cost": 6800, "impact_delivery_days": 2, "board_member_ids": [prod.id, qual.id, purch.id]})
    for u, vote, comment in ((prod, "approve", None), (qual, "approve", "Add the clearance check to the stage inspection plan."), (purch, "approve", None)):
        demo.call("POST", f"/design/change-requests/{e['id']}/vote", u, json={"vote": vote, "comment": comment})
    demo.call("POST", f"/design/change-requests/{e['id']}/decide", head, json={"decision": "approved", "comment": "Approved — apply from unit 2."})
    ecn = demo.call("POST", f"/design/change-requests/{e['id']}/ecn", head, json={
        "target_date": str(demo.today + timedelta(days=7)), "effectivity_type": "next_order", "stock_disposition": "use_up",
        "wip_disposition": "rework", "disposition_note": "Unit 1 bracket to be reworked on the shop floor."})
    ecrs["approved"] = demo.call("GET", f"/design/change-requests/{e['id']}", head)
    ecn_id = ecn["id"]
    chassis = demo.call("POST", f"/design/documents/{docs['rrv_chassis']['id']}/revisions", eng, json={
        "change_summary": "Lifting-arm bracket moved 40 mm outboard, 10 mm doubler added (ECR approved).",
        "reviewer_id": checker.id, "approver_id": head.id, "ecn_id": ecn_id})
    _upload(demo, eng, chassis["open_revision_id"], f"{chassis['doc_number']}-R1.pdf")
    docs["rrv_chassis"] = _drive(demo, _doc_get(demo, chassis, eng), eng, checker, head, "final")
    rrv = demo.call("POST", f"/design/boms/{boms['DEMO-RRV-8W']['id']}/revisions", eng, json={
        "change_summary": "Bolt qty 400 → 416 and MS plate +40 kg for the doubler (ECN).", "ecn_id": ecn_id,
        "reviewer_id": checker.id, "approver_id": head.id})
    lines = [{k: ln.get(k) for k in ("position", "store_item_id", "new_item_name", "new_item_spec", "quantity", "uom", "document_id", "make_buy", "remarks")}
             for ln in next(r for r in rrv["revisions"] if r["id"] == rrv["open_revision_id"])["lines"]]
    for ln in lines:
        if ln["store_item_id"] == _item_id(demo, "DEMO-HWF-BOLT-M16X60"):
            ln["quantity"] = 416
        if ln["store_item_id"] == _item_id(demo, "DEMO-RM-MS-PLATE-10"):
            ln["quantity"] = 2240
    demo.call("PATCH", f"/design/boms/revisions/{rrv['open_revision_id']}", eng, json={"lines": lines})
    _bom_drive(demo, _bom_get(demo, rrv), "released", comment="Under the ECN.")
    demo.call("POST", f"/design/change-notices/{ecn_id}/implement", head)
    demo.call("POST", f"/design/change-notices/{ecn_id}/acknowledge", prod, json={"department": "production", "remarks": "Unit 2 frame jig modified."})
    demo.call("POST", f"/design/change-notices/{ecn_id}/acknowledge", store, json={"department": "store", "remarks": "Old drawing prints withdrawn from the store counter."})
    ecns["from_ecr"] = demo.call("GET", f"/design/change-notices/{ecn_id}", head)
    # RRV-8W BOM: R2 opened as a draft on top of the released R1 (beacon light, no item code yet).
    rrv = demo.call("POST", f"/design/boms/{boms['DEMO-RRV-8W']['id']}/revisions", eng, json={
        "change_summary": "Amber LED beacon on the cab roof (customer comment on the GA transmittal).",
        "reviewer_id": checker.id, "approver_id": head.id})
    r2 = next(r for r in rrv["revisions"] if r["id"] == rrv["open_revision_id"])
    keep = [{k: ln.get(k) for k in ("position", "store_item_id", "new_item_name", "new_item_spec", "quantity", "uom", "document_id", "make_buy", "remarks")}
            for ln in r2["lines"]]
    demo.call("PATCH", f"/design/boms/revisions/{r2['id']}", eng, json={"lines": [
        *keep, _new_item(130, "Amber LED rotating beacon 24 V DC", "IP66, magnetic base, 360° visibility 500 m", 1)]})
    boms["DEMO-RRV-8W"] = _bom_get(demo, rrv)

    # 2) Quality → impact checked, board still voting.
    e = demo.call("POST", "/design/change-requests", qual, json={
        "title": f"{LABEL} RGM-16 stone guard bolts loosening", "source": "quality", "urgency": "normal",
        "source_reference": "NCR from final inspection (vibration test)",
        "reason": "Stone guard bolts found loose after the 4 h vibration run on 2 of 16 heads.",
        "proposed_change": "Change to M16 Gr 8.8 with Nord-Lock washers and add a torque-stripe note on the drawing.",
        "items": [{"bom_id": boms["DEMO-RGM-16"]["id"], "note": "Fastener + washer"}]})
    demo.call("POST", f"/design/change-requests/{e['id']}/impact", checker, json={
        "impact_summary": "Washers to be bought (no stock). 1 day per machine for retrofit.", "impact_cost": 14500,
        "impact_delivery_days": 5, "board_member_ids": [prod.id, qual.id]})
    demo.call("POST", f"/design/change-requests/{e['id']}/vote", prod, json={"vote": "approve"})
    ecrs["board_voting"] = demo.call("GET", f"/design/change-requests/{e['id']}", head)

    # 3) Purchase → rejected by the Design head.
    e = demo.call("POST", "/design/change-requests", purch, json={
        "title": f"{LABEL} Guide wheel unit: alternate bearing make", "source": "purchase", "urgency": "low",
        "reason": "Approved makes have 10-week lead time; a local make is available ex-stock at 30 % lower cost.",
        "proposed_change": "Allow the local-make 22216 bearing in the guide wheel unit.",
        "items": [{"bom_id": boms["DEMO-SA-GWU-RRV"]["id"], "note": "Bearing make"}]})
    demo.call("POST", f"/design/change-requests/{e['id']}/impact", eng, json={
        "impact_summary": "L10 life of the local make at our load is ~14,000 h against the 20,000 h requirement.", "board_member_ids": [qual.id]})
    demo.call("POST", f"/design/change-requests/{e['id']}/vote", qual, json={"vote": "reject", "comment": "No type-test data for the local make."})
    demo.call("POST", f"/design/change-requests/{e['id']}/decide", head, json={
        "decision": "rejected", "comment": "Bearing life below requirement; keep SKF / FAG. Purchase to place a blanket order instead."})
    ecrs["rejected"] = demo.call("GET", f"/design/change-requests/{e['id']}", head)

    # 4) Design → just raised.
    ecrs["open"] = demo.call("POST", "/design/change-requests", eng, json={
        "title": f"{LABEL} CW-BOX tail lamp bracket: add a drain hole", "source": "design", "urgency": "low",
        "reason": "Water collects in the bracket channel (corrosion seen on the trial wagon).",
        "proposed_change": "Add a 10 mm drain hole at the lowest point of the channel.",
        "items": [{"document_id": docs["cw_bracket"]["id"]}]})

    # Legacy ECNs (no ECR): one submitted to the Design head, one draft.
    legacy = demo.call("POST", "/design/change-notices", eng, json={
        "title": f"{LABEL} HRE-150 hose routing for metro depot pits", "reason": "customer_request", "priority": "high",
        "description": "Metro depot pits need 15 m reach from the power pack; longer hoses and a hose reel.",
        "impact_assessment": "Hose cost +₹ 9,600 per set; no change to the jacks.", "approver_id": head.id,
        "boms": [{"bom_id": boms["DEMO-HRE-150"]["id"], "change_description": "Hose 30 → 45 m"}]})
    ecns["submitted"] = demo.call("POST", f"/design/change-notices/{legacy['id']}/submit", eng)
    ecns["draft"] = demo.call("POST", "/design/change-notices", eng, json={
        "title": f"{LABEL} RGM-16 cab handrail height", "reason": "safety", "priority": "medium",
        "description": "Raise the cab entry handrail to 1100 mm (EN 14033-1).", "approver_id": head.id,
        "documents": [{"document_id": docs["rgm_ga"]["id"], "change_description": "Handrail detail"}]})
    demo.data["design_documents"] = docs
    demo.data["design_ecrs"], demo.data["design_ecns"] = ecrs, ecns
    demo.note(MOD, f"{len(ecrs)} ECRs (approved→ECN implemented, voting, rejected, open), {len(ecns)} ECNs "
                   f"({ecns['from_ecr']['ecn_number']}: production + store acknowledged, purchase + quality pending)")


# ── Customer submissions (transmittals) ───────────────────────────────────

def seed_submissions(demo):
    """Customer approval of GA drawings: approved (→ released), rejected (→ next revision), overdue."""
    docs = demo.data["design_documents"]
    head, eng, checker = _p(demo, "design_head"), _p(demo, "design_engineer"), _p(demo, "design_checker")
    t = demo.today
    subs = {}

    def submission(key, doc, cust, sent_days_ago, contact):
        sub = demo.call("POST", "/design/submissions", head, json={
            "customer_id": customer_id(demo, cust), "customer_name": customer_name(demo, cust), "contact_name": contact,
            "contact_email": f"{contact.split()[0].lower()}@example.invalid",
            "cover_note": f"{LABEL} Please review and approve the attached drawing(s) for manufacture.",
            "lines": [{"revision_id": doc["open_revision_id"]}]})
        subs[key] = demo.call("POST", f"/design/submissions/{sub['id']}/send", head, json={"sent_date": str(t - timedelta(days=sent_days_ago))})
        return subs[key]

    sub = submission("approved", docs["rrv_ga"], "northern_railway", 12, "R K Meena (Dy CE/TM)")
    subs["approved"] = demo.call("POST", f"/design/submissions/{sub['id']}/response", head, json={
        "response_date": str(t - timedelta(days=4)), "remarks": "Approved vide letter dated today.",
        "lines": [{"line_id": sub["lines"][0]["id"], "response": "approved_with_comments", "comment": "Add the axle-load table on sheet 2 in the next revision."}]})
    demo.call("POST", f"/design/submissions/{sub['id']}/letter", head, files=[("file", demo.pdf("DEMO-NR-approval-letter.pdf"))])
    docs["rrv_ga"] = demo.call("POST", f"/design/revisions/{docs['rrv_ga']['open_revision_id']}/release", head, json={"comment": "Released after customer approval."})

    sub = submission("rejected", docs["rgm_ga"], "rvnl", 25, "S Banerjee (CPM)")
    subs["rejected"] = demo.call("POST", f"/design/submissions/{sub['id']}/response", head, json={
        "response_date": str(t - timedelta(days=9)),
        "lines": [{"line_id": sub["lines"][0]["id"], "response": "rejected", "comment": "Stone carriage overhang exceeds the SOD on 1° curves — revise."}]})
    rgm = demo.call("POST", f"/design/documents/{docs['rgm_ga']['id']}/revisions", eng, json={
        "change_summary": "Stone carriage overhang reduced by 120 mm to clear the SOD (customer comments on the transmittal).",
        "reviewer_id": checker.id, "approver_id": head.id})
    _upload(demo, eng, rgm["open_revision_id"], f"{rgm['doc_number']}-R1.pdf")
    docs["rgm_ga"] = _doc_get(demo, rgm)

    submission("overdue", docs["tic_ga"], "central_railway_workshop", 20, "A P Kulkarni (SSE/Track)")
    for key in ("rrv_ga", "tic_ga"):
        docs[key] = _doc_get(demo, docs[key])
    demo.data["design_submissions"] = subs
    demo.data["design_documents"] = docs
    demo.note(MOD, "3 customer submissions: approved with comments (GA released + open action item), rejected (R1 draft), overdue")


# ── Re-run guard ──────────────────────────────────────────────────────────

def _already_seeded(demo) -> bool:
    from app.modules.design.models.bom import DesignBom
    from app.modules.design.models.request import DesignRequest
    from app.modules.store.models.item import StoreItem
    if not demo.db.query(DesignRequest.id).filter(DesignRequest.title.like(f"{LABEL} %"), DesignRequest.is_deleted == False).first():  # noqa: E712
        return False
    head = _p(demo, "design_head")
    boms = {}
    for b in demo.db.query(DesignBom).filter(DesignBom.title.like(f"{LABEL} %"), DesignBom.is_deleted == False).all():  # noqa: E712
        item = demo.db.get(StoreItem, b.product_item_id)
        if item:
            boms[item.item_code] = _finish_bom(demo.call("GET", f"/design/boms/{b.id}", head), item.item_code)
    demo.data["design_boms"] = boms
    demo.data["design_requests"] = {r.request_number: demo.call("GET", f"/design/requests/{r.id}", head) for r in
                                    demo.db.query(DesignRequest).filter(DesignRequest.title.like(f"{LABEL} %")).all()}
    demo.note(MOD, "DEMO design data already present — registry rebuilt, nothing new created")
    return True


def _finish_bom(bom: dict, code: str) -> dict:
    revs = bom.get("revisions") or []
    rev = next((r for r in revs if r["id"] == bom.get("released_revision_id")), None) or \
        next((r for r in revs if r["id"] == bom.get("open_revision_id")), None) or (revs[0] if revs else {})
    lines = [{"store_item_id": ln.get("store_item_id"), "item_code": ln.get("item_code"), "item_name": ln.get("item_name") or ln.get("new_item_name"),
              "quantity": ln.get("quantity"), "uom": ln.get("uom"), "make_buy": ln.get("make_buy"), "document_id": ln.get("document_id")}
             for ln in rev.get("lines") or []]
    return {**bom, "product_code": code, "status": bom.get("display_status"), "lines": lines}


def seed(demo):
    ensure_engineering(demo)
    if _already_seeded(demo):
        return
    seed_library(demo)
    seed_requests(demo)
    seed_documents(demo)
    seed_boms(demo)
    seed_change_control(demo)
    seed_submissions(demo)
    reply_requirement_shares(demo, "design", _p(demo, "design_head"),
                             ("feasible_with_changes", "Feasible on the RRV-8W platform; the attachment needs a 300 mm longer "
                                                       "rear overhang and a counterweight — GA impact is in the attached note."))
    head = _p(demo, "design_head")
    demo.data["design_requests"] = {k: demo.call("GET", f"/design/requests/{r['id']}", head) for k, r in demo.data["design_requests"].items()}
    demo.data["design_boms"] = {code: _finish_bom(_bom_get(demo, b), code) for code, b in demo.data["design_boms"].items()}
    summary = ", ".join(f"{c}: {b['bom_number']} {b['status']}" for c, b in demo.data["design_boms"].items())
    demo.note(MOD, f"BOMs → {summary}")
    docs = {k: _doc_get(demo, d) for k, d in demo.data["design_documents"].items()}
    demo.data["design_documents"] = docs
    demo.note(MOD, "drawings → " + ", ".join(f"{k}: {d['doc_number']} {d['display_status']}" for k, d in docs.items()))
    demo.note(MOD, "requests → " + ", ".join(f"{k}: {r['request_number']} {r['status']}" for k, r in demo.data["design_requests"].items()))
