"""Service (ERP): machines in the field, service requests at every stage, service material (store issue / PR), Word letters.

Service is where the core flow ends: a machine that Production built and
handed over (or one already in the field) is an ERP "machine" (erp_projects,
one row per serial), and every customer call becomes a service request
against it — warranty, AMC or paid.

What it makes (all "DEMO", through the real API as the right person):

* Machines — the Service Head registers the field fleet for the foundation
  customers (RRVs, rail grinders, a track inspection car), commissioning and
  handover done, warranty / AMC / out-of-cover mixed. Serial = identity
  (project decision): an existing serial is reused, never duplicated.
  Production's `finished_machines` close the core flow: the RRV (already an
  ERP machine from RRV Completion — found by id/serial, never duplicated)
  is dispatched by the Store Keeper (Store issue type "dispatch" against
  the machine, Quality's dispatch block applies) and commissioned; the TIC
  is registered, dispatched and awaiting commissioning; the HRE set stays in
  FG stock. Each dispatched one gets its installation & commissioning SR.
* Machine documents — a commissioning certificate PDF upload, and letters on
  the letterhead (Delivery Cover Letter, Guarantee Certificate, a general
  letter) each with its managed Word document created ("Save & Edit in
  Word" is the primary path; PDF secondary).
* Service requests — one per stage: open, acknowledged, assigned (overdue),
  scheduled, in progress, pending parts, on hold, work completed, review,
  closed, cancelled; service types installation/commissioning, warranty,
  AMC, breakdown, inspection, paid service (billing filled on paid jobs).
  The Field Service Engineer raises and works most of them (only the
  creator may edit an SR); the Service Head logs one fresh customer call.
* Service material — spares for a warranty job issued by the Store Keeper
  from Store against the machine (Store issue with erp_project_id, SR no. in
  the reference) and marked received on the SR; a part not in stock raised
  to Purchase as a PR from the SR's Materials tab.
* Final approval for you (`demo.me`): with Service › Settings "Closing a
  service request needs approval" on, the paid job in Review waits for your
  closure approval; with it off the SR just sits in Review (noted).

demo.data keys set here:

  machines          dict serial -> machine dict from the API (+ "customer_key").
  service_requests  dict request_number -> SR dict from the API (+ "key", the
                    seeder's own name for it, e.g. "nr_leak").
  service_prs       list of P2P request dicts raised from SRs.
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL


def _fy(d) -> str:
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def _months(d, n: int):
    y, m = divmod(d.month - 1 + n, 12)
    day = min(d.day, 28)
    return d.replace(year=d.year + y, month=m + 1, day=day)


def _setting(demo, key: str) -> bool:
    from app.modules.erp.settings import get_setting
    return bool(get_setting(demo.db, key))


# ── Machines ──────────────────────────────────────────────────────────────
# serial: (model, product code, machine type, application, customer key,
#          site name, site location, state, pin, zone, days since delivery,
#          warranty months, amc status, status, operator, engine no., chassis no.)
MACHINES = {
    "DEMO-PEW-RRV-0101": ("RRV-8W Rail-cum-Road Vehicle", "DEMO-RRV-8W", "RRV", "Track maintenance & renewal", "northern_railway",
                          "DEMO Charbagh PWI Depot", "Lucknow", "Uttar Pradesh", "226004", "Northern Railway", 420, 24, None,
                          "active", "DEMO Ramesh Yadav (Loco Pilot – RRV)", "DEMO-ENG-74K-0101", "DEMO-CH-8W-0101"),
    "DEMO-PEW-RRV-0102": ("RRV-8W Rail-cum-Road Vehicle", "DEMO-RRV-8W", "RRV", "Depot shunting", "central_railway_workshop",
                          "DEMO Matunga Workshop – Bay 4", "Mumbai", "Maharashtra", "400019", "Central Railway", 900, 24, "active",
                          "active", "DEMO Suresh Kamble (Shunter)", "DEMO-ENG-74K-0102", "DEMO-CH-8W-0102"),
    "DEMO-PEW-RGM-0201": ("RGM-16 Rail Grinding Machine", "DEMO-RGM-16", "Rail Grinder", "Rail profile grinding", "dmrc",
                          "DEMO DMRC Yamuna Bank Depot", "New Delhi", "Delhi", "110092", None, 300, 24, None,
                          "under_service", "DEMO Anil Kumar (Grinding Operator)", "DEMO-ENG-RGM-0201", "DEMO-CH-RGM-0201"),
    "DEMO-PEW-TIC-0301": ("TIC-01 Track Inspection Car", "DEMO-TIC-01", "Inspection Car", "Track inspection & recording", "rvnl",
                          "DEMO RVNL Project Site – Rishikesh–Karnaprayag", "Rishikesh", "Uttarakhand", "249201", "Northern Railway", 1200, 18, None,
                          "active", "DEMO Deepak Negi (Inspection Operator)", "DEMO-ENG-TIC-0301", "DEMO-CH-TIC-0301"),
    "DEMO-PEW-RRV-0103": ("RRV-8W Rail-cum-Road Vehicle", "DEMO-RRV-8W", "RRV", "Track maintenance & renewal", "lt_metro",
                          "DEMO L&T Metro Uppal Depot", "Hyderabad", "Telangana", "500039", None, 45, 24, None,
                          "active", "DEMO K. Raju (RRV Operator)", "DEMO-ENG-74K-0103", "DEMO-CH-8W-0103"),
    "DEMO-PEW-RGM-0202": ("RGM-16 Rail Grinding Machine", "DEMO-RGM-16", "Rail Grinder", "Rail profile grinding", "ircon",
                          "DEMO IRCON Track Project – Sivok–Rangpo", "Siliguri", "West Bengal", "734001", "Northeast Frontier Railway", 120, 24, None,
                          "active", "DEMO Bikash Roy (Grinding Operator)", "DEMO-ENG-RGM-0202", "DEMO-CH-RGM-0202"),
    # Dispatched, commissioning still to do — the installation SR is open on it.
    "DEMO-PEW-RRV-0104": ("RRV-8W Rail-cum-Road Vehicle", "DEMO-RRV-8W", "RRV", "Accident relief & re-railing", "northern_railway",
                          "DEMO Alambagh ART Depot", "Lucknow", "Uttar Pradesh", "226005", "Northern Railway", 6, 24, None,
                          "work_in_progress", None, "DEMO-ENG-74K-0104", "DEMO-CH-8W-0104"),
}


def _machine_payload(demo, serial: str, row) -> dict:
    (model, product, mtype, application, cust_key, site, location, state, pin, zone, days, warranty_m, amc,
     status, operator, engine, chassis) = row
    cust = demo.data["customers"][cust_key]
    contact = (cust.get("contacts") or [{}])[0]
    delivered = demo.today - timedelta(days=days)
    commissioned = delivered + timedelta(days=12) if status != "work_in_progress" else None
    handover = commissioned + timedelta(days=2) if commissioned else None
    w_start = handover or delivered
    payload = {
        "serial_number": serial, "model_name": f"{LABEL} {model}", "machine_type": mtype, "application_type": application,
        "engine_number": engine, "chassis_number": chassis, "status": status,
        "po_number": f"DEMO/{cust_key.upper()[:4]}/LOA/{serial[-4:]}", "po_date": str(delivered - timedelta(days=210)),
        "delivery_date": str(delivered), "commissioning_date": str(commissioned) if commissioned else None,
        "handover_date": str(handover) if handover else None,
        "client_company": cust["name"], "client_name": contact.get("name"), "client_designation": contact.get("designation"),
        "client_email": contact.get("email"), "client_phone": contact.get("mobile"),
        "client_address": ", ".join(x for x in (cust.get("address"), cust.get("city"), cust.get("state"), cust.get("pin_code")) if x),
        "client_gst": cust.get("gst_number"),
        "site_name": site, "site_location": location, "site_state": state, "site_pincode": pin, "site_country": "India", "zone": zone,
        "warranty_start_date": str(w_start), "warranty_end_date": str(_months(w_start, warranty_m)),
        "warranty_terms": f"{warranty_m} months from commissioning or {warranty_m + 6} months from supply, whichever is earlier. "
                          "Wear parts (grinding stones, filters, tyres) excluded.",
        "amc_status": amc, "amc_end_date": str(_months(demo.today, 9)) if amc else None,
        "operator_name": operator, "operator_phone": "+91 98100 4" + serial[-4:] + "0" if operator else None,
        "operator_qualification": "Trained & certified by Premnath service (DEMO)" if operator else None,
        "specifications": {"DEMO-RRV-8W": "74 kW CEV Stage V engine; rail 40 km/h, road 60 km/h; 300 t haulage; BG 1676 mm.",
                           "DEMO-RGM-16": "16 grinding stones, 22 kW each; working speed 3–8 km/h; dust extraction.",
                           "DEMO-TIC-01": "Track geometry recording, laser rail profile, video; 18-month warranty."}[product],
        "software_version": "PLC v2.4.1" if product != "DEMO-TIC-01" else "TRS v5.0",
        "year_of_manufacture": _fy(delivered - timedelta(days=30)),
        "notes": f"{LABEL} machine — commissioning done at site, customer acceptance signed." if commissioned else
                 f"{LABEL} machine — dispatched, commissioning at site pending.",
    }
    return {k: v for k, v in payload.items() if v is not None}


def _approve_if_pending(demo, m: dict, park: bool) -> dict:
    """With 'New machines need approval' on, a machine starts pending. You
    (demo.me) approve all but the newest one, which is left for you."""
    if m.get("approval_status") != "pending":
        return m
    if park:
        demo.note("erp", f"machine {m['serial_number']} is pending YOUR approval (Service › Machines)")
        return m
    return demo.call("POST", f"/erp/projects/{m['id']}/approve", demo.me, json={"remarks": "DEMO: machine details checked."})


def seed_machines(demo) -> None:
    """The field fleet, registered by the Service Head; serial = identity."""
    from app.modules.erp.models.project import Project

    head = demo.data["people"]["service_head"]
    machines = {}
    for serial, row in MACHINES.items():
        existing = demo.db.query(Project).filter(Project.serial_number == serial).first()
        if existing and not existing.is_deleted:
            m = demo.call("GET", f"/erp/projects/{existing.id}", head)
        elif existing:
            demo.note("erp", f"machine {serial} is in the Recycle Bin — left there, not re-created (serial is unique)")
            continue
        else:
            m = demo.call("POST", "/erp/projects", head, json=_machine_payload(demo, serial, row))
        m = _approve_if_pending(demo, m, park=serial == "DEMO-PEW-RRV-0104")
        machines[serial] = {**m, "customer_key": row[4]}
    demo.data["machines"] = machines
    demo.note("erp", f"{len(machines)} DEMO machines in the field (warranty / AMC / out of cover)")


# Production's finished machines: what happens to each after the factory.
# product code -> (fallback customer, plan, site, location, state, pin, days since dispatch)
#   commissioned           dispatched to site, commissioned, live in Service
#   awaiting_commissioning dispatched, commissioning visit scheduled
#   fg_stock               stays in finished-goods stock (not dispatched yet)
HANDOVER = {
    "DEMO-RRV-8W": ("northern_railway", "commissioned", "DEMO Lucknow Jn. Track Machine Siding", "Lucknow", "Uttar Pradesh", "226001", 9),
    "DEMO-TIC-01": ("rvnl", "awaiting_commissioning", "DEMO RVNL Rishikesh Yard", "Rishikesh", "Uttarakhand", "249201", 3),
    "DEMO-HRE-150": ("central_railway_workshop", "fg_stock", None, None, None, None, 0),
    "DEMO-RGM-16": ("dmrc", "fg_stock", None, None, None, None, 0),
}


def _customer_key(demo, name: str | None, fallback: str) -> str:
    for k, c in demo.data["customers"].items():
        if name and c.get("name", "").lower() == name.lower():
            return k
    return fallback


def _client_fields(demo, cust_key: str) -> dict:
    cust = demo.data["customers"][cust_key]
    contact = (cust.get("contacts") or [{}])[0]
    return {k: v for k, v in {
        "client_company": cust["name"], "client_name": contact.get("name"), "client_designation": contact.get("designation"),
        "client_email": contact.get("email"), "client_phone": contact.get("mobile"), "client_gst": cust.get("gst_number"),
        "client_address": ", ".join(x for x in (cust.get("address"), cust.get("city"), cust.get("state"), cust.get("pin_code")) if x),
    }.items() if v}


def _fg_location(demo, item_id: int, serial: str) -> tuple[int | None, float]:
    """Where the finished machine sits in Store and how much of that serial
    is still on hand there (from the stock balances)."""
    from app.modules.store.models.stock_transaction import StoreStockTransaction as T
    from app.modules.store.services.stock_ledger import _OUTBOUND_TYPES

    rows = demo.db.query(T.location_id, T.transaction_type, T.quantity).filter(T.item_id == item_id, T.batch_number == serial).all()
    on_hand: dict[int, float] = {}
    for loc, ttype, qty in rows:
        sign = -1 if ttype in _OUTBOUND_TYPES else 1
        on_hand[loc] = on_hand.get(loc, 0.0) + sign * float(qty or 0)
    if not on_hand:
        return None, 0.0
    loc = max(on_hand, key=on_hand.get)
    return loc, on_hand[loc]


def _dispatch(demo, m: dict, item_id: int, serial: str, order: str | None, days: int) -> str | None:
    """Store Keeper dispatches the finished machine to the customer: a Store
    issue of type 'dispatch' against the ERP machine (Quality's dispatch
    block checks the final inspection / third-party certificate)."""
    loc, qty = _fg_location(demo, item_id, serial)
    if not loc or qty < 1:
        demo.note("erp", f"{serial}: not in finished-goods stock (already dispatched or never received) — dispatch skipped")
        return None
    keeper = demo.data["people"]["store_keeper"]
    payload = {
        "location_id": loc, "issue_type": "dispatch", "erp_project_id": m["id"],
        "project_or_work_order": order or m["serial_number"], "challan_number": f"DEMO-DSP-{serial[-6:]}",
        "vendor_name": m.get("client_company"), "issue_date": str(demo.today - timedelta(days=days)),
        "remarks": f"{LABEL} dispatch of {serial} to {m.get('site_name') or m.get('client_company')} on trailer.",
        "items": [{"item_id": item_id, "quantity": 1, "batch_number": serial, "remarks": "Finished machine"}],
    }
    status, body = demo.try_call("POST", "/store/material-issues", keeper, json=payload)
    if status >= 400 and "date" in str(body).lower():
        status, body = demo.try_call("POST", "/store/material-issues", keeper, json={**payload, "issue_date": str(demo.today)})
    if status >= 400:
        demo.note("erp", f"dispatch of {serial} refused ({status}): {body.get('detail') if isinstance(body, dict) else body}")
        return None
    return body["issue_number"]


def adopt_finished_machines(demo) -> None:
    """Production -> Dispatch -> Commissioning -> Machine. For each finished
    machine (`finished_machines`): the RRV already has its ERP machine (made
    at RRV Completion, looked up by id / serial — never duplicated); the
    others are registered by the Service Head. One is dispatched and
    commissioned, one dispatched and awaiting commissioning, one stays in
    FG stock."""
    from app.modules.erp.models.project import Project

    fm = demo.data.get("finished_machines")
    if not fm:
        demo.note("erp", "no finished_machines from Production in this run — the service fleet is the DEMO field machines only")
        return
    head = demo.data["people"]["service_head"]
    prod_items = demo.data.get("production_items", {})
    handover_srs, done = [], []
    for r in (fm.values() if isinstance(fm, dict) else fm):
        r = r if isinstance(r, dict) else {"serial_no": str(r)}
        serial = r.get("serial_no") or r.get("serial_number") or r.get("serial")
        pc = r.get("product_code")
        if not serial or pc not in HANDOVER:
            continue
        fallback, plan, site, city, state, pin, days = HANDOVER[pc]
        if plan == "fg_stock":
            demo.note("erp", f"{serial} stays in finished-goods stock — not dispatched, no ERP machine yet")
            continue
        cust_key = _customer_key(demo, r.get("customer"), fallback)
        q = demo.db.query(Project).filter(Project.is_deleted == False)  # noqa: E712
        p = (q.filter(Project.id == r["erp_project_id"]).first() if r.get("erp_project_id") else None) or \
            q.filter(Project.serial_number == serial).first()
        product = demo.data.get("products", {}).get(pc, {})
        site_fields = {"site_name": site, "site_location": city, "site_state": state, "site_pincode": pin, "site_country": "India"}
        if p:
            m = demo.call("GET", f"/erp/projects/{p.id}", head)
            fill = {k: v for k, v in {**_client_fields(demo, cust_key), **site_fields}.items() if not m.get(k)}
            if fill:
                m = demo.call("PATCH", f"/erp/projects/{p.id}", head, json=fill)
        else:
            m = demo.call("POST", "/erp/projects", head, json={
                "serial_number": serial, "model_name": product.get("name") or f"{LABEL} {pc}", "machine_type": pc.split("-")[1],
                "status": "work_in_progress", "po_number": r.get("sales_order"), "year_of_manufacture": _fy(demo.today),
                "notes": f"{LABEL} machine built on {r.get('work_order_number')} — registered by Service for dispatch.",
                **_client_fields(demo, cust_key), **site_fields})
            m = _approve_if_pending(demo, m, park=False)
        item_id = (prod_items.get(pc) or {}).get("id")
        issue = _dispatch(demo, m, item_id, serial, r.get("sales_order"), days) if item_id else None
        if not item_id:
            demo.note("erp", f"{serial}: no finished-goods item for {pc} in production_items — dispatch skipped")
        delivered = demo.today - timedelta(days=days)
        upd = {"delivery_date": str(delivered)}
        if plan == "commissioned":
            comm = delivered + timedelta(days=5)
            upd.update(status="active", commissioning_date=str(comm), operator_name=f"{LABEL} Customer operator (trained at commissioning)",
                       notes=f"{LABEL} built on {r.get('work_order_number')}, dispatched on {issue or 'Store issue'}, commissioned at site.")
            if not m.get("warranty_start_date"):
                upd.update(warranty_start_date=str(comm), warranty_end_date=str(_months(comm, 24)))
        else:
            upd.update(status="work_in_progress", notes=f"{LABEL} dispatched on {issue or 'Store issue'} — commissioning at site pending.")
        m = demo.call("PATCH", f"/erp/projects/{m['id']}", head, json=upd)
        demo.data["machines"][m["serial_number"]] = {**m, "customer_key": cust_key}
        handover_srs.append((f"handover_{pc}", m["serial_number"], "service_engineer", "installation_commissioning", "standard",
                             f"Installation & commissioning of {serial} at {site}",
                             f"Machine dispatched from Premnath ({issue or 'store issue'}); unloading, PDI, commissioning trials and operator training at site.",
                             "Commissioning", "closed" if plan == "commissioned" else "scheduled"))
        done.append(f"{serial} ({plan.replace('_', ' ')}{', ' + issue if issue else ''})")
    demo.data["_handover_srs"] = handover_srs
    demo.note("erp", f"finished machines from Production: {', '.join(done) or 'none dispatched'}")


def seed_machine_documents(demo) -> None:
    """Commissioning certificate upload + letters on the letterhead with their
    managed Word documents (Delivery Cover, Guarantee Certificate, general)."""
    head = demo.data["people"]["service_head"]
    partner = demo.data["people"].get("partner")
    sign = {"signatory_name": partner.name if partner else head.name, "signatory_designation": "Partner" if partner else head.designation}
    machines = demo.data["machines"]
    letters = 0

    for serial in ("DEMO-PEW-RRV-0101", "DEMO-PEW-RGM-0201", "DEMO-PEW-RRV-0103"):
        m = machines.get(serial)
        if not m:
            continue
        have = demo.call("GET", f"/erp/projects/{m['id']}/attachments", head)
        if not any(a["filename"].startswith("DEMO-Commissioning") for a in have):
            demo.call("POST", f"/erp/projects/{m['id']}/attachments", head,
                      files=[("files", demo.pdf(f"DEMO-Commissioning-Certificate-{serial}.pdf"))])

    def letter(m, payload):
        nonlocal letters
        existing = demo.call("GET", f"/erp/projects/{m['id']}/letters", head)
        subj = payload.get("subject") or {"delivery_cover": "Delivery Cover Letter", "guarantee_certificate": "Guarantee Certificate for Quality"}.get(payload["letter_type"])
        if any(l["subject"] == subj for l in existing):
            return
        lt = demo.call("POST", f"/erp/projects/{m['id']}/letters", head, json={**payload, **sign})
        status, body = demo.try_call("POST", f"/managed-documents/erp_project_letter/{lt['id']}", head)
        if status >= 400:
            demo.note("erp", f"letter {lt['letter_no']}: Word document not created ({status}: {body.get('detail') if isinstance(body, dict) else body})")
        letters += 1

    m = machines.get("DEMO-PEW-RRV-0103")
    if m:
        cust = demo.data["customers"]["lt_metro"]
        letter(m, {"letter_type": "delivery_cover", "letter_date": m.get("delivery_date") or str(demo.today), "data": {
            "loa_ref": m.get("po_number") or "DEMO/LTMR/LOA/0103", "client": cust["name"], "invoice_no": "DEMO/INV/26-27/0412",
            "invoice_date": m.get("delivery_date"), "project_title": f"{LABEL} Supply of RRV for Uppal Depot",
            "vehicle": "Rail-cum-Road Vehicle 8-wheel", "model_no": "RRV-8W", "application": m.get("application_type"),
            "documents": ["Tax invoice (original + duplicate)", "Delivery challan", "Inspection certificate (Premnath QC)",
                          "Operation & maintenance manual", "Warranty card", "Tool kit list"]}})
        letter(m, {"letter_type": "guarantee_certificate", "letter_date": m.get("commissioning_date") or str(demo.today), "data": {
            "loa_ref": m.get("po_number") or "DEMO/LTMR/LOA/0103",
            "recipient": f"The Head – Rolling Stock & P-Way\n{cust['name']}\nUppal Depot, Hyderabad 500039",
            "supply_description": "Rail-cum-Road Vehicle RRV-8W (Serial DEMO-PEW-RRV-0103) for Uppal Depot",
            "months_commissioning": 24, "months_supply": 30}})
    m = machines.get("DEMO-PEW-TIC-0301")
    if m:
        cust = demo.data["customers"]["rvnl"]
        letter(m, {"letter_type": "general", "letter_date": str(demo.today - timedelta(days=3)),
                   "recipient": f"The Chief Project Manager\n{cust['name']}\nRishikesh–Karnaprayag Project",
                   "subject": f"{LABEL} Warranty expired — offer for Annual Maintenance Contract, TIC-01 Sl. DEMO-PEW-TIC-0301",
                   "body": "Dear Sir,\n\nThe warranty of the above Track Inspection Car ended after 18 months of service. To keep the "
                           "recording system calibrated and the car available for your monsoon inspection runs, we offer a "
                           "comprehensive AMC covering four preventive visits a year, breakdown attendance within 48 hours and "
                           "laser/camera calibration.\n\nOur detailed offer is enclosed. Until an AMC is in place, breakdown "
                           "visits are attended as paid service.\n\nThanking you,"})
    demo.note("erp", f"{letters} machine letter(s) on the letterhead with Word documents + commissioning certificates uploaded")


# ── Service requests ─────────────────────────────────────────────────────
# key: (machine serial, raised by (people key), service type, priority, title,
#       description, category, final status)
SRS = [
    ("commissioning_0103", "DEMO-PEW-RRV-0103", "service_engineer", "installation_commissioning", "standard",
     "Installation & commissioning of RRV at Uppal Depot",
     "New RRV delivered; rail-wheel alignment, brake test, hydraulics and road/rail changeover trials, operator training.",
     "Commissioning", "closed"),
    ("commissioning_0104", "DEMO-PEW-RRV-0104", "service_engineer", "installation_commissioning", "standard",
     "Installation & commissioning of ART RRV at Alambagh",
     "Machine reached site on trailer; unloading, PDI and commissioning trials with ADEN and ART staff.",
     "Commissioning", "scheduled"),
    ("nr_leak", "DEMO-PEW-RRV-0101", "service_engineer", "warranty", "urgent",
     "Hydraulic oil leakage from rail-wheel lift cylinder (front axle)",
     "Customer reports oil seepage at front rail-guide lift cylinder rod end; rail wheels creep down during road travel. Machine in warranty.",
     "Hydraulic", "pending_parts"),
    ("nr_prox", "DEMO-PEW-RRV-0101", "service_head", "warranty", "standard",
     "Rail guide wheel proximity sensor showing false 'not locked' alarm",
     "Phone call from Sr. DEN Lucknow: HMI shows 'rail wheel not locked' intermittently on the rear axle; operator bypassing with caution.",
     "Electrical", "open"),
    ("dmrc_stone", "DEMO-PEW-RGM-0201", "service_engineer", "warranty", "urgent",
     "Abnormal stone wear and vibration on grinding head 3",
     "Stones on head 3 wearing in 2 shifts instead of 6; vibration at 3 km/h. Grinding block tonight needs the machine.",
     "Mechanical", "in_progress"),
    ("dmrc_blower", "DEMO-PEW-RGM-0201", "service_engineer", "warranty", "standard",
     "Dust extraction blower noise",
     "Rattling noise from the dust extraction blower at full speed; customer allows inspection only in the next traffic block.",
     "Mechanical", "on_hold"),
    ("cr_amc", "DEMO-PEW-RRV-0102", "service_engineer", "amc", "standard",
     "Quarterly AMC preventive visit (Q3)",
     "AMC schedule: engine service, hydraulic filter change, brake and rail-wheel check, PLC log download.",
     "AMC visit", "scheduled"),
    ("cr_tyre", "DEMO-PEW-RRV-0102", "service_engineer", "amc", "standard",
     "Road tyre puncture — rear left",
     "Workshop reported a flat road tyre; asked for attendance.",
     "Tyres", "cancelled"),
    ("rvnl_laser", "DEMO-PEW-TIC-0301", "service_engineer", "paid_service", "urgent",
     "Laser rail-profile sensor not detecting left rail",
     "Out of warranty. Left-rail profile channel shows 'no signal' since the last monsoon run; recording incomplete.",
     "Electronics", "review"),
    ("rvnl_engine", "DEMO-PEW-TIC-0301", "service_engineer", "paid_service", "standard",
     "Engine hard starting in cold mornings",
     "Car needs repeated cranking below 8 °C; battery voltage drops to 9 V during cranking.",
     "Engine", "closed"),
    ("ircon_plc", "DEMO-PEW-RGM-0202", "service_engineer", "repair_breakdown", "urgent",
     "PLC display blank — machine stopped in block",
     "HMI went blank during grinding; machine pulled out on emergency mode. Customer pressing for attendance.",
     "Electrical", "assigned"),
    ("lt_training", "DEMO-PEW-RRV-0103", "service_engineer", "inspection_maintenance", "standard",
     "Refresher operator training + 3-month inspection",
     "Customer asked for a refresher for the second shift operators along with the 3-month inspection.",
     "Training", "acknowledged"),
]


def _sr_payload(demo, key, m, stype, prio, title, desc, cat, engineer, status) -> dict:
    cust = demo.data["customers"].get(m.get("customer_key") or "", {})
    contact = (cust.get("contacts") or [{}])[-1]
    t = demo.today
    exp_attend = t + timedelta(days=4) if status == "scheduled" else (t - timedelta(days=6) if key == "ircon_plc" else t - timedelta(days=2))
    exp_close = t - timedelta(days=3) if key == "ircon_plc" else t + timedelta(days=7)
    out = {
        "project_id": m["id"], "issue_title": f"{LABEL} {title}", "issue_description": desc, "issue_category": cat,
        "priority": prio, "service_type": stype, "status": "open",
        "expected_date_to_attend": str(exp_attend), "expected_completion_date": str(exp_close),
        "reported_by_name": contact.get("name") or f"{LABEL} Site in-charge", "reported_by_phone": contact.get("mobile"),
        "reported_by_email": contact.get("email"),
    }
    if status not in ("open",):
        out["assigned_service_person_id"] = engineer.id
        out["assigned_to_name"] = engineer.name
    return {k: v for k, v in out.items() if v is not None}


def _patch(demo, sr, user, **fields):
    return demo.call("PATCH", f"/erp/service-requests/{sr['id']}", user, json=fields)


def _close(demo, sr, user, close_needs_approval: bool, **fields):
    """Close the SR the way the settings say: directly, or Review → approved
    by you (demo.me, an admin — the default SR closure approver)."""
    if not close_needs_approval:
        return _patch(demo, sr, user, status="closed", **fields)
    sr = _patch(demo, sr, user, status="review", **fields)
    return demo.call("POST", f"/erp/service-requests/{sr['id']}/approve-close", demo.me, json={"remarks": "DEMO: work verified, closed."})


def seed_service_requests(demo) -> None:
    """One SR per workflow stage, worked through the real PATCH flow by the
    person who raised it (only the creator may edit an SR)."""
    from app.modules.erp.models.service_request import ServiceRequest

    people = demo.data["people"]
    engineer = people["service_engineer"]
    machines = demo.data["machines"]
    close_approval = _setting(demo, "sr_close_approval_required")
    t = demo.today
    srs = {}

    for key, serial, by, stype, prio, title, desc, cat, final in SRS + demo.data.pop("_handover_srs", []):
        m = machines.get(serial)
        if not m:
            demo.note("erp", f"SR '{title}' skipped — machine {serial} not in this run")
            continue
        if m.get("approval_status") == "pending":
            demo.note("erp", f"SR '{title}' skipped — machine {serial} is waiting for approval")
            continue
        user = people[by]
        row = demo.db.query(ServiceRequest).filter(ServiceRequest.project_id == m["id"], ServiceRequest.issue_title == f"{LABEL} {title}",
                                                    ServiceRequest.is_deleted == False).first()  # noqa: E712
        if row:  # same machine + same title = the same SR (import duplicate rule) — reuse
            srs[row.request_number] = {**demo.call("GET", f"/erp/service-requests/{row.id}", user), "key": key}
            continue
        sr = demo.call("POST", "/erp/service-requests", user, json=_sr_payload(demo, key, m, stype, prio, title, desc, cat, engineer, final))

        if final == "open":
            pass
        elif final == "acknowledged":
            sr = _patch(demo, sr, user, status="acknowledged", service_report_notes="Call acknowledged; visit to be combined with the 3-month inspection.")
        elif final == "assigned":
            sr = _patch(demo, sr, user, status="assigned", service_report_notes="Engineer assigned; travelling from Faridabad (overdue — customer escalated).")
        elif final == "scheduled":
            sr = _patch(demo, sr, user, status="scheduled", service_report_notes=f"Visit fixed for {(t + timedelta(days=4)):%d-%m-%Y} with customer.")
        elif final == "cancelled":
            sr = _patch(demo, sr, user, status="cancelled", service_report_notes="Customer's workshop repaired the puncture locally — call withdrawn.")
        elif final == "on_hold":
            sr = _patch(demo, sr, user, status="in_progress", actual_date_attended=str(t - timedelta(days=4)),
                        root_cause="Suspected loose impeller / bearing wear on blower.")
            sr = _patch(demo, sr, user, status="on_hold", service_report_notes="Waiting for DMRC traffic block to open the blower housing.")
        elif final == "in_progress":
            sr = _patch(demo, sr, user, status="in_progress", actual_date_attended=str(t - timedelta(days=1)),
                        failure_mode="Uneven stone wear", root_cause="Head 3 feed cylinder pressure set 20 bar above the other heads; worn stones.")
        elif final == "pending_parts":
            sr = _patch(demo, sr, user, status="in_progress", actual_date_attended=str(t - timedelta(days=3)),
                        failure_mode="Seal failure", root_cause="Rod seal of front rail-wheel lift cylinder cut — dust ingress, wiper damaged.")
            # status → pending_parts after the material is raised (seed_service_material)
        elif final in ("closed", "review"):
            sr = _patch(demo, sr, user, status="in_progress", actual_date_attended=str(t - timedelta(days=12 if key != "rvnl_laser" else 2)))
            sr = _patch(demo, sr, user, status="work_completed", actual_completion_date=str(t - timedelta(days=10 if key != "rvnl_laser" else 1)),
                        root_cause={"commissioning_0103": "—", "rvnl_engine": "Weak battery (cell failed) and glow-plug relay contact pitted.",
                                    "rvnl_laser": "Laser head window fogged + connector corroded after monsoon water ingress."}.get(key, "—"),
                        resolution_description={
                            "commissioning_0103": "Machine commissioned: rail/road changeover, brake, haulage and hydraulics trials passed; 6 operators trained; acceptance signed.",
                            "rvnl_engine": "Replaced 12 V 100 Ah battery and glow-plug relay; cold start verified at 6 °C.",
                            "rvnl_laser": "Cleaned and resealed laser head, replaced connector, recalibrated profile on reference rail.",
                        }.get(key, "Machine commissioned at site: trials passed, operators trained, customer acceptance signed."),
                        preventive_actions="Monthly connector inspection added to operator checklist." if key == "rvnl_laser" else None,
                        service_report_notes="Service report signed by customer.")
            if key == "rvnl_engine":
                _engine_job_material(demo, sr, m, user)
            if stype == "paid_service":
                sr = _patch(demo, sr, user, service_cost=18000 if key == "rvnl_laser" else 9500, transport_cost=6500, accommodation_cost=4800,
                            miscellaneous_cost=750, tax_percentage=18, payment_status="pending" if key == "rvnl_laser" else "paid",
                            invoice_number=None if key == "rvnl_laser" else "DEMO/SRV/26-27/0031")
            elif stype in ("warranty", "installation_commissioning", "amc"):
                sr = _patch(demo, sr, user, payment_status="not_billable")
            if final == "closed":
                sr = _close(demo, sr, user, close_approval)
            elif close_approval:
                sr = _patch(demo, sr, user, status="review")
                demo.note("erp", f"{sr['request_number']} (paid job, RVNL) is in Review — closure waits for YOUR approval")
            else:
                sr = _patch(demo, sr, user, status="review")
                demo.note("erp", f"{sr['request_number']} left in Review — 'Closing a service request needs approval' is off, so no approval is pending")
        srs[sr["request_number"]] = {**sr, "key": key}

    demo.data["service_requests"] = srs


def _sr(demo, key):
    return next((s for s in demo.data.get("service_requests", {}).values() if s.get("key") == key), None)


def _store_issue(demo, sr, m, item_code, qty, loc_key) -> dict | None:
    """Store Keeper issues spares against the customer machine (erp_project_id),
    the SR number as the reference — the stock leaves Store for the site."""
    item = demo.data["items"].get(item_code)
    if not item:
        demo.note("erp", f"item {item_code} not in the item master — store issue skipped")
        return None
    keeper = demo.data["people"]["store_keeper"]
    dept = demo.data.get("departments", {}).get("Service & Commissioning")
    base = {
        "location_id": demo.data["locations"][loc_key], "requested_by_id": demo.data["people"]["service_engineer"].id,
        "department_id": dept, "project_or_work_order": f"{sr['request_number']} / {m['serial_number']}",
        "erp_project_id": m["id"], "issue_date": str(demo.today - timedelta(days=1)),
        "remarks": f"{LABEL} spares for service request {sr['request_number']} ({m.get('client_company')}).",
        "items": [{"item_id": item["id"], "quantity": qty, "batch_number": item.get("batch_number"),
                   "remarks": "Warranty replacement" if sr.get("service_type") == "warranty" else None}],
    }
    # "Project / Site" issue: delivery challan to the customer site; the failed
    # part comes back for the warranty claim by the return date.
    site = {**base, "issue_type": "project", "challan_number": f"DEMO-DC-{sr['request_number'][-4:]}",
            "vendor_name": m.get("client_company"), "expected_return_date": str(demo.today + timedelta(days=30))}
    status, body = demo.try_call("POST", "/store/material-issues", keeper, json=site)
    if status >= 400:
        status, body = demo.try_call("POST", "/store/material-issues", keeper, json=base)
    if status >= 400:
        demo.note("erp", f"store issue for {sr['request_number']} failed ({status}): {body.get('detail') if isinstance(body, dict) else body}")
        return None
    return body


def _engine_job_material(demo, sr, m, engineer) -> None:
    """Paid job (RVNL engine hard start): relay issued from Store against the
    machine, battery bought locally at site — both billed to the customer."""
    relay = demo.data["items"].get("DEMO-ELE-RELAY-24V", {})
    mat = demo.call("POST", f"/erp/service-requests/{sr['id']}/materials", engineer, json={
        "material_name": relay.get("name") or "DEMO Relay 24 VDC 2CO with base", "part_number": "DEMO-ELE-RELAY-24V", "quantity": 1,
        "unit": "nos", "estimated_budget": 650, "reason": "Glow-plug relay contacts pitted", "description": "Chargeable spare"})
    issue = _store_issue(demo, sr, m, "DEMO-ELE-RELAY-24V", 1, "main_store")
    if issue:
        demo.call("POST", f"/erp/service-requests/{sr['id']}/materials/{mat['id']}/receive", engineer, json={"received_quantity": 1})
    demo.call("POST", f"/erp/service-requests/{sr['id']}/materials", engineer, json={
        "material_name": "DEMO Battery 12 V 100 Ah", "part_number": "DEMO-ELE-BATT-12V100", "quantity": 1, "unit": "nos",
        "estimated_budget": 11200, "reason": "Cell failed — battery would not hold cranking voltage", "status": "issued",
        "description": "Bought locally at Rishikesh (urgent), bill attached — chargeable"})


def seed_service_material(demo) -> None:
    """Spares on SRs: in-stock warranty spares issued from Store against the
    machine and received on the SR; a part with no stock raised to Purchase
    as a PR from the SR (service PRs need no PR approval)."""
    engineer = demo.data["people"]["service_engineer"]
    machines = {m["id"]: m for m in demo.data["machines"].values()}
    issues, prs = [], []

    def add(sr, code, qty, budget, reason, warranty=True):
        item = demo.data["items"].get(code, {})
        return demo.call("POST", f"/erp/service-requests/{sr['id']}/materials", engineer, json={
            "material_name": item.get("name") or code, "part_number": code, "quantity": qty, "unit": (item.get("unit") or "NOS").lower(),
            "estimated_budget": budget, "reason": reason, "status": "pending",
            "description": "Warranty replacement — no charge to customer" if warranty else "Chargeable spare",
        })

    def issue_and_receive(sr, mat, code, qty, loc):
        if sr.get("materials") and any(x.get("received_quantity") for x in sr["materials"] if x["id"] == mat["id"]):
            return
        issue = _store_issue(demo, sr, machines[sr["project_id"]], code, qty, loc)
        if issue:
            issues.append(issue["issue_number"])
            demo.call("PATCH", f"/erp/service-requests/{sr['id']}/materials/{mat['id']}", engineer,
                      json={"description": f"Issued from Store on {issue['issue_number']}"})
            demo.call("POST", f"/erp/service-requests/{sr['id']}/materials/{mat['id']}/receive", engineer, json={"received_quantity": qty})

    sr = _sr(demo, "nr_leak")
    if sr and not sr.get("materials"):
        mat = add(sr, "DEMO-HYD-SEAL-KIT-63", 2, 2900, "Rod seal + wiper cut on front lift cylinder")
        issue_and_receive(sr, mat, "DEMO-HYD-SEAL-KIT-63", 2, "main_store")
        add(sr, "DEMO-HYD-OIL-68", 20, 3300, "Top-up after cylinder re-sealing")
        # Orbital motor: no stock in Store → PR to Purchase from the SR.
        pr = demo.call("POST", f"/erp/service-requests/{sr['id']}/raise-pr", engineer, json={
            "priority": "high", "required_by_date": str(demo.today + timedelta(days=10)), "category_code": "PNH",
            "requirement_type": "Material", "reason": f"{LABEL} warranty: rail-wheel drive motor noisy, replace (no stock in Store).",
            "items": [{"item_name": demo.data["items"].get("DEMO-HYD-MOTOR-ORB200", {}).get("name", "DEMO Orbital Hydraulic Motor 200 cc"),
                       "make": "DEMO Danfoss-equivalent", "part_code": "DEMO-HYD-MOTOR-ORB200", "unit": "NOS", "quantity": 1,
                       "project_inhouse": "Project", "category": "Hydraulic", "ship_to": "Premnath Unit 1 — Service"}],
        })
        prs.append(pr)
        sr = _patch(demo, sr, engineer, status="pending_parts", service_report_notes=f"Seal kit fitted; drive motor awaited on {pr['p2p_number']}.")
        demo.data["service_requests"][sr["request_number"]] = {**sr, "key": "nr_leak"}

    sr = _sr(demo, "dmrc_stone")
    if sr and not sr.get("materials"):
        mat = add(sr, "DEMO-SP-GRIND-STONE-150", 4, 13600, "Head 3 stones worn out of profile")
        issue_and_receive(sr, mat, "DEMO-SP-GRIND-STONE-150", 4, "spares_store")

    sr = _sr(demo, "cr_amc")
    if sr and not sr.get("materials"):
        add(sr, "DEMO-SP-FILTER-RET10", 2, 3300, "AMC: return-line filter change (planned)", warranty=False)

    demo.data["service_prs"] = prs
    demo.note("erp", f"service material: {len(issues)} store issue(s) against machines ({', '.join(issues) or 'none'}), "
                     f"{len(prs)} PR(s) from SRs ({', '.join(p['p2p_number'] for p in prs) or 'none'})")


def _summary(demo) -> None:
    srs = demo.data.get("service_requests", {})
    by_status: dict[str, int] = {}
    for s in srs.values():
        by_status[s["status"]] = by_status.get(s["status"], 0) + 1
    demo.note("erp", f"{len(srs)} DEMO service requests: " + ", ".join(f"{n} {k}" for k, n in sorted(by_status.items())))


def seed(demo) -> None:
    seed_machines(demo)
    adopt_finished_machines(demo)
    seed_machine_documents(demo)
    seed_service_requests(demo)
    seed_service_material(demo)
    _summary(demo)
