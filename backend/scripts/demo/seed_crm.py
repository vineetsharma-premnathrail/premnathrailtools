"""CRM: inquiries at every pre-sales stage, tenders, activities / follow-ups, stage logs, documents, TORs to R&D.

Everything is done through the real API as the DEMO BD Executive (the
inquiry owner — only the owner may change an inquiry's stage, quote on it or
send it to R&D), so numbering (INQ-/TND-/TOR-), audit, stage logs and the
CRM → R&D request queue are the real ones.

What a tester finds:

  Inquiries   dmrc_rrv      DMRC, 2 x RRV-8W        — qualified → TOR sent → (quotation/sales seeders take it to Order Received)
              nr_rgm        Northern Rly, 1 x RGM-16 — TOR sent → negotiation
              lt_metro_cw   L&T Metro, 4 x CW-BOX    — TOR sent → quotation sent
              crw_hre       CR Matunga, 2 x HRE-150  — TOR sent, R&D reply OVERDUE (due date 3 days ago)
              rvnl_rrv      RVNL, 3 x RRV-8W         — qualified, follow-up OVERDUE
              ircon_tic     IRCON, 1 x TIC-01        — just received, follow-up tomorrow
              nr_cw_lost    Northern Rly, CW-BOX     — Closed – Not Ordered (budget lapsed)
  Tenders     rvnl_tic      RVNL GeM tender, TIC x 2 — awarded, LOA received (sales seeder raises the SO)
              nr_hre        NR open tender, HRE x 3  — bid submitted, awaiting technical opening
  Activities  calls / e-mails / meetings with MoM points, follow-ups Open / Hold / Closed (one overdue).
  Documents   customer RFQ / specification PDFs in Client documents (attached to the TOR), a costing note in Internal.
  Discussion  BD's opening message on the DMRC requirement (R&D replies in the rnd seeder).
  TORs        Word TOR created ("Create Word") then sent, for dmrc_rrv, nr_rgm, lt_metro_cw (due in 5–10 days) and
              crw_hre (sent with today's due date, then the due date is moved 3 days back in the DB — the API
              refuses a past due date, and that is the only way to show an overdue R&D request).

The R&D team (R&D › Settings › Team) is set up first (seed_rnd.ensure_team) so the TORs reach the DEMO R&D Head.

demo.data keys set here:

  inquiries   dict key -> inquiry dict from the API (+ "customer": customers key, "product_code").
              Keys: dmrc_rrv, nr_rgm, lt_metro_cw, crw_hre, rvnl_rrv, ircon_tic, nr_cw_lost.
  tenders     dict key -> tender dict from the API (+ "customer"). Keys: rvnl_tic, nr_hre.
  tors        list of {"source": "inquiry"|"tender", "record_id", "tor_number", "key", "request_id", "due_date"}.
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL

# key: (customer, product code, category, qty, priority, lead source, probability, expected value ₹,
#       status, current stage, delivery months, spec, requirement, delivery location, inspection, warranty)
INQUIRIES = {
    "dmrc_rrv": ("dmrc", "DEMO-RRV-8W", "Road Rail Vehicle", 2, "High", "Exhibition/Event", 70, 29000000,
                 "Qualified", "Requirement Qualified", 9,
                 "Rail-cum-road vehicle for 1435 mm standard gauge, 74 kW Stage V engine, hydraulic rail guide gear, "
                 "300 t haulage on 1:40 gradient, 3 t crane with 6 m outreach, OHE-safe cabin, ATP-compatible speed limiter.",
                 "DEMO: DMRC Track division needs 2 RRVs for night-block material movement and rake shunting on Phase-4 "
                 "corridors (Janakpuri West – RK Ashram). Must run on rail and road, re-rail at any level crossing.",
                 "DMRC Mundka Depot, New Delhi", "RITES inspection at works", "30 months from delivery / 24 from commissioning"),
    "nr_rgm": ("northern_railway", "DEMO-RGM-16", "Rail Vehicle", 1, "High", "Email", 60, 95000000,
               "R&D / Technical Review", "Requirement Qualified", 12,
               "16-stone rail profile grinding machine, 1676 mm broad gauge, 3–8 km/h working speed, dust extraction, "
               "on-board profile measurement before/after grinding, RDSO profile library.",
               "DEMO: Lucknow Division wants one rail grinding machine to remove corrugation and RCF on the "
               "Lucknow–Kanpur main line (high-density network). Evaluating against imported machines.",
               "Charbagh Engineering Depot, Lucknow", "RDSO prototype inspection", "24 months from commissioning"),
    "lt_metro_cw": ("lt_metro", "DEMO-CW-BOX", "Rail Vehicle", 4, "Medium", "Referral", 50, 11200000,
                    "Qualified", "Requirement Qualified", 6,
                    "Flat/box material wagon, 40 t payload, 1435 mm gauge, air brakes compatible with the RRV, "
                    "drop sides, rail-and-sleeper stanchions.",
                    "DEMO: Uppal depot needs 4 material wagons to run behind the RRV for rail and sleeper renewal works.",
                    "Uppal Depot, Hyderabad", "Third-party inspection (customer nominee)", "12 months from delivery"),
    "crw_hre": ("central_railway_workshop", "DEMO-HRE-150", "Hydraulic System", 2, "Medium", "Phone Call", 40, 7600000,
                "R&D / Technical Review", "Requirement Qualified", 5,
                "150 t hydraulic re-railing equipment: 4 lifting jacks, traversing bridge 500 mm stroke, 700 bar "
                "power pack (diesel + electric), all in a road-transportable container.",
                "DEMO: Matunga workshop's accident relief train needs two re-railing sets to replace 25-year-old equipment.",
                "Matunga Workshop, Mumbai", "Inspection by CR Mechanical", "12 months from delivery"),
    "rvnl_rrv": ("rvnl", "DEMO-RRV-8W", "Road Rail Vehicle", 3, "Medium", "LinkedIn", 30, 43500000,
                 "Qualified", "Requirement Qualified", 10,
                 "Rail-cum-road vehicle, 1676 mm gauge, for construction-site material movement on new lines.",
                 "DEMO: RVNL project unit (Rishikesh – Karnaprayag) asked for budgetary prices for 3 RRVs.",
                 "RVNL site office, Rishikesh", None, None),
    "ircon_tic": ("ircon", "DEMO-TIC-01", "Rail Vehicle", 1, "Low", "Website", 20, 21000000,
                  "Requirement Received", "Requirement Received", 12,
                  "Self-propelled track inspection car recording gauge, twist, alignment and unevenness up to 100 km/h.",
                  "DEMO: IRCON (Malaysia project desk) enquired through the website for one track inspection car.",
                  None, None, None),
    "nr_cw_lost": ("northern_railway", "DEMO-CW-BOX", "Rail Vehicle", 6, "Low", "Phone Call", 0, 16800000,
                   "Closed - Not Ordered", "Closed – Not Ordered", 6,
                   "Material wagons, 1676 mm gauge, 40 t payload.",
                   "DEMO: Lucknow Division enquired for 6 material wagons; budget lapsed at year end — closed.",
                   "Alambagh, Lucknow", None, None),
}

# Stage moves logged after creation (the inquiry's stage timeline).
STAGE_LOGS = {
    "dmrc_rrv": [("Requirement Qualified", "DEMO: Site visit done at Mundka depot; requirement and gradient confirmed with Dy. GM / Track.")],
    "nr_rgm": [("Requirement Qualified", "DEMO: Technical meeting with Sr. DEN — RDSO profile library is mandatory."),
               ("Negotiation", "DEMO: Division compares our offer with an imported machine; price discussion pending.")],
    "lt_metro_cw": [("Requirement Qualified", "DEMO: Drawing of existing RRV coupler received from L&T.")],
    "crw_hre": [("Requirement Qualified", "DEMO: Workshop shared the existing re-railing set's layout.")],
    "rvnl_rrv": [("Requirement Qualified", "DEMO: Budgetary enquiry — tender expected next quarter.")],
    "nr_cw_lost": [("Requirement Qualified", None),
                   ("Closed – Not Ordered", "DEMO: Division's sanction lapsed on 31 March; no order this year.")],
}

# TOR to R&D: key -> (days until R&D must reply, CRM remark). crw_hre's due date is moved into the past afterwards.
TORS = {
    "dmrc_rrv": (10, "DEMO: DMRC wants a pre-bid technical clarification meeting in 3 weeks — please confirm gauge "
                     "conversion and 1:40 gradient haulage."),
    "nr_rgm": (7, "DEMO: Customer needs the technical offer before their purchase committee meeting."),
    "lt_metro_cw": (5, "DEMO: Wagons must couple with the RRV already supplied to L&T — check the coupler height."),
    "crw_hre": (0, "DEMO: Please confirm whether one power pack can serve all four jacks simultaneously."),
}
OVERDUE_TOR_DAYS = 3

TENDERS = {
    "rvnl_tic": dict(
        customer="rvnl", tender_number="DEMO/RVNL/TR/2026/117", tender_name=f"{LABEL} Supply of Track Inspection Car (TIC-01) – 2 nos",
        tender_authority="Chief Project Manager, RVNL Delhi", tender_portal="GeM", tender_type="Open Tender",
        tender_category="Rail Vehicle", tender_value=42000000, status="LOA / Order Received", current_stage="Awarded / Lost",
        lead_source="Other", priority="High", publish=-75, submission=-40, opening=-30, financial=-15, award=-5,
        participate=True, awarded_to="Premnath Rail (DEMO)", loi_number="DEMO-LOA-RVNL-2026-031", contract_value=39800000,
        stages=["Documents Downloaded", "Participate Decision", "Technical Offer Prepared", "Commercial Offer Prepared",
                "Management Approval", "Bid Submitted", "Technical Qualified", "Financial Opened", "Awarded / Lost"]),
    "nr_hre": dict(
        customer="northern_railway", tender_number="DEMO/NR/LKO/MECH/2026/42", tender_name=f"{LABEL} Hydraulic Re-railing Equipment 150 t – 3 sets",
        tender_authority="Sr. DME, Northern Railway Lucknow", tender_portal="IREPS", tender_type="Open Tender",
        tender_category="Hydraulic System", tender_value=11400000, status="Tender Submitted", current_stage="Bid Submitted",
        lead_source="Other", priority="Medium", publish=-30, submission=-4, opening=10, financial=None, award=40,
        participate=True, awarded_to=None, loi_number=None, contract_value=None,
        stages=["Documents Downloaded", "Participate Decision", "Costing Completed", "Bid Submitted"]),
}

# (key, type, subject, days from today, next follow-up (days) or None, status, remarks, action plan, MoM points)
ACTIVITIES = [
    ("dmrc_rrv", "Meet at Client/Site Office", "DEMO: Requirement meeting at DMRC Metro Bhawan", -12, None, "Closed",
     "Met Dy. GM / Track and Manager / Procurement. Discussed night-block window (01:00–04:00) and depot clearances.",
     "Send the requirement to R&D; arrange depot visit.",
     [("Night block is only 3 hours — RRV must re-rail within 10 minutes.", "R&D to confirm rail guide gear deployment time.", "R&D", "Within 2 weeks"),
      ("Customer insists on Stage V emission engine.", "Include engine make options in the technical offer.", "BD / R&D", "With offer")]),
    ("dmrc_rrv", "Call", "DEMO: Follow-up call on the technical offer timeline", -2, 3, "Open",
     "Manager / Procurement asked when the technical offer will reach them.", "Share TO number once R&D releases it.", None),
    ("nr_rgm", "Email", "DEMO: RFQ received from Sr. DEN (Co-ord)", -20, None, "Closed",
     "RFQ with RDSO grinding profile requirements received by e-mail.", "Raise inquiry and send to R&D.", None),
    ("nr_rgm", "Meet at Own Office", "DEMO: Division team visited our works", -6, 5, "Open",
     "Showed the RGM-16 prototype; Division asked for the dust-extraction performance figures.",
     "R&D to add dust-extraction data in the technical offer.",
     [("Dust extraction must meet CPCB norms in station areas.", "Add test data to the technical offer.", "R&D", "Next revision")]),
    ("rvnl_rrv", "Call", "DEMO: Budgetary price follow-up with CPM office", -9, -3, "Open",
     "CPM office wants budgetary prices for their DPR. Promised to call back — follow-up is now overdue.", "Call back with budgetary price.", None),
    ("crw_hre", "Meet at Own Office", "DEMO: Workshop engineers reviewed existing re-railing set", -8, 7, "Hold",
     "On hold until R&D confirms the single power pack question.", None, None),
    ("ircon_tic", "Email", "DEMO: Website enquiry acknowledged", 0, 1, "Open",
     "Acknowledged the enquiry; asked for track gauge and recording parameters.", "Call Dy. GM / Procurement tomorrow.", None),
    ("lt_metro_cw", "Call", "DEMO: Coupler height confirmation", -4, None, "Closed",
     "L&T confirmed coupler height 1105 mm from rail level.", None, None),
]


def _product_name(demo, code: str) -> str:
    p = demo.data.get("products", {}).get(code)
    return p["name"] if p else f"{LABEL} {code}"


def _customer(demo, key: str):
    c = demo.data.get("customers", {}).get(key)
    if not c:
        demo.note("crm", f"customer '{key}' missing from foundation — its records were skipped")
    return c


# ── Inquiries ─────────────────────────────────────────────────────────────

def seed_inquiries(demo) -> dict:
    from app.modules.crm.models.inquiry import Inquiry

    bd = demo.data["people"]["bd"]
    out = {}
    for key, (cust, code, category, qty, priority, source, prob, value, status, stage, months, spec, desc,
              location, inspection, warranty) in INQUIRIES.items():
        c = _customer(demo, cust)
        if not c:
            continue
        product = _product_name(demo, code)
        row = demo.db.query(Inquiry).filter(Inquiry.org_id == c["id"], Inquiry.product == product,
                                            Inquiry.is_deleted == False).first()  # noqa: E712
        if row:
            out[key] = {**demo.call("GET", f"/crm/inquiries/{row.id}", bd), "customer": cust, "product_code": code, "_new": False}
            continue
        inq = demo.call("POST", "/crm/inquiries", bd, json={
            "org_id": c["id"], "org_contact_id": c["contact_ids"][0], "railway_zone": c.get("railway_zone"),
            "division": c.get("division_workshop"), "lead_source": source, "bd_owner": bd.name, "sales_engineer": bd.name,
            "status": "Requirement Received", "current_stage": "Requirement Received",
            "product": product, "product_category": category, "product_spec": spec, "quantity": qty,
            "required_delivery_date": (demo.today + timedelta(days=30 * months)).isoformat(),
            "delivery_location": location, "requirement_desc": desc, "inspection_req": inspection, "warranty_req": warranty,
            "project_details": f"{LABEL} customer requirement for {product}.",
            "budget": value * 1.1, "expected_value": value, "probability": prob,
            "expected_order_date": (demo.today + timedelta(days=60)).isoformat(), "priority": priority,
        })
        # Status is a field on the inquiry; the stage moves through the stage log (owner only).
        if status != "Requirement Received":
            inq = demo.call("PATCH", f"/crm/inquiries/{inq['id']}", bd, json={
                "status": status, "current_status_note": f"{LABEL}: {status}"})
        for stg, notes in STAGE_LOGS.get(key, []):
            demo.call("POST", f"/crm/inquiries/{inq['id']}/stages", bd, json={"stage": stg, "notes": notes})
        out[key] = {**demo.call("GET", f"/crm/inquiries/{inq['id']}", bd), "customer": cust, "product_code": code, "_new": True}
    demo.data["inquiries"] = out
    demo.note("crm", f"{len(out)} DEMO inquiries ({', '.join(sorted({v['status'] for v in out.values()}))})")
    return out


# ── Tenders ───────────────────────────────────────────────────────────────

def seed_tenders(demo) -> dict:
    from app.modules.crm.models.tender import Tender

    bd = demo.data["people"]["bd"]
    t0 = demo.today
    day = lambda n: (t0 + timedelta(days=n)).isoformat() if n is not None else None  # noqa: E731
    out = {}
    for key, t in TENDERS.items():
        c = _customer(demo, t["customer"])
        if not c:
            continue
        row = demo.db.query(Tender).filter(Tender.tender_number == t["tender_number"], Tender.is_deleted == False).first()  # noqa: E712
        if row:
            out[key] = {**demo.call("GET", f"/crm/tenders/{row.id}", bd), "customer": t["customer"]}
            continue
        tender = demo.call("POST", "/crm/tenders", bd, json={
            "org_id": c["id"], "org_contact_id": c["contact_ids"][-1], "tender_number": t["tender_number"],
            "tender_name": t["tender_name"], "tender_authority": t["tender_authority"], "tender_portal": t["tender_portal"],
            "tender_type": t["tender_type"], "tender_category": t["tender_category"], "tender_value": t["tender_value"],
            "status": "Tender Published", "current_stage": "Tender Published", "lead_source": t["lead_source"],
            "priority": t["priority"], "bd_owner": bd.name, "railway_zone": c.get("railway_zone"),
            "publish_date": day(t["publish"]), "doc_download_date": day(t["publish"] + 2),
            "pre_bid_meeting_date": day(t["publish"] + 10), "submission_date": day(t["submission"]),
            "opening_date": day(t["opening"]), "financial_opening_date": day(t["financial"]),
            "expected_award_date": day(t["award"]), "participate": t["participate"], "decision_by": bd.name,
            "decision_date": day(t["publish"] + 3),
        })
        for stg in t["stages"]:
            demo.call("POST", f"/crm/tenders/{tender['id']}/stages", bd, json={"stage": stg, "notes": f"{LABEL}: {stg}"})
        patch = {"status": t["status"], "current_stage": t["current_stage"]}
        if t["awarded_to"]:
            patch.update(awarded_to=t["awarded_to"], loi_number=t["loi_number"], contract_value=t["contract_value"])
        tender = demo.call("PATCH", f"/crm/tenders/{tender['id']}", bd, json=patch)
        out[key] = {**tender, "customer": t["customer"]}
    demo.data["tenders"] = out
    demo.note("crm", f"{len(out)} DEMO tenders (awarded with LOA; bid submitted)")
    return out


# ── Activities, documents, discussion ─────────────────────────────────────

def seed_activities(demo, inquiries: dict) -> None:
    bd = demo.data["people"]["bd"]
    made = 0
    for key, atype, subject, when, follow, status, remarks, plan, mom in ACTIVITIES:
        inq = inquiries.get(key)
        if not inq or not inq.get("_new"):
            continue
        c = demo.data["customers"][inq["customer"]]
        demo.call("POST", "/crm/activities", bd, json={
            "activity_type": atype, "subject": subject, "org_id": inq["org_id"], "org_contact_id": inq["org_contact_id"],
            "contact_ids": c["contact_ids"], "related_module": "inquiry", "related_id": inq["id"],
            "universal_id": inq["universal_id"], "activity_date": (demo.today + timedelta(days=when)).isoformat(),
            "next_followup": (demo.today + timedelta(days=follow)).isoformat() if follow is not None else None,
            "assigned_to": bd.name, "status": status, "remarks": remarks, "action_plan": plan,
            "mom_items": [{"observation": o, "action_plan": a, "responsibility": r, "target_date": d} for o, a, r, d in (mom or [])] or None,
        })
        made += 1
    demo.note("crm", f"{made} activities / follow-ups (meetings with MoM, calls, e-mails; one follow-up overdue)")


def _upload(demo, inq: dict, folder: str, category: str, name: str, description: str) -> dict:
    bd = demo.data["people"]["bd"]
    docs = demo.call("POST", "/crm/documents", bd, data={
        "related_module": "inquiry", "related_id": str(inq["id"]), "folder_type": folder, "doc_category": category,
        "universal_id": inq["universal_id"], "org_id": str(inq["org_id"]), "description": description,
    }, files=[("files", demo.pdf(name))])
    return docs[0]


def seed_documents(demo, inquiries: dict) -> dict[str, list[int]]:
    """Client RFQ / spec per inquiry going to R&D (attached to its TOR), plus one internal note."""
    client_docs: dict[str, list[int]] = {}
    for key in TORS:
        inq = inquiries.get(key)
        if not inq or not inq.get("_new"):
            continue
        rfq = _upload(demo, inq, "client", "Customer RFQ", f"DEMO-RFQ-{inq['universal_id']}.pdf",
                      f"{LABEL} customer's RFQ / technical specification")
        client_docs[key] = [rfq["id"]]
    if "dmrc_rrv" in inquiries and inquiries["dmrc_rrv"].get("_new"):
        _upload(demo, inquiries["dmrc_rrv"], "internal", "Costing", "DEMO-budgetary-costing-RRV.pdf",
                f"{LABEL} budgetary costing note (internal)")
        client_docs["dmrc_rrv"].append(_upload(demo, inquiries["dmrc_rrv"], "client", "Drawing", "DEMO-DMRC-depot-layout.pdf",
                                               f"{LABEL} depot track layout from DMRC")["id"])
    demo.note("crm", f"client RFQ documents on {len(client_docs)} inquiries + an internal costing note")
    return client_docs


def seed_discussion(demo, inquiries: dict) -> None:
    inq = inquiries.get("dmrc_rrv")
    if not inq or not inq.get("_new"):
        return
    bd, rnd_head = demo.data["people"]["bd"], demo.data["people"]["rnd_head"]
    demo.call("POST", f"/requirement-discussion/inquiry/{inq['id']}", bd, data={
        "side": "crm", "mention_ids": str(rnd_head.id),
        "body": f"{LABEL}: DMRC confirmed the night block is only 3 hours. Can the RRV re-rail within 10 minutes at a "
                "level crossing? This decides whether they go for our machine.",
    })
    demo.note("crm", "requirement discussion started on the DMRC inquiry (R&D head tagged)")


# ── Technical Offer Requests to R&D ──────────────────────────────────────

def send_tor(demo, source: str, record: dict, due_days: int, remarks: str, document_ids: list[int]) -> dict:
    """'Create Word' for the TOR, then 'Send Technical Requirement to R&D' (BD owner)."""
    bd = demo.data["people"]["bd"]
    entity = "crm_tor_inquiry" if source == "inquiry" else "crm_tor_tender"
    demo.call("POST", f"/managed-documents/{entity}/{record['id']}", bd)
    path = "inquiries" if source == "inquiry" else "tenders"
    sent = demo.call("POST", f"/crm/{path}/{record['id']}/technical-offer-request", bd, json={
        "document_ids": document_ids, "remarks": remarks,
        "response_due_date": (demo.today + timedelta(days=due_days)).isoformat(),
    })
    return sent


def seed_tors(demo, inquiries: dict, client_docs: dict) -> list[dict]:
    from app.modules.crm.models.rnd_request import CrmRndRequest

    tors = []
    for key, (due_days, remarks) in TORS.items():
        inq = inquiries.get(key)
        if not inq:
            continue
        if inq.get("_new"):
            sent = send_tor(demo, "inquiry", inq, due_days, remarks, client_docs.get(key, []))
            inquiries[key].update({k: sent[k] for k in ("technical_offer_number", "technical_offer_sent_at", "status")})
        req = demo.db.query(CrmRndRequest).filter(CrmRndRequest.source == "inquiry", CrmRndRequest.record_id == inq["id"]) \
            .order_by(CrmRndRequest.id.desc()).first()
        if not req:
            continue
        if key == "crw_hre" and inq.get("_new"):
            # No API takes a past due date — backdate so the R&D request shows as overdue.
            req.due_date = demo.today - timedelta(days=OVERDUE_TOR_DAYS)
            demo.db.commit()
        tors.append({"source": "inquiry", "record_id": inq["id"], "tor_number": req.offer_number, "key": key,
                     "request_id": req.id, "due_date": req.due_date.isoformat()})
    demo.data["tors"] = tors
    demo.note("crm", f"{len(tors)} Technical Offer Requests sent to R&D ({', '.join(t['tor_number'] for t in tors)}); "
                     f"crw_hre's due date moved {OVERDUE_TOR_DAYS} days back (DB) so it shows overdue")
    return tors


# ── Entry point ──────────────────────────────────────────────────────────

def seed(demo) -> None:
    from demo.seed_rnd import ensure_team

    ensure_team(demo)   # TORs go to the R&D head(s) from R&D › Settings › Team
    inquiries = seed_inquiries(demo)
    seed_tenders(demo)
    seed_activities(demo, inquiries)
    client_docs = seed_documents(demo, inquiries)
    seed_tors(demo, inquiries, client_docs)
    seed_discussion(demo, inquiries)
    for inq in inquiries.values():
        inq.pop("_new", None)
