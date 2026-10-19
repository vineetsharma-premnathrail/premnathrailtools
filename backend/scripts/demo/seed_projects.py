"""Project Management: 4 standalone projects (planning, active, on hold, technically complete + Final Project Report) with WBS, tasks, time, evidence and documents.

PM stands alone (project decision 2026-10-06): customer / PO are free text,
nothing links to Sales, Store, Procurement, Production or Service. The UI
calls a milestone a "WBS"; every WBS is added by hand (no standard chain);
costing is deliberately not seeded (deferred).

Who does what (real API, real rules):
  * Project Manager (holds All Projects › Create = management) creates the
    projects, adds WBS elements (department + lead + assistants), uploads
    project documents, releases ("Start project"), accepts submitted WBS,
    marks technically complete, drafts the closure note and creates the
    Final Project Report (managed Word document).
  * WBS leads (department heads) create tasks, attach evidence and submit.
  * Assignees start / block / complete their own tasks and log time.
  Leads and assignees get Project Management › Department Work + My Tasks
  through the "DEMO Project team member" role (Purchase and Service have no
  "Ongoing Projects" tab in their own module).

Projects:
  rrv_fleet    Active — Design WBS submitted, waiting for management
               acceptance (parked for you); purchase overlapping design
               (start rule "once a chosen step has started") and overdue
               with a blocked + an overdue task; production in progress;
               electrical in parallel; quality and commissioning not started.
  rgm_dmrc     Planning — WBS defined, not released yet.
  hre_rvnl     Technically complete — every WBS accepted (one late), all
               tasks done, evidence on every WBS, closure note + lessons
               learned drafted, Final Project Report (Word) created: the
               closure checklist is green except the archive confirmation —
               click "Close project" to finish it.
  tic_ircon    On hold — customer specification revision awaited.

demo.data keys set here:
  pm_projects  dict key -> project dict from the API plus
               "wbs": {wbs key -> WBS (milestone) dict} and
               "tasks": {task key -> task dict}.
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL

TEAM_ROLE = "Project team member"


def _d(demo, offset: int) -> str:
    return str(demo.today + timedelta(days=offset))


def _dept(demo, *names: str) -> int:
    depts = demo.data.get("departments") or {}
    for n in names:
        if n in depts:
            return depts[n]
    low = {k.lower(): v for k, v in depts.items()}
    for n in names:
        for k, v in low.items():
            if n.lower() in k:
                return v
    from app.modules.organization.models.department import Department
    for n in names:
        row = demo.db.query(Department).filter(Department.name.ilike(f"%{n}%")).first()
        if row:
            return row.id
    raise SystemExit(f"seed_projects: no department like {names} — run the foundation seeder first.")


# ── Access ────────────────────────────────────────────────────────────────

def seed_team_access(demo) -> None:
    """Department Work + My Tasks for every WBS lead / assignee used below."""
    role = demo.role(TEAM_ROLE, demo.perms("projects", "department_work", "my_tasks"),
                     demo.perms("projects", "all_projects", "milestones", "documents", "overview", actions=["view"]),
                     description=f"{LABEL} role: plan and work project WBS tasks (Department Work + My Tasks).")
    p = demo.data["people"]
    for key in ("design_head", "design_engineer", "purchase_manager", "buyer", "production_manager", "production_supervisor",
                "electrical_head", "quality_manager", "quality_inspector", "service_head", "service_engineer", "hydraulic_head", "store_manager"):
        demo.assign(p[key], role)
    demo.note("projects", f"'{LABEL} {TEAM_ROLE}' role given to 13 WBS leads / team members")


# ── Building blocks (one per document type) ───────────────────────────────

def _project(demo, name, client, po, desc, start, handover, priority) -> dict:
    pm = demo.data["people"]["project_manager"]
    return demo.call("POST", "/projects", pm, json={
        "name": name, "client_name": client, "customer_po_ref": po, "description": desc,
        "project_manager_id": pm.id, "start_date": _d(demo, start), "target_handover_date": _d(demo, handover), "priority": priority})


def _wbs(demo, project, title, dept, lead, team, target, deliverable, rule="after_previous", depends_on=None) -> dict:
    pm = demo.data["people"]["project_manager"]
    p = demo.data["people"]
    return demo.call("POST", f"/projects/{project['id']}/milestones", pm, json={
        "title": title, "department_id": dept, "lead_user_id": p[lead].id, "assistant_user_ids": [p[t].id for t in team],
        "target_date": _d(demo, target), "deliverable": deliverable, "start_rule": rule,
        "depends_on_milestone_id": depends_on["id"] if depends_on else None})


def _document(demo, project, doc_type, title, filename, description=None) -> None:
    pm = demo.data["people"]["project_manager"]
    demo.call("POST", f"/projects/{project['id']}/documents", pm, data={"doc_type": doc_type, "title": title, "description": description or ""},
              files=[("files", demo.pdf(filename))])


def _transition(demo, project, action, **extra) -> dict:
    pm = demo.data["people"]["project_manager"]
    return demo.call("POST", f"/projects/{project['id']}/transition", pm, json={"action": action, **extra})


def _task(demo, wbs, lead, title, assignee, due, est=None, priority="medium", desc=None) -> dict:
    p = demo.data["people"]
    return demo.call("POST", f"/pm-work/milestones/{wbs['id']}/tasks", p[lead], json={
        "title": title, "description": desc, "assignee_id": p[assignee].id, "due_date": _d(demo, due),
        "priority": priority, "estimated_hours": est})


def _work(demo, task, assignee, state, hours=(), block_reason=None, comment=None) -> dict:
    """Assignee moves their task: 'start' → In progress, 'done' → Done,
    'blocked'; hours = [(days ago, h, note)] logged on the way."""
    u = demo.data["people"][assignee]
    base = f"/pm-work/tasks/{task['id']}"
    if state == "todo":
        return task
    out = demo.call("POST", f"{base}/start", u)
    for ago, h, note in hours:
        out = demo.call("POST", f"{base}/time", u, json={"work_date": _d(demo, -ago), "hours": h, "note": note})
    if comment:
        out = demo.call("POST", f"{base}/comments", u, json={"comment": comment})
    if state == "blocked":
        out = demo.call("POST", f"{base}/block", u, json={"reason": block_reason})
    elif state == "done":
        out = demo.call("POST", f"{base}/complete", u)
    return out


def _evidence(demo, wbs, lead, doc_type, title, filename) -> None:
    demo.call("POST", f"/pm-work/milestones/{wbs['id']}/files", demo.data["people"][lead],
              data={"doc_type": doc_type, "title": title}, files=[("files", demo.pdf(filename))])


def _submit(demo, wbs, lead, note) -> dict:
    return demo.call("POST", f"/pm-work/milestones/{wbs['id']}/submit", demo.data["people"][lead], json={"submission_note": note})


def _accept(demo, project, wbs, actual) -> dict:
    pm = demo.data["people"]["project_manager"]
    return demo.call("POST", f"/projects/{project['id']}/milestones/{wbs['id']}/accept", pm, json={"actual_date": _d(demo, actual)})


# ── Projects ──────────────────────────────────────────────────────────────

def seed_rrv_fleet(demo) -> dict:
    """Active project mid-way: overlapping WBS, overdue + blocked tasks,
    Design WBS waiting for management acceptance."""
    proj = _project(demo, f"{LABEL} RRV-8W fleet supply – 2 vehicles", f"{LABEL} Northern Railway – Lucknow Division",
                    "NR/LKO/TM/2026/114 dt 12-06-2026",
                    "Design, build, inspect and commission two 8-wheel rail-cum-road vehicles for track maintenance, incl. operator training.",
                    -75, 110, "high")
    _document(demo, proj, "contract", "Letter of Acceptance – NR/LKO/TM/2026/114", "LOA-NR-LKO-114.pdf", "Signed LOA with delivery schedule.")
    _document(demo, proj, "specification", "Customer technical specification RRV-8W rev 2", "NR-Spec-RRV8W-rev2.pdf")
    w = {}
    w["design"] = _wbs(demo, proj, "Design release & BOM freeze", _dept(demo, "Design"), "design_head", ["design_engineer"], -20,
                       "GA + manufacturing drawings approved by customer; production BOM released.")
    w["purchase"] = _wbs(demo, proj, "Long-lead procurement (engine, guide wheels, tyres)", _dept(demo, "Purchase"), "purchase_manager", ["buyer"], -3,
                         "POs placed and material received for both vehicles.", rule="after_step_started", depends_on=w["design"])
    w["production"] = _wbs(demo, proj, "Fabrication & assembly – 2 vehicles", _dept(demo, "Production"), "production_manager", ["production_supervisor"], 60,
                           "Both vehicles assembled and pre-delivery checked.", rule="after_step_started", depends_on=w["purchase"])
    w["electrical"] = _wbs(demo, proj, "Electrical & control integration", _dept(demo, "Electrical"), "electrical_head", [], 65,
                           "Harness and control panels fitted, function-tested.", rule="with_previous")
    w["quality"] = _wbs(demo, proj, "Final & customer inspection", _dept(demo, "Quality"), "quality_manager", ["quality_inspector"], 85,
                        "Final inspection report + customer inspection certificate.")
    w["commissioning"] = _wbs(demo, proj, "Dispatch, commissioning & training", _dept(demo, "Service"), "service_head", ["service_engineer"], 110,
                              "Commissioning certificate signed at site; operators trained.")
    proj = _transition(demo, proj, "activate")

    t = {}
    t["ga"] = _work(demo, _task(demo, w["design"], "design_head", "GA drawing approval with customer", "design_engineer", -35, 40, "high"),
                    "design_engineer", "done", hours=[(45, 8, "GA rev A"), (40, 6, "Customer comments incorporated")])
    t["bom"] = _work(demo, _task(demo, w["design"], "design_head", "Release manufacturing BOM", "design_head", -22, 16),
                     "design_head", "done", hours=[(24, 6, "BOM review with production")])
    _evidence(demo, w["design"], "design_head", "drawing", "GA drawing DEMO-RRV8W-GA-001 rev C (approved)", "RRV8W-GA-001-revC.pdf")
    w["design"] = _submit(demo, w["design"], "design_head",
                          "GA rev C approved by customer (letter attached); BOM DEMO-RRV-8W released to Production.")

    t["engine_po"] = _work(demo, _task(demo, w["purchase"], "purchase_manager", "Place PO for 74 kW engines (2 nos)", "buyer", -30, 8, "high"),
                           "buyer", "done", hours=[(31, 3, "Techno-commercial comparison")])
    t["wheels"] = _work(demo, _task(demo, w["purchase"], "purchase_manager", "Expedite rail guide wheels (8 nos)", "buyer", -6, 6, "high"),
                        "buyer", "start", hours=[(5, 2, "Vendor visit planned")],
                        comment="Vendor confirms dispatch next week; heat treatment certificate pending.")
    t["tyres"] = _work(demo, _task(demo, w["purchase"], "purchase_manager", "Road tyres 10.00 R20 – 2 short", "buyer", -4, 4),
                       "buyer", "blocked", block_reason="Vendor out of stock until month end; alternate make needs Design approval.")
    t["chassis"] = _work(demo, _task(demo, w["production"], "production_manager", "Chassis fabrication – vehicle 1", "production_supervisor", -10, 48),
                         "production_supervisor", "done", hours=[(20, 8, "Cutting"), (18, 8, "Welding"), (15, 8, "Machining & paint")])
    t["assembly1"] = _work(demo, _task(demo, w["production"], "production_manager", "Main assembly – vehicle 1", "production_supervisor", 12, 80, "high"),
                           "production_supervisor", "start", hours=[(3, 8, "Engine & driveline"), (2, 8, "Guide-wheel bogies")])
    t["assembly2"] = _task(demo, w["production"], "production_manager", "Main assembly – vehicle 2", "production_supervisor", 50, 80)
    t["harness"] = _task(demo, w["electrical"], "electrical_head", "Issue harness drawings to shop floor", "electrical_head", -2, 12, "high")
    t["fir"] = _task(demo, w["quality"], "quality_manager", "Prepare final inspection checklist", "quality_inspector", 70, 6)
    t["site"] = _task(demo, w["commissioning"], "service_head", "Site readiness check with SSE/TM Lucknow", "service_engineer", 95, 8)
    demo.note("projects", f"{proj['project_code']} active — Design WBS submitted, waiting for management acceptance (you); purchase overdue")
    return {**proj, "wbs": w, "tasks": t}


def seed_rgm_planning(demo) -> dict:
    """Planning project: WBS drafted, not released to departments yet."""
    proj = _project(demo, f"{LABEL} Rail Grinding Machine RGM-16 – metro", f"{LABEL} Delhi Metro Rail Corporation",
                    "DMRC/RS/RGM/2026/07 (LOA awaited)", "One 16-stone rail grinding machine for metro standard-gauge track.", 10, 240, "medium")
    _document(demo, proj, "specification", "DMRC tender specification – rail grinding machine", "DMRC-RGM-Spec.pdf")
    w = {
        "design": _wbs(demo, proj, "Concept & detailed design (standard gauge)", _dept(demo, "Design"), "design_head", ["design_engineer"], 90,
                       "Design review passed; drawings and BOM released."),
        "hydraulics": _wbs(demo, proj, "Grinding-head hydraulics", _dept(demo, "Fluids", "Hydraulic"), "hydraulic_head", [], 120,
                           "Hydraulic circuit and HPU tested at 210 bar.", rule="with_previous"),
        "production": _wbs(demo, proj, "Manufacturing & assembly", _dept(demo, "Production"), "production_manager", ["production_supervisor"], 200,
                           "Machine assembled and functionally tested."),
    }
    demo.note("projects", f"{proj['project_code']} in planning — 3 WBS, not released")
    return {**proj, "wbs": w, "tasks": {}}


def seed_hre_ready_for_closure(demo) -> dict:
    """Every WBS accepted, technically complete, closure note + Final
    Project Report drafted — only the Close click is left."""
    proj = _project(demo, f"{LABEL} Hydraulic re-railing equipment – 5 sets", f"{LABEL} Rail Vikas Nigam Ltd",
                    "RVNL/ENG/HRE/2026/03 dt 02-03-2026", "Supply of five 150 t hydraulic re-railing sets with training of crews.",
                    -180, -15, "medium")
    _document(demo, proj, "contract", "Purchase order RVNL/ENG/HRE/2026/03", "RVNL-PO-HRE-03.pdf")
    w = {
        "design": _wbs(demo, proj, "Design adaptation for 150 t", _dept(demo, "Design"), "design_head", ["design_engineer"], -150,
                       "Calculation report + drawings approved."),
        "purchase": _wbs(demo, proj, "Seal kits & pumps procurement", _dept(demo, "Purchase"), "purchase_manager", ["buyer"], -110,
                         "All bought-out items received with test certificates."),
        "production": _wbs(demo, proj, "Manufacturing & 700 bar proof test", _dept(demo, "Production"), "production_manager", ["production_supervisor"], -45,
                           "Five sets built; proof-test reports signed by Quality."),
        "supply": _wbs(demo, proj, "Supply & crew training", _dept(demo, "Service"), "service_head", ["service_engineer"], -20,
                       "Delivery challans acknowledged; training attendance sheets."),
    }
    proj = _transition(demo, proj, "activate")
    plan = [  # wbs, lead, task, assignee, due, est, hours, evidence (type, title, file), handover note, accepted (days ago)
        ("design", "design_head", "Re-check ram & bridge calculations for 150 t", "design_engineer", -155, 24, [(170, 8, "FEA"), (165, 8, "Report")],
         ("report", "Calculation report HRE-150", "HRE150-Calc.pdf"), "Calc report rev 1 and drawings HRE-150-001..009 approved by RVNL.", -152),
        ("purchase", "purchase_manager", "Place POs for seal kits and gear pumps", "buyer", -118, 10, [(125, 4, "RFQ comparison")],
         ("certificate", "Test certificates – seal kits & pumps", "HRE150-TCs.pdf"), "All items received; TCs filed. Pumps were 6 days late.", -104),
        ("production", "production_manager", "Build & proof-test 5 sets at 700 bar", "production_supervisor", -48, 120,
         [(60, 8, "Set 1-2"), (55, 8, "Set 3-4"), (50, 8, "Set 5 + tests")],
         ("report", "Proof test reports – 5 sets", "HRE150-ProofTests.pdf"), "Five sets passed 700 bar / 15 min; reports signed by Quality.", -44),
        ("supply", "service_head", "Deliver and train 3 crews", "service_engineer", -22, 30, [(25, 8, "Training at Bhopal"), (23, 8, "Training at Jhansi")],
         ("report", "Training attendance & delivery challans", "HRE150-Training.pdf"), "Delivered; 3 crews trained; acknowledgement attached.", -18),
    ]
    tasks = {}
    for wk, lead, title, who, due, est, hours, (dtype, dtitle, dfile), note, accepted in plan:
        tasks[wk] = _work(demo, _task(demo, w[wk], lead, title, who, due, est), who, "done", hours=hours)
        _evidence(demo, w[wk], lead, dtype, dtitle, dfile)
        _submit(demo, w[wk], lead, note)
        w[wk] = _accept(demo, proj, w[wk], accepted)
    proj = _transition(demo, proj, "complete")
    pm = demo.data["people"]["project_manager"]
    proj = demo.call("PATCH", f"/projects/{proj['id']}", pm, json={
        "closure_note": "All 5 sets delivered and accepted; final bill raised, 10% retention due after 12-month warranty. Warranty from delivery.",
        "lessons_learned": "Order gear pumps at design freeze, not after — 6-day slip came from pump lead time. Keep a spare seal kit per set."})
    status, body = demo.try_call("POST", f"/managed-documents/pm_project_closure_report/{proj['id']}", pm)
    if status in (200, 201):
        demo.note("projects", f"{proj['project_code']} technically complete — Final Project Report (Word) created; ready to close")
    else:
        demo.note("projects", f"{proj['project_code']} technically complete but the Final Project Report failed ({status}): {body}")
    checks = demo.call("GET", f"/projects/{proj['id']}/closure", pm)
    # "Documents archived" is confirmed in the Close dialog itself.
    pending = [c["label"] for c in checks["checks"] if not c["ok"] and c["key"] != "documents_archived"]
    if pending:
        demo.note("projects", f"{proj['project_code']} closure checklist still open: {', '.join(pending)}")
    return {**proj, "wbs": w, "tasks": tasks}


def seed_tic_on_hold(demo) -> dict:
    """Released, work started, then put on hold by the PM."""
    proj = _project(demo, f"{LABEL} Track Inspection Car TIC-01", f"{LABEL} IRCON International Ltd", "IRCON/PROC/TIC/2026/22",
                    "One track inspection car with gauge/twist/alignment recording.", -40, 150, "medium")
    w = {
        "design": _wbs(demo, proj, "Sensor beam & body design", _dept(demo, "Design"), "design_head", ["design_engineer"], 30,
                       "Drawings and sensor layout approved."),
        "production": _wbs(demo, proj, "Build & calibration", _dept(demo, "Production"), "production_manager", ["production_supervisor"], 130,
                           "Car built and calibrated on test track."),
    }
    proj = _transition(demo, proj, "activate")
    t = {"layout": _work(demo, _task(demo, w["design"], "design_head", "Sensor layout for 1676 mm gauge", "design_engineer", 10, 30),
                         "design_engineer", "start", hours=[(6, 6, "Beam concept")])}
    proj = _transition(demo, proj, "hold", reason="IRCON is revising the recording-parameter specification (adds rail profile); "
                                                   "design paused until the revised spec arrives.")
    demo.note("projects", f"{proj['project_code']} on hold — waiting for revised customer specification")
    return {**proj, "wbs": w, "tasks": t}


def _reuse(demo) -> bool:
    from app.modules.projects.models.project import PmProject
    rows = demo.db.query(PmProject).filter(PmProject.name.like(f"{LABEL} %")).all()
    if not rows:
        return False
    pm = demo.data["people"]["project_manager"]
    demo.data["pm_projects"] = {r.project_code: {**demo.call("GET", f"/projects/{r.id}", pm), "wbs": {}, "tasks": {}} for r in rows}
    demo.note("projects", f"already seeded — reused {len(rows)} DEMO projects")
    return True


def seed(demo) -> None:
    seed_team_access(demo)
    if _reuse(demo):
        return
    demo.data["pm_projects"] = {
        "rrv_fleet": seed_rrv_fleet(demo),
        "rgm_dmrc": seed_rgm_planning(demo),
        "hre_rvnl": seed_hre_ready_for_closure(demo),
        "tic_ircon": seed_tic_on_hold(demo),
    }
