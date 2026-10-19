"""R&D: team, requirement work (access, department shares, tasks, discussion, documents), technical offers, projects.

All through the real API, acting as the right person:

  R&D › Settings › Team   DEMO R&D Head = head; DEMO R&D Engineer = member with "Can create Technical Offers".
  Requirement work        on the TORs the crm seeder sent (demo.data["tors"]):
    Access      R&D Engineer gets View/Download/Upload/Respond on DMRC + NR, View on the others.
    Departments DMRC shared with Design, Electrical, Hydraulic & Pneumatic — Design replied "Feasible with
                changes", Electrical "Feasible", Hydraulic still open; NR shared with Design (replied Feasible).
    Tasks       DMRC: axle-load calculation (approval asked → approved → COMPLETED by the engineer),
                engine/transmission selection (AWAITING APPROVAL of a deviation), GA drawing for Design
                (OVERDUE — due 4 days ago), hydraulic rail-guide circuit for Hydraulic (open).
                NR: dust-extraction test plan (was overdue → assignee RE-DATED it with a reason), profile library (open).
                Past due dates are set in the DB after creation: the API refuses a past due date.
    Discussion  R&D head answers BD's question on the DMRC requirement.
    Documents   R&D calculation sheet (visible to all departments), Design GA concept (kept to Design).
    CRM reply   DMRC / NR / L&T requests answered on time with a response file; CR Matunga left unanswered (overdue).
  Technical offers (Word template is created by the create endpoint itself):
    dmrc_rrv    R0 released ("Send to BD Team"), revised → R1 released (R0 superseded)
    nr_rgm      R0 released
    lt_metro_cw R0 released
    crw_hre     R0 draft (R&D still working; its TOR is overdue)
  R&D projects (Prototype / Research):
    rail_guide   Lightweight hydraulic rail guide gear — Feasibility stage, study Go, prototype in testing,
                 experiments completed (pass) + in progress, project tasks (one awaiting approval), linked to the DMRC requirement
    battery_rrv  Battery-electric drive for RRV — Research stage, experiment planned
    stone_wear   RGM stone-wear monitoring — handed over and Closed (checklist complete)
    mag_brake    Magnetic track brake retrofit — feasibility No-Go, project cancelled

demo.data keys set here:

  technical_offers  dict key -> offer dict from the API (+ "source", "record_id", "inquiry_key").
                    Keys: dmrc_rrv (R1, released), dmrc_rrv_r0 (superseded), nr_rgm (released),
                    lt_metro_cw (released), crw_hre (draft). Only released ones are quotable.
  rnd_projects      dict key -> R&D project dict from the API: rail_guide, battery_rrv, stone_wear, mag_brake.
  rnd_team          {"heads": [user ids], "offer_creators": [user ids]}.
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL


def _p(demo, key):
    return demo.data["people"][key]


# ── Team ──────────────────────────────────────────────────────────────────

def ensure_team(demo) -> None:
    """R&D › Settings › Team — idempotent; the crm seeder calls it before sending TORs."""
    head, eng = _p(demo, "rnd_head"), _p(demo, "rnd_engineer")
    current = demo.call("GET", "/rnd/settings", head)
    rows = {m["user_id"]: m for m in current["team"]}
    if rows.get(head.id, {}).get("role") == "head" and rows.get(eng.id, {}).get("can_create_technical_offer"):
        demo.data["rnd_team"] = {"heads": [m["user_id"] for m in current["team"] if m["role"] == "head"],
                                 "offer_creators": [m["user_id"] for m in current["team"] if m["can_create_technical_offer"]]}
        return
    team = [{"user_id": m["user_id"], "role": m["role"], "can_create_technical_offer": m["can_create_technical_offer"]}
            for m in current["team"] if m["user_id"] not in (head.id, eng.id)]
    team += [{"user_id": head.id, "role": "head", "can_create_technical_offer": True},
             {"user_id": eng.id, "role": "member", "can_create_technical_offer": True}]
    # With no team yet every R&D user counts as head, so the DEMO head may save it; else the admin does.
    actor = head if not current["team_configured"] or current["is_head"] else demo.me
    saved = demo.call("PUT", "/rnd/settings", actor, json={"team": team})
    demo.data["rnd_team"] = {"heads": [m["user_id"] for m in saved["team"] if m["role"] == "head"],
                             "offer_creators": [m["user_id"] for m in saved["team"] if m["can_create_technical_offer"]]}
    demo.note("rnd", "R&D › Settings › Team: DEMO R&D Head (head), DEMO R&D Engineer (member, can create Technical Offers)")


# ── Requirement work ──────────────────────────────────────────────────────

def _tor_map(demo) -> dict[str, dict]:
    return {t["key"]: t for t in demo.data.get("tors", []) if t.get("key")}


def _backdate_task(demo, task_id: int, days: int) -> None:
    from app.modules.rnd.models.requirement_work import RndRequirementTask
    t = demo.db.get(RndRequirementTask, task_id)
    t.due_date = t.original_due_date = demo.today - timedelta(days=days)
    demo.db.commit()


def seed_access(demo, tors: dict) -> None:
    head, eng = _p(demo, "rnd_head"), _p(demo, "rnd_engineer")
    for key, t in tors.items():
        full = key in ("dmrc_rrv", "nr_rgm")
        demo.call("PUT", f"/rnd/requirement-work/inquiry/{t['record_id']}/access", head, json={"rows": [
            {"user_id": eng.id, "can_view": True, "can_download": full, "can_upload": full, "can_respond": full}]})
    demo.note("rnd", f"requirement access set on {len(tors)} requirements (engineer: full on DMRC/NR, view on the rest)")


def seed_shares(demo, tors: dict) -> None:
    head = _p(demo, "rnd_head")
    plan = {
        "dmrc_rrv": (["design", "electrical", "hydraulic"],
                     "DEMO: Check whether the hydraulic rail guide gear and a 3 t crane fit within the DMRC kinematic envelope; "
                     "Electrical — confirm OHE-safe cabin and speed limiter integration.", 5),
        "nr_rgm": (["design"], "DEMO: Can the 16-stone grinding carriage be mounted on the existing RGM chassis with the dust extractor?", 4),
    }
    replies = {
        ("dmrc_rrv", "design"): ("design_head", "feasible_with_changes",
                                 "DEMO: Fits if crane outreach is reduced to 5.5 m within the envelope; GA concept uploaded."),
        ("dmrc_rrv", "electrical"): ("electrical_head", "feasible", None),
        ("nr_rgm", "design"): ("design_head", "feasible", None),
    }
    count, replied = 0, []
    for key, (departments, note, due) in plan.items():
        t = tors.get(key)
        if not t:
            continue
        shares = demo.call("POST", f"/rnd/requirement-work/inquiry/{t['record_id']}/shares", head, json={
            "departments": departments, "note": note, "due_date": (demo.today + timedelta(days=due)).isoformat()})
        count += len(departments)
        for s in shares if isinstance(shares, list) else shares.get("shares", []):
            who = replies.get((key, s.get("department")))
            if not who or s.get("status") != "open":
                continue
            person, response, remarks = who
            replied.append(f"{key}/{s['department']}={response}")
            demo.call("POST", f"/rnd/department-requirements/{s['department']}/{s['id']}/respond", _p(demo, person),
                      data={"response": response, **({"remarks": remarks} if remarks else {})},
                      files=[("files", demo.pdf(f"DEMO-{s['department']}-feasibility.pdf"))] if remarks else None)
    demo.note("rnd", f"requirements shared with {count} department(s); replies: {', '.join(replied) or 'none'} (rest still open)")


def _task(demo, record_id: int, actor, title: str, assignee, due_days: int, remarks: str, department: str = "rnd",
          priority: str | None = None, with_file: bool = False) -> dict:
    return demo.call("POST", f"/rnd/requirement-work/inquiry/{record_id}/tasks", actor, data={
        "title": title, "assigned_to_id": str(assignee.id), "due_date": (demo.today + timedelta(days=due_days)).isoformat(),
        "remarks": remarks, "department": department, **({"priority": priority} if priority else {}),
    }, files=[("files", demo.pdf("DEMO-task-brief.pdf"))] if with_file else None)


def seed_tasks(demo, tors: dict) -> None:
    head, eng = _p(demo, "rnd_head"), _p(demo, "rnd_engineer")
    made = 0
    dmrc = tors.get("dmrc_rrv")
    if dmrc:
        rid = dmrc["record_id"]
        # 1. Done: approval asked and approved, then the engineer completes it.
        calc = _task(demo, rid, head, "DEMO: Axle-load & load-distribution calculation (2 x RRV-8W)", eng, 6,
                     "Use the R&D load-distribution calculator; 300 t haulage on 1:40.", priority="high", with_file=True)
        demo.call("POST", f"/rnd/requirement-work/tasks/{calc['id']}/approvals", eng, data={
            "request": "DEMO: Approve using 20.3 t axle load (RDSO limit) as the design basis instead of 22.5 t."})
        approval = demo.call("GET", f"/rnd/requirement-work/inquiry/{rid}/tasks", head)
        pending = next(a for t in approval if t["id"] == calc["id"] for a in t["approvals"] if a["status"] == "pending")
        demo.call("POST", f"/rnd/requirement-work/approvals/{pending['id']}/decide", head,
                  json={"decision": "approve", "remarks": "DEMO: Agreed — DMRC track is designed for 20.3 t."})
        demo.call("POST", f"/rnd/requirement-work/tasks/{calc['id']}/complete", eng, data={
            "remarks": "DEMO: Calculation done — max axle load 18.6 t, within limit. Sheet attached."},
            files=[("files", demo.pdf("DEMO-axle-load-calculation.pdf"))])
        # 2. Awaiting approval.
        eng_sel = _task(demo, rid, head, "DEMO: Engine & transmission selection (Stage V)", eng, 8,
                        "Shortlist two engine makes with service support in Delhi NCR.", priority="medium")
        demo.call("POST", f"/rnd/requirement-work/tasks/{eng_sel['id']}/approvals", eng, data={
            "request": "DEMO: Deviation — propose 74 kW engine instead of 90 kW; tractive effort still meets 300 t on 1:40."},
            files=[("files", demo.pdf("DEMO-tractive-effort.pdf"))])
        # 3. Overdue: Design's GA drawing (created due today, then moved 4 days back).
        ga = _task(demo, rid, head, "DEMO: GA drawing within DMRC kinematic envelope", _p(demo, "design_engineer"), 0,
                   "Show crane stowed position and rail guide gear deployed.", department="design", priority="high")
        _backdate_task(demo, ga["id"], 4)
        # 4. Open: Hydraulic circuit.
        _task(demo, rid, head, "DEMO: Hydraulic circuit for rail guide gear deployment (< 10 min)", _p(demo, "hydraulic_head"), 9,
              "Include accumulator sizing for engine-off deployment.", department="hydraulic")
        made += 4
    nr = tors.get("nr_rgm")
    if nr:
        rid = nr["record_id"]
        dust = _task(demo, rid, head, "DEMO: Dust-extraction test plan (CPCB norms)", eng, 0,
                     "Plan a test on the prototype grinding carriage.")
        _backdate_task(demo, dust["id"], 2)
        demo.call("POST", f"/rnd/requirement-work/tasks/{dust['id']}/extend", eng, data={
            "reason": "DEMO: Dust meter on calibration — back from the lab next week.",
            "new_due_date": (demo.today + timedelta(days=6)).isoformat()})
        _task(demo, rid, head, "DEMO: Load RDSO 60 kg / 52 kg profile library into the controller", eng, 10,
              "Get the latest profile drawings from RDSO.")
        made += 2
    demo.note("rnd", f"{made} requirement tasks: completed, awaiting approval, overdue (DB-backdated), re-dated, open")


def seed_requirement_docs_and_discussion(demo, tors: dict) -> None:
    dmrc = tors.get("dmrc_rrv")
    if not dmrc:
        return
    rid = dmrc["record_id"]
    demo.call("POST", f"/rnd/requirement-work/inquiry/{rid}/documents", _p(demo, "rnd_engineer"),
              data={"department": "rnd", "visibility": "all"}, files=[("files", demo.pdf("DEMO-RRV-8W-calculation-sheet.pdf"))])
    demo.call("POST", f"/rnd/requirement-work/inquiry/{rid}/documents", _p(demo, "design_head"),
              data={"department": "design", "visibility": "own"}, files=[("files", demo.pdf("DEMO-RRV-GA-concept.pdf"))])
    demo.call("POST", f"/requirement-discussion/inquiry/{rid}", _p(demo, "rnd_head"), data={
        "side": "rnd", "mention_ids": str(_p(demo, "bd").id),
        "body": f"{LABEL}: Yes — the hydraulic rail guide gear deploys in about 6 minutes with the engine running. "
                "We will put the deployment cycle in the technical offer.",
    })
    demo.note("rnd", "requirement documents (R&D: all departments; Design: own only) and R&D's discussion reply")


def seed_crm_responses(demo, tors: dict) -> None:
    """R&D's formal reply to CRM's request (the TOR) — on time for three, none for the overdue one."""
    head = _p(demo, "rnd_head")
    answered = []
    for key in ("dmrc_rrv", "nr_rgm", "lt_metro_cw"):
        t = tors.get(key)
        if not t:
            continue
        demo.call("POST", f"/rnd/requirements/requests/{t['request_id']}/respond", head, data={
            "remarks": f"{LABEL}: Feasible. Technical offer prepared under R&D › Requirements › Technical Offers."},
            files=[("files", demo.pdf(f"DEMO-RnD-response-{t['tor_number']}.pdf"))])
        answered.append(t["tor_number"])
    demo.note("rnd", f"R&D answered {', '.join(answered) or 'no'} TOR(s); crw_hre left unanswered (overdue)")


# ── Technical offers ──────────────────────────────────────────────────────

OFFERS = {
    "dmrc_rrv": dict(creator="rnd_engineer", title=f"{LABEL} Rail-cum-Road Vehicle RRV-8W (1435 mm) – 2 nos for DMRC",
                     scope="2 nos RRV-8W with hydraulic rail guide gear, 3 t crane (5.5 m outreach), tool kit, O&M manuals, "
                           "operator training (5 days) at Mundka depot.",
                     technical_details="Gauge 1435 mm\nEngine 74 kW Stage V\nHaulage 300 t on 1:40\nRail speed 40 km/h, road 60 km/h\n"
                                       "Rail guide gear deployment ≤ 6 min\nOHE-safe cabin, speed limiter interface to ATP",
                     deviations="Crane outreach 5.5 m instead of 6 m (kinematic envelope).", release=True,
                     revise="DEMO: DMRC asked for a second crane option and 36-month warranty on the drive line."),
    "nr_rgm": dict(creator="rnd_engineer", title=f"{LABEL} Rail Grinding Machine RGM-16 (1676 mm) for NR Lucknow",
                   scope="1 no RGM-16 with dust extraction, on-board profile measurement, RDSO profile library, spares for 2 years.",
                   technical_details="16 grinding stones, 22 kW each\nWorking speed 3–8 km/h\nProfile measurement before/after grinding",
                   deviations="Nil", release=True),
    "lt_metro_cw": dict(creator="rnd_head", title=f"{LABEL} Material Wagon CW-BOX (1435 mm) – 4 nos for L&T Metro",
                        scope="4 nos 40 t material wagons with drop sides and rail/sleeper stanchions.",
                        technical_details="Payload 40 t\nAxle load 20.3 t\nCoupler height 1105 mm (matches existing RRV)",
                        deviations="Nil", release=True),
    "crw_hre": dict(creator="rnd_engineer", title=f"{LABEL} Hydraulic Re-railing Equipment HRE-150 – 2 sets for CR Matunga",
                    scope="2 sets HRE-150: 4 jacks, traversing bridge, 700 bar power pack (diesel + electric), container.",
                    technical_details=None, deviations=None, release=False),
}


def _offer_patch(spec: dict) -> dict:
    return {k: spec[k] for k in ("title", "scope", "technical_details", "deviations") if spec.get(k)}


def seed_technical_offers(demo, tors: dict) -> dict:
    from app.modules.rnd.models.technical_offer import RndTechnicalOffer

    head = _p(demo, "rnd_head")
    out = {}
    for key, spec in OFFERS.items():
        t = tors.get(key)
        if not t:
            demo.note("rnd", f"no TOR for {key} (crm seeder didn't send one) — its technical offer was skipped")
            continue
        rid = t["record_id"]
        existing = demo.db.query(RndTechnicalOffer).filter(RndTechnicalOffer.source == "inquiry", RndTechnicalOffer.record_id == rid).first()
        if not existing:
            creator = _p(demo, spec["creator"])
            offer = demo.call("POST", f"/rnd/requirement-work/inquiry/{rid}/technical-offers", creator, json=_offer_patch(spec))
            if offer.get("word_error"):
                demo.note("rnd", f"{offer['offer_number']}: Word template not created — {offer['word_error']}")
            if spec["release"]:
                offer = demo.call("POST", f"/rnd/requirement-work/technical-offers/{offer['id']}/release", head)
            if spec.get("revise"):
                r1 = demo.call("POST", f"/rnd/requirement-work/technical-offers/{offer['id']}/revise", creator, json={"reason": spec["revise"]})
                demo.call("PATCH", f"/rnd/requirement-work/technical-offers/{r1['id']}", creator, json={
                    "scope": spec["scope"] + " Option B: 5 t crane with 4.5 m outreach.",
                    "exclusions": "Civil works at depot; road registration (RTO) charges."})
                demo.call("POST", f"/rnd/requirement-work/technical-offers/{r1['id']}/release", head)
        offers = demo.call("GET", f"/rnd/requirement-work/inquiry/{rid}/technical-offers", head)   # latest first
        meta = {"source": "inquiry", "record_id": rid, "inquiry_key": key}
        out[key] = {**offers[0], **meta}
        if len(offers) > 1:
            out[f"{key}_r0"] = {**offers[-1], **meta}
    demo.data["technical_offers"] = out
    demo.note("rnd", "technical offers: " + ", ".join(f"{o['offer_number']} {o['status']}" for o in out.values()))
    return out


# ── R&D projects (Prototype / Research) ───────────────────────────────────

PROJECTS = {
    "rail_guide": dict(title=f"{LABEL} Lightweight hydraulic rail guide gear for RRV-8W", project_type="product_improvement",
                       priority="high", objective="Cut rail guide gear weight by 25% and deployment time to under 6 minutes.",
                       scope="Design, prototype and field-trial a new rail guide gear for RRV-8W (1435 / 1676 mm).",
                       budget=1800000, start=-60, end=90, stage="feasibility",
                       feasibility=dict(material_cost=420000, labour_cost=180000, overhead_cost=90000, target_selling_price=1100000,
                                        costing_rating="feasible", sourcing_rating="conditional", process_rating="feasible",
                                        quality_rating="feasible", recommendation="go",
                                        sourcing_notes="DEMO: Cylinder vendor lead time 10 weeks.",
                                        decision_notes="DEMO: Go — needed for the DMRC offer.")),
    "battery_rrv": dict(title=f"{LABEL} Battery-electric drive for RRV (zero-emission tunnels)", project_type="technology_research",
                        priority="medium", objective="Assess a 150 kWh LFP battery drive for 3-hour tunnel blocks.",
                        scope="Literature study, duty-cycle simulation, battery vendor survey.", budget=900000, start=-20, end=160,
                        stage="research", feasibility=None),
    "stone_wear": dict(title=f"{LABEL} Grinding stone wear monitoring for RGM-16", project_type="product_improvement",
                       priority="medium", objective="Predict grinding stone change from motor current and stone height sensors.",
                       scope="Sensor kit, PLC logic, HMI alarm, field validation on 50 km.", budget=600000, start=-200, end=-15,
                       stage="closed",
                       feasibility=dict(material_cost=150000, labour_cost=60000, overhead_cost=30000, target_selling_price=380000,
                                        costing_rating="feasible", sourcing_rating="feasible", process_rating="feasible",
                                        quality_rating="feasible", recommendation="go", decision_notes="DEMO: Go — validated on prototype.")),
    "mag_brake": dict(title=f"{LABEL} Magnetic track brake retrofit for carriage wagons", project_type="new_product",
                      priority="low", objective="Retrofit magnetic track brakes on CW-BOX for steep ghat sections.",
                      scope="Concept and costing only.", budget=300000, start=-90, end=30, stage="feasibility",
                      feasibility=dict(material_cost=520000, labour_cost=90000, overhead_cost=60000, target_selling_price=450000,
                                       costing_rating="not_feasible", sourcing_rating="conditional", process_rating="feasible",
                                       quality_rating="conditional", recommendation="no_go",
                                       decision_notes="DEMO: No-Go — cost above what customers pay; revisit if RDSO mandates it."),
                      cancel=True),
}


def _item(demo, *codes):
    items = demo.data.get("items", {})
    return [items[c] for c in codes if c in items] or list(items.values())[:3]


def seed_projects(demo, tors: dict) -> dict:
    from app.modules.rnd.models.project import RndProject

    head, eng = _p(demo, "rnd_head"), _p(demo, "rnd_engineer")
    out = {}
    for key, spec in PROJECTS.items():
        row = demo.db.query(RndProject).filter(RndProject.title == spec["title"], RndProject.is_deleted == False).first()  # noqa: E712
        if row:
            out[key] = demo.call("GET", f"/rnd/projects/{row.id}", head)
            continue
        p = demo.call("POST", "/rnd/projects", head, json={
            "title": spec["title"], "project_type": spec["project_type"], "priority": spec["priority"],
            "objective": spec["objective"], "scope": spec["scope"], "lead_ids": [head.id], "team_member_ids": [eng.id],
            "start_date": (demo.today + timedelta(days=spec["start"])).isoformat(),
            "target_end_date": (demo.today + timedelta(days=spec["end"])).isoformat(),
            "budget_amount": spec["budget"], "remarks": f"{LABEL} R&D project",
        })
        pid = p["id"]
        stages = ["research", "development", "feasibility", "handover", "closed"]
        for stg in stages[: stages.index(spec["stage"]) + 1]:
            if stg == "closed":   # the handover checklist must be complete before closing
                demo.call("PATCH", f"/rnd/projects/{pid}", head, json={
                    "handover_specs_final": True, "handover_bom_approved": True, "handover_process_documented": True,
                    "handover_quality_standards": True, "handover_notes": "DEMO: Handed over to Production with sensor kit BOM.",
                    "actual_end_date": (demo.today - timedelta(days=15)).isoformat()})
            demo.call("POST", f"/rnd/projects/{pid}/stage", head, json={"stage": stg})
            if stg == "feasibility" and spec.get("feasibility"):   # Go / No-Go is the head's sign-off
                demo.call("PUT", f"/rnd/projects/{pid}/feasibility", head, json=spec["feasibility"])
        if spec.get("cancel"):
            demo.call("PATCH", f"/rnd/projects/{pid}", head, json={"status": "cancelled"})
        out[key] = demo.call("GET", f"/rnd/projects/{pid}", head)
        _project_children(demo, key, out[key], tors)
    demo.data["rnd_projects"] = out
    demo.note("rnd", "R&D projects: " + ", ".join(f"{p['project_number']} {p['stage']}/{p['status']}" for p in out.values()))
    return out


def _project_children(demo, key: str, project: dict, tors: dict) -> None:
    head, eng = _p(demo, "rnd_head"), _p(demo, "rnd_engineer")
    pid = project["id"]
    if key == "rail_guide":
        bom = [{"store_item_id": i["id"], "item_code": i["code"], "item_name": i["name"], "quantity": q, "uom": i.get("unit"),
                "unit_cost": i.get("rate")} for i, q in zip(_item(demo, "DEMO-MEC-WHEEL-430", "DEMO-HYD-DCV-43", "DEMO-MEC-BRG-22216"), (4, 2, 4))]
        proto = demo.call("POST", "/rnd/prototypes", eng, json={
            "project_id": pid, "name": f"{LABEL} Rail guide gear proto", "version": "v1",
            "description": "Welded box arm with 80 mm cylinders.", "build_date": (demo.today - timedelta(days=20)).isoformat(),
            "bom_items": bom})
        demo.call("PATCH", f"/rnd/prototypes/{proto['id']}", eng, json={"status": "building"})
        demo.call("PATCH", f"/rnd/prototypes/{proto['id']}", eng, json={"status": "testing", "findings": "DEMO: Deployment 5 min 40 s on test track."})
        done = demo.call("POST", "/rnd/experiments", eng, json={
            "project_id": pid, "prototype_id": proto["id"], "title": f"{LABEL} Deployment time test on test track",
            "experiment_type": "field_trial", "objective": "Deployment under 6 minutes with engine running.",
            "method": "10 deploy/stow cycles, stop-watch timing.", "experiment_date": (demo.today - timedelta(days=10)).isoformat(),
            "parameters": [{"parameter": "Deployment time", "specification": "≤ 360", "measured": "340", "unit": "s", "result": "pass"},
                           {"parameter": "Hydraulic pressure", "specification": "≤ 210", "measured": "195", "unit": "bar", "result": "pass"}]})
        demo.call("PATCH", f"/rnd/experiments/{done['id']}", eng, json={
            "status": "completed", "result": "pass", "observations": "DEMO: All 10 cycles within limit.",
            "conclusion": "DEMO: Meets the DMRC night-block requirement."})
        running = demo.call("POST", "/rnd/experiments", eng, json={
            "project_id": pid, "prototype_id": proto["id"], "title": f"{LABEL} Fatigue test of guide arm (2 lakh cycles)",
            "experiment_type": "lab_test", "objective": "No crack at 2 lakh cycles.", "experiment_date": demo.today.isoformat()})
        demo.call("PATCH", f"/rnd/experiments/{running['id']}", eng, json={"status": "in_progress"})
        demo.call("POST", "/rnd/documents", eng, data={"project_id": str(pid), "doc_type": "test_report",
                                                       "title": f"{LABEL} Deployment test report", "version": "1.0",
                                                       "experiment_id": str(done["id"])},
                  files=[("files", demo.pdf("DEMO-deployment-test-report.pdf"))])
        # Project tasks: one done, one awaiting approval.
        t1 = demo.call("POST", f"/rnd/projects/{pid}/tasks", head, data={
            "title": "DEMO: Finalise cylinder vendor", "assigned_to_id": str(eng.id),
            "due_date": (demo.today + timedelta(days=5)).isoformat(), "remarks": "Two quotes minimum."})
        demo.call("POST", f"/rnd/project-tasks/{t1['id']}/complete", eng, data={"remarks": "DEMO: DEMO Hydro Seals selected — 8 weeks lead time."})
        t2 = demo.call("POST", f"/rnd/projects/{pid}/tasks", head, data={
            "title": "DEMO: Release prototype drawing set to Design", "assigned_to_id": str(eng.id),
            "due_date": (demo.today + timedelta(days=12)).isoformat()})
        demo.call("POST", f"/rnd/project-tasks/{t2['id']}/approvals", eng, data={
            "request": "DEMO: Approve drawing set rev A for release to Design."}, files=[("files", demo.pdf("DEMO-rail-guide-drawings-revA.pdf"))])
        dmrc = tors.get("dmrc_rrv")
        if dmrc:
            demo.call("POST", f"/rnd/requirement-work/inquiry/{dmrc['record_id']}/projects", head, json={"project_id": pid})
    elif key == "battery_rrv":
        demo.call("POST", "/rnd/experiments", eng, json={
            "project_id": pid, "title": f"{LABEL} Duty-cycle simulation (3 h tunnel block)", "experiment_type": "simulation",
            "objective": "Battery state of charge > 20% at block end.", "experiment_date": (demo.today + timedelta(days=14)).isoformat()})
        demo.call("POST", "/rnd/documents", eng, data={"project_id": str(pid), "doc_type": "research_note",
                                                       "title": f"{LABEL} LFP battery vendor survey"},
                  files=[("files", demo.pdf("DEMO-battery-survey.pdf"))])
    elif key == "stone_wear":
        demo.call("POST", "/rnd/documents", head, data={"project_id": str(pid), "doc_type": "process_document",
                                                        "title": f"{LABEL} Handover — sensor installation procedure"},
                  files=[("files", demo.pdf("DEMO-stone-wear-handover.pdf"))])


# ── Entry point ──────────────────────────────────────────────────────────

def seed(demo) -> None:
    ensure_team(demo)
    tors = _tor_map(demo)
    if not tors:
        demo.note("rnd", "no TORs in demo.data (crm seeder not run) — requirement work and technical offers skipped")
    else:
        from app.modules.rnd.models.requirement_work import RndRequirementTask
        first = next(iter(tors.values()))
        already = demo.db.query(RndRequirementTask.id).filter(RndRequirementTask.source == "inquiry",
                                                              RndRequirementTask.record_id.in_([t["record_id"] for t in tors.values()])).first()
        if already:
            demo.note("rnd", f"requirement work already seeded (e.g. {first['tor_number']}) — kept as is")
        else:
            seed_access(demo, tors)
            seed_shares(demo, tors)
            seed_tasks(demo, tors)
            seed_requirement_docs_and_discussion(demo, tors)
            seed_crm_responses(demo, tors)
    seed_technical_offers(demo, tors)
    seed_projects(demo, tors)
