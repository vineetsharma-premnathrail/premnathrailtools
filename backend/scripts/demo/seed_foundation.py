"""Foundation: organization, demo people with real roles, products, store masters/items/opening stock, vendors, customers.

Runs first; every later seeder builds on what it leaves in `demo.data`.
Re-running reuses what is already there (matched by email / code / name)
instead of duplicating it, and still fills every key below.

demo.data keys set here (the contract later seeders rely on):

  people        dict key -> User (ORM row, demo.<slug>@example.invalid). Keys:
                bd, bd_head, rnd_head, rnd_engineer, design_head,
                design_engineer, electrical_head, hydraulic_head,
                store_manager, store_keeper, buyer, purchase_manager,
                production_manager, production_supervisor, quality_manager,
                quality_inspector, project_manager, service_engineer,
                service_head, maintenance_engineer, hr_manager, employee,
                accounts_manager, accountant, partner, director.
                Each holds "DEMO <job>" roles (see ROLES below) + "Employee
                self-service"; approval flags set through the API; posted to a
                real department/branch; reporting_manager_id set (DB — no API).
                partner is the top approver (is_partner, via Company Info →
                Partners); director keeps the legacy is_director flag.
                Department heads: the demo head is ADDED as a head of their
                real department where the API allows it — it refuses when an
                existing real head has no unit set (cross-unit rule), and the
                run notes which departments those are. R&D heads for R&D
                requirement work come from R&D › Settings › Team (rnd seeder).
  roles         dict job name -> role dict from the API ("DEMO <job>").
  company_id    int — Company Info row (existing one reused).
  branch_id     int — main plant (Unit 1 / first branch).
  branches      dict branch name -> id (all branches).
  departments   dict department name -> id (in the branch each demo person sits in;
                e.g. "R&D" and "Design" are RDC, the rest Unit 1).
  financial_years  dict code ("2025-26", "2026-27") -> CompanyFinancialYear id.
  products      dict product code -> product dict from the API (+ "id").
                Codes: DEMO-RRV-8W, DEMO-RGM-16, DEMO-TIC-01, DEMO-CW-BOX, DEMO-HRE-150.
  applications  dict application code -> application dict.
  locations     dict key -> store location id: main_store, production_floor,
                spares_store, rdc_store. (Quality-hold / quarantine are stock
                BUCKETS inside each location — quality_qty / quarantine_qty —
                not separate locations.)
  categories    dict category name -> id (store item categories used).
  items         dict item code -> item dict from the API plus convenience keys
                "code", "name", "unit", "rate" (standard cost), "opening_qty",
                "location" (locations key holding the opening stock, or None).
  opening_entry dict location key -> stock entry number (entry type "Opening stock").
  vendors       dict key -> vendor dict (shared master, /p2p/vendors): hydraulics,
                electricals, steel, bearings, engines.
  customers     dict key -> CRM organization dict + "contacts" (list of contact
                dicts) + "contact_ids": northern_railway, central_railway_workshop,
                dmrc, rvnl, ircon, lt_metro.
"""
from __future__ import annotations

import json
from datetime import date

from demo._common import LABEL


# ── People ────────────────────────────────────────────────────────────────
# key: (slug, name, designation, department, branch hint, roles, flags, head?, reports_to)
PEOPLE = {
    "partner": ("partner", "Partner", "Partner", None, "unit1", ["Partner (top approver)"], {"is_partner": True}, False, None),
    "director": ("director", "Director", "Director", None, "unit1", ["Partner (top approver)"], {"is_director": True}, False, None),
    "bd_head": ("bd.head", "BD Head", "Head – Business Development", "Business Development", "unit1", ["Sales / BD Head"], {"is_department_head": True}, True, "partner"),
    "bd": ("bd.exec", "BD Executive", "Sr. Executive – Business Development", "Business Development", "unit1", ["Sales / BD Executive"], {}, False, "bd_head"),
    "rnd_head": ("rnd.head", "R&D Head", "Head – R&D", "R&D", "rdc", ["R&D Head"], {"is_rnd_manager": True, "is_department_head": True}, True, "partner"),
    "rnd_engineer": ("rnd.engineer", "R&D Engineer", "R&D Engineer", "R&D", "rdc", ["R&D Engineer"], {}, False, "rnd_head"),
    "design_head": ("design.manager", "Design Head", "Head – Design", "Design", "rdc", ["Design Head"], {"is_design_manager": True, "is_department_head": True}, True, "partner"),
    "design_engineer": ("design.engineer", "Design Engineer", "Design Engineer (Mechanical)", "Design", "rdc", ["Design Engineer"], {}, False, "design_head"),
    "electrical_head": ("electrical.head", "Electrical Head", "Head – Electrical", "Electrical", "unit1", ["Electrical Head"], {"is_department_head": True}, True, "partner"),
    "hydraulic_head": ("hydraulic.head", "Hydraulic Head", "Head – Hydraulics & Pneumatics", "Fluids", "unit1", ["Hydraulic Head"], {"is_department_head": True}, True, "partner"),
    "store_manager": ("store.manager", "Store Manager", "Store Manager", "Store & Dispatch", "unit1", ["Store Manager"], {"is_store_manager": True, "is_department_head": True}, True, "partner"),
    "store_keeper": ("store.keeper", "Store Keeper", "Store Keeper", "Store & Dispatch", "unit1", ["Store Keeper"], {}, False, "store_manager"),
    "buyer": ("buyer", "Buyer", "Buyer – Purchase", "Purchase", "unit1", ["Buyer"], {}, False, "purchase_manager"),
    "purchase_manager": ("purchase.manager", "Purchase Manager", "Purchase Manager", "Purchase", "unit1", ["Purchase Manager"], {"is_purchase_manager": True, "is_purchase_head": True, "is_department_head": True}, True, "partner"),
    "production_manager": ("production.manager", "Production Manager", "Production Manager", "Production", "unit1", ["Production Manager"], {"is_production_manager": True, "is_department_head": True}, True, "partner"),
    "production_supervisor": ("production.supervisor", "Production Supervisor", "Shop Floor Supervisor", "Production", "unit1", ["Production Supervisor"], {}, False, "production_manager"),
    "quality_manager": ("quality.manager", "Quality Manager", "Quality Manager", "Quality", "unit1", ["Quality Manager"], {"is_department_head": True}, True, "partner"),
    "quality_inspector": ("quality.inspector", "Quality Inspector", "QC Inspector", "Quality", "unit1", ["Quality Inspector"], {}, False, "quality_manager"),
    "project_manager": ("project.manager", "Project Manager", "Project Manager", "Project Management", "unit1", ["Project Manager"], {"is_project_manager": True, "is_department_head": True}, True, "partner"),
    "service_head": ("service.head", "Service Head", "Head – Service & Commissioning", "Service & Commissioning", "unit1", ["Service Head"], {"is_department_head": True}, True, "partner"),
    "service_engineer": ("service.engineer", "Service Engineer", "Field Service Engineer", "Service & Commissioning", "unit1", ["Service Engineer"], {}, False, "service_head"),
    "maintenance_engineer": ("maintenance.engineer", "Maintenance Engineer", "Plant Maintenance Engineer", "Maintenance", "unit1", ["Maintenance Engineer"], {}, False, "production_manager"),
    "hr_manager": ("hr.manager", "HR Manager", "Manager – HR & Admin", "HR & Admin", "unit1", ["HR Manager"], {"is_department_head": True}, True, "partner"),
    "employee": ("employee", "Employee", "Technician – Assembly", "Production", "unit1", [], {}, False, "production_supervisor"),
    "accounts_manager": ("accounts.manager", "Accounts Manager", "Finance & Accounts Manager", "Accounts", "unit1", ["Accounts Manager"], {"is_finance_manager": True, "is_department_head": True}, True, "partner"),
    "accountant": ("accountant", "Accountant", "Accountant", "Accounts", "unit1", ["Accountant"], {}, False, "accounts_manager"),
}

EMPLOYEE_ROLE = "Employee self-service"


def _roles(demo) -> dict[str, list[str]]:
    """Job roles: what each job needs to do its work through the API.
    Authority grants (approve / settings edit) only where the job has it."""
    from app.core.permission_registry import AUTHORITY_GRANTS, MODULES, NON_APP_MODULES
    from app.modules.quality.services.access import QUALITY_ROLE_PERMISSION_SETS

    P = demo.perms

    def std(module, skip=()):
        """Every routine action of a module (no settings / authority grants)."""
        return [g for g in P(module, skip=skip) if g not in AUTHORITY_GRANTS and not g.endswith(":settings:edit")]

    def no_settings(grants, module):
        settings_tabs = {t for t, grp in MODULES[module]["groups"].items() if grp == "Settings"} | {"settings"}
        return [g for g in grants if g.split(":")[1] not in settings_tabs]

    pr_raise = P("p2p", "purchase_requisitions", actions=["view", "create", "edit", "submit", "cancel"])
    pr_approve = P("p2p", "purchase_requisitions", "purchase_orders", actions=["view", "approve", "reject"])
    item_lookup = ["store:items:view", "store:stock:view"]
    products_view = P("crm", "products", actions=["view"])  # Products moved into CRM (2026-10-30)
    routine = ("delete", "approve", "reject")
    apps = [m for m in MODULES if m not in NON_APP_MODULES]
    return {
        "Sales / BD Executive": [no_settings(std("crm", skip=routine), "crm"), products_view],
        "Sales / BD Head": ["crm:*:*", products_view, item_lookup],
        "R&D Engineer": [std("rnd", skip=("delete", "approve")), products_view, pr_raise, item_lookup],
        "R&D Head": ["rnd:*:*", "crm:products:*", P("crm", "organizations", "inquiries_tenders", actions=["view"]), pr_raise, item_lookup],
        "Design Engineer": [no_settings(std("design", skip=routine), "design"), products_view, pr_raise, item_lookup],
        "Design Head": ["design:*:*", products_view, pr_raise, pr_approve, item_lookup],
        "Electrical Head": ["electrical:*:*", pr_raise, item_lookup],
        "Hydraulic Head": ["hydraulic:*:*", pr_raise, item_lookup],
        "Store Keeper": [no_settings(std("store", skip=routine), "store"), P("store", "grn", actions=["view", "create", "edit"]), P("p2p", "purchase_orders", actions=["view"])],
        "Store Manager": ["store:*:*", pr_raise, pr_approve, P("quality", "inspection_lots", actions=["view"])],
        "Buyer": [std("p2p", skip=routine), "purchase:*:view", item_lookup, P("store", "grn", actions=["view"])],
        "Purchase Manager": ["p2p:*:*", "purchase:*:*", P("store", "grn"), item_lookup, P("accounts", "vendors", actions=["view"])],
        "Production Supervisor": [std("production", skip=routine), P("store", "issues", actions=["view", "create"]), item_lookup, pr_raise,
                                  P("quality", "in_process_inspection", actions=["view"])],
        "Production Manager": ["production:*:*", P("store", "issues", "returns", "reservations", skip=("delete",)), item_lookup, pr_raise, pr_approve,
                               P("quality", "in_process_inspection", "final_inspection", actions=["view"])],
        "Quality Inspector": [QUALITY_ROLE_PERMISSION_SETS["inspector"]["grants"], P("store", "grn", actions=["view"]), item_lookup],
        "Quality Manager": ["quality:*:*", QUALITY_ROLE_PERMISSION_SETS["head"]["grants"], P("store", "grn", actions=["view", "approve", "reject"]), item_lookup],
        "Project Manager": ["projects:*:*", pr_raise, pr_approve, P("crm", "inquiries_tenders", actions=["view"])],
        "Service Engineer": [no_settings(std("erp", skip=("delete",)), "erp"), P("store", "issues", actions=["view", "create"]), item_lookup,
                             P("quality", "complaints", actions=["view", "create"]), pr_raise],
        "Service Head": ["erp:*:*", P("quality", "complaints", actions=["view", "create", "edit"]), item_lookup, pr_raise, pr_approve],
        "Maintenance Engineer": [no_settings(std("maintenance", skip=routine), "maintenance"), P("store", "issues", actions=["view", "create"]), item_lookup, pr_raise],
        "HR Manager": ["hr:*:*", "organization:department:view", "organization:users:view"],
        "Accountant": [no_settings(std("accounts", skip=routine), "accounts"), P("p2p", "vendors", "purchase_orders", actions=["view"]), P("store", "grn", actions=["view"])],
        "Accounts Manager": ["accounts:*:*", P("p2p", "vendors", "purchase_orders", actions=["view"]), P("store", "grn", actions=["view"])],
        # Top approval level: sees every module, may approve / reject anywhere.
        "Partner (top approver)": [[f"{m}:*:view", f"{m}:*:approve", f"{m}:*:reject"] for m in apps] + ["organization:info:view"],
    }


def seed_roles(demo) -> None:
    demo.data["roles"] = {name: demo.role(name, grants) for name, grants in _roles(demo).items()}
    from app.modules.main.models.role import Role
    if not demo.db.query(Role).filter(Role.name == EMPLOYEE_ROLE).first():
        demo.data["roles"][EMPLOYEE_ROLE] = demo.role(EMPLOYEE_ROLE, demo.perms("hr", "me"))
    demo.note("organization", f"{len(demo.data['roles'])} DEMO job roles ready (Organization › Role & Permissions)")


# ── Organization ──────────────────────────────────────────────────────────

def seed_organization(demo) -> None:
    from app.modules.organization.models.branch import Branch
    from app.modules.organization.models.company import Company
    from app.modules.organization.models.company_financial_year import CompanyFinancialYear

    company = demo.db.query(Company).order_by(Company.id).first()
    if company:
        demo.note("organization", f"company reused: {company.name}")
        company_id = company.id
    else:
        company_id = demo.call("POST", "/organization/company", json={
            "name": f"{LABEL} Premnath Rail Tools", "legal_name": f"{LABEL} Premnath Rail Tools Pvt Ltd", "code": "DEMO-PRT",
            "short_name": "DEMO PRT", "industry": "Railway maintenance machinery", "country": "India", "currency": "INR",
            "timezone": "Asia/Kolkata", "gstin": demo.gstin("06", "AADCD1234P"), "pan": "AADCD1234P",
        })["id"]
        demo.note("organization", "company created: DEMO Premnath Rail Tools (no Company Info existed)")
    demo.data["company_id"] = company_id

    branches = demo.db.query(Branch).order_by(Branch.id).all()
    if not branches:
        for name, code in ((f"{LABEL} Unit 1", "DEMO-U1"), (f"{LABEL} RDC", "DEMO-RDC")):
            demo.call("POST", "/organization/branches", json={"name": name, "code": code, "company_id": company_id, "plant_type": "Manufacturing"})
        demo.db.expire_all()
        branches = demo.db.query(Branch).order_by(Branch.id).all()
        demo.note("organization", "branches created: DEMO Unit 1, DEMO RDC")
    demo.data["branches"] = {b.name: b.id for b in branches}
    unit1 = next((b for b in branches if "unit 1" in b.name.lower()), branches[0])
    rdc = next((b for b in branches if "rdc" in b.name.lower()), unit1)
    demo.data["branch_id"] = unit1.id
    demo.data["_branch_hint"] = {"unit1": unit1.id, "rdc": rdc.id}

    # Financial years: previous + current (Indian Apr–Mar), so postings dated
    # last year (old machines, invoices) still fall inside a defined FY.
    t = demo.today
    start_year = t.year if t.month >= 4 else t.year - 1
    fys = {}
    for y in (start_year - 1, start_year):
        start, end = date(y, 4, 1), date(y + 1, 3, 31)
        code = f"{y}-{str(y + 1)[2:]}"
        row = demo.db.query(CompanyFinancialYear).filter(
            CompanyFinancialYear.start_date <= end, CompanyFinancialYear.end_date >= start).first()
        if row:
            fys[code] = row.id
            continue
        fys[code] = demo.call("POST", "/organization/company/financial-years", json={
            "name": f"FY {code}", "start_date": str(start), "end_date": str(end), "fiscal_year_code": code, "status": "open"})["id"]
        demo.note("organization", f"financial year FY {code} added")
    demo.data["financial_years"] = fys


def _department(demo, name: str, branch_id: int) -> int:
    from app.modules.organization.models.department import Department
    from sqlalchemy import func
    rows = demo.db.query(Department).filter(func.lower(Department.name) == name.lower()).all()
    row = next((d for d in rows if d.branch_id == branch_id), None) or (rows[0] if rows else None)
    if row:
        return row.id
    demo.note("organization", f"department '{name}' created")
    return demo.call("POST", "/organization/departments", json={"name": name, "branch_id": branch_id})["id"]


def seed_people(demo) -> None:
    from app.modules.main.models.user import User
    from app.modules.organization.models.department import Department

    hint = demo.data.pop("_branch_hint")
    people, departments = {}, {}
    for key, (slug, name, designation, dept, branch, roles, flags, is_head, _rep) in PEOPLE.items():
        u = demo.user(slug, name, [], designation=designation, department=dept or LABEL)
        u.designation = designation
        u.branch_id = hint[branch]
        demo.db.commit()
        if dept:
            dept_id = departments.setdefault(dept, _department(demo, dept, hint[branch]))
            if (u.department or "").lower() != dept.lower() or u.branch_id != demo.db.get(Department, dept_id).branch_id:
                demo.call("POST", f"/organization/departments/{dept_id}/members", json={"user_id": u.id})
        u = demo.assign(u, *roles, EMPLOYEE_ROLE)
        u = demo.flags(u, **flags) if flags else u
        people[key] = u

    # Department heads: add the demo head next to whoever heads it already.
    for key, (_s, _n, _d, dept, _b, _r, _f, is_head, _rep) in PEOPLE.items():
        if not is_head or not dept:
            continue
        d = demo.db.get(Department, departments[dept])
        heads = [d.head_user_id, d.secondary_head_user_id, *(d.additional_head_user_ids or [])]
        if people[key].id in heads:
            continue
        payload = {"head_user_id": people[key].id} if not d.head_user_id else \
                  {"additional_head_user_ids": [*(d.additional_head_user_ids or []), people[key].id]}
        status, body = demo.try_call("PATCH", f"/organization/departments/{d.id}", json=payload)
        if status >= 400:
            demo.note("organization", f"couldn't add {people[key].name} as head of {dept}: {body.get('detail') if isinstance(body, dict) else body}")

    # Reporting line (no API sets it outside the HR lifecycle) — DB.
    for key, row in PEOPLE.items():
        rep = row[8]
        u = demo.db.get(User, people[key].id)
        if rep and u.reporting_manager_id != people[rep].id:
            u.reporting_manager_id = people[rep].id
    demo.db.commit()
    demo.db.expire_all()
    demo.data["people"] = {k: demo.db.get(User, u.id) for k, u in people.items()}
    demo.data["departments"] = departments
    demo.note("organization", f"{len(people)} demo people with roles, flags, departments and reporting lines")


# ── Products ──────────────────────────────────────────────────────────────

APPLICATIONS = [
    ("DEMO-TRACK-MNT", "DEMO Track maintenance & renewal", "Material movement, sleeper and rail handling on track blocks."),
    ("DEMO-RAIL-GRIND", "DEMO Rail profile grinding", "Restoring rail head profile, removing corrugation and RCF defects."),
    ("DEMO-TRACK-INSP", "DEMO Track inspection & recording", "Geometry and ultrasonic inspection of running track."),
    ("DEMO-RERAIL", "DEMO Accident relief & re-railing", "Lifting and re-railing derailed coaches and wagons."),
    ("DEMO-SHUNT", "DEMO Depot shunting", "Moving rakes and wagons inside depots and sidings."),
]

PRODUCTS = [
    ("DEMO-RRV-8W", "DEMO Rail-cum-Road Vehicle 8-wheel", "vehicle", "RRV-8W", "8714", 24, ["DEMO-TRACK-MNT", "DEMO-SHUNT"],
     [("Max speed on rail", "40", "km/h"), ("Max speed on road", "60", "km/h"), ("Engine power", "74", "kW"), ("Track gauge", "1676", "mm"), ("Haulage capacity", "300", "t")]),
    ("DEMO-RGM-16", "DEMO Rail Grinding Machine 16-stone", "machine", "RGM-16", "8460", 24, ["DEMO-RAIL-GRIND"],
     [("Grinding stones", "16", "nos"), ("Working speed", "3-8", "km/h"), ("Stone motor power", "22", "kW each")]),
    ("DEMO-TIC-01", "DEMO Track Inspection Car", "vehicle", "TIC-01", "8606", 18, ["DEMO-TRACK-INSP"],
     [("Recording speed", "up to 100", "km/h"), ("Parameters", "Gauge, twist, alignment, unevenness", None)]),
    ("DEMO-CW-BOX", "DEMO Carriage Wagon (material)", "vehicle", "CW-BOX", "8606", 12, ["DEMO-TRACK-MNT"],
     [("Payload", "40", "t"), ("Axle load", "20.3", "t")]),
    ("DEMO-HRE-150", "DEMO Hydraulic Re-railing Equipment 150 t", "equipment", "HRE-150", "8425", 12, ["DEMO-RERAIL"],
     [("Lifting capacity", "150", "t"), ("Working pressure", "700", "bar"), ("Traverse stroke", "500", "mm")]),
]


def seed_products(demo) -> None:
    from app.modules.products.models.application import ProductApplication
    from app.modules.products.models.product import FinishedProduct

    owner = demo.data["people"]["rnd_head"]
    apps = {}
    for code, name, desc in APPLICATIONS:
        row = demo.db.query(ProductApplication).filter(ProductApplication.code == code).first()
        apps[code] = {"id": row.id, "code": row.code, "name": row.name} if row else \
            demo.call("POST", "/products/applications", owner, json={"code": code, "name": name, "description": desc})
    products = {}
    for code, name, ptype, model, hsn, warranty, app_codes, specs in PRODUCTS:
        row = demo.db.query(FinishedProduct).filter(FinishedProduct.code == code).first()
        if row:
            products[code] = demo.call("GET", f"/products/{row.id}", owner)
            continue
        products[code] = demo.call("POST", "/products", owner, json={
            "code": code, "name": name, "product_type": ptype, "model_number": model, "status": "active",
            "short_description": f"{name} for Indian Railways and metro track maintenance.", "hsn_code": hsn, "uom": "Nos",
            "warranty_months": warranty, "application_ids": [apps[a]["id"] for a in app_codes],
            "specifications": [{"parameter": p, "value": v, "unit": u} for p, v, u in specs],
        })
    demo.data["applications"] = apps
    demo.data["products"] = products
    demo.note("products", f"{len(products)} finished products, {len(apps)} applications")


# ── Vendors (shared master: Procurement + Finance) ─────────────────────────

VENDORS = {
    "hydraulics": ("DEMO-V-HYD", "DEMO Hydro Seals & Fluid Power Pvt Ltd", "06", "AABCH1234K", "Plot 41, Sector 24", "Faridabad", "Haryana", "121005", "Rakesh Arora"),
    "electricals": ("DEMO-V-ELE", "DEMO Rail Electricals & Controls", "09", "AAFFR2345L", "B-88, Sector 63", "Noida", "Uttar Pradesh", "201301", "Sunita Verma"),
    "steel": ("DEMO-V-STL", "DEMO Steel Stockyard Traders", "09", "AAGFS3456M", "Loha Mandi, GT Road", "Ghaziabad", "Uttar Pradesh", "201001", "Manoj Gupta"),
    "bearings": ("DEMO-V-BRG", "DEMO Bharat Bearings Distributors", "07", "AACFB4567N", "Kashmere Gate", "Delhi", "Delhi", "110006", "Imran Qureshi"),
    "engines": ("DEMO-V-ENG", "DEMO Powertrain Engines India Ltd", "27", "AACCP5678Q", "MIDC Chakan Phase II", "Pune", "Maharashtra", "410501", "Prashant Kulkarni"),
}


def seed_vendors(demo) -> None:
    from app.modules.accounts.models.vendor import Vendor

    buyer, finance = demo.data["people"]["buyer"], demo.data["people"]["accounts_manager"]
    out = {}
    for i, (key, (code, name, state_code, pan, addr, city, state, pin, contact)) in enumerate(VENDORS.items(), 1):
        row = demo.db.query(Vendor).filter(Vendor.code == code).first()
        if row:
            out[key] = demo.call("GET", f"/p2p/vendors/{row.id}", buyer)
            continue
        v = demo.call("POST", "/p2p/vendors", buyer, json={
            "code": code, "name": name, "contact_name": f"{LABEL} {contact}", "contact_phone": f"+91 98100 0{i:04d}",
            "contact_email": f"sales.{key}@{'example.invalid'}", "address": addr, "city": city, "state": state, "pin_code": pin,
            "gstin": demo.gstin(state_code, pan), "gst_registration_type": "regular",
            "terms_conditions": "DEMO vendor — 30 days credit, door delivery Faridabad.",
        })
        # Finance owns the bank / credit side of the same master.
        demo.call("PATCH", f"/accounts/vendors/{v['id']}", finance, json={
            "payment_days": 30, "bank_name": f"{LABEL} State Bank", "bank_account_no": f"0000{i:02d}12345678",
            "ifsc_code": f"SBIN000{i:04d}", "account_holder_name": name,
        })
        out[key] = demo.call("GET", f"/p2p/vendors/{v['id']}", buyer)
    demo.data["vendors"] = out
    demo.note("p2p", f"{len(out)} vendors in the shared vendor master (Procurement + Finance)")


# ── Store masters, items, opening stock ──────────────────────────────────

LOCATIONS = {
    "main_store": ("DEMO-MAIN", f"{LABEL} Main Store", "unit1", "Main store", "Raw material & bought-out"),
    "production_floor": ("DEMO-PROD", f"{LABEL} Production Floor (WIP)", "unit1", "Production / WIP", "Work in progress"),
    "spares_store": ("DEMO-SPARES", f"{LABEL} Service Spares Store", "unit1", "Spares", "Spares"),
    "rdc_store": ("DEMO-RDC", f"{LABEL} RDC Prototype Store", "rdc", "Prototype / lab", "Prototype material"),
}

# code, name, type, category, uom, hsn, gst, cost, lead days, opening qty, location, flags
ITEMS = [
    ("DEMO-RM-MS-PLATE-10", "DEMO MS Plate IS 2062 E250 BR 10 mm", "material", "Raw Material", "KG", "7208", 18, 68, 10, 2500, "main_store", {"batch_controlled": True, "inspection_on_receipt": True, "test_certificate_required": True, "material_grade": "IS 2062 E250 BR"}),
    ("DEMO-RM-ISMC-100", "DEMO ISMC 100 Channel", "material", "Raw Material", "KG", "7216", 18, 62, 10, 1800, "main_store", {"batch_controlled": True, "material_grade": "IS 2062 E250"}),
    ("DEMO-RM-RHS-80X40", "DEMO RHS Tube 80x40x4 mm", "material", "Raw Material", "MTR", "7306", 18, 410, 14, 120, "main_store", {}),
    ("DEMO-RM-EN8-RD-60", "DEMO EN8 Round Bar dia 60 mm", "material", "Raw Material", "KG", "7214", 18, 85, 14, 400, "main_store", {"batch_controlled": True, "inspection_on_receipt": True, "test_certificate_required": True, "material_grade": "EN8 / 080M40"}),
    ("DEMO-HYD-HOSE-12", "DEMO Hydraulic Hose 1/2 in 2SN", "material", "Hydraulic", "MTR", "4009", 18, 380, 21, 150, "main_store", {"inspection_on_receipt": True, "make": "DEMO Parkline"}),
    ("DEMO-HYD-SEAL-KIT-63", "DEMO Cylinder Seal Kit 63 mm bore", "material", "Hydraulic", "KIT", "4016", 18, 1450, 21, 20, "main_store", {}),
    ("DEMO-HYD-PUMP-GP28", "DEMO Gear Pump 28 cc/rev", "material", "Hydraulic", "NOS", "8413", 18, 18500, 45, 4, "main_store", {"inspection_on_receipt": True, "test_certificate_required": True, "serial_controlled": True}),
    ("DEMO-HYD-DCV-43", "DEMO Directional Control Valve 4/3 CETOP-5 24 VDC", "material", "Hydraulic", "NOS", "8481", 18, 9200, 30, 6, "main_store", {"inspection_on_receipt": True}),
    ("DEMO-HYD-MOTOR-ORB200", "DEMO Orbital Hydraulic Motor 200 cc", "material", "Hydraulic", "NOS", "8412", 18, 26500, 60, 0, None, {"inspection_on_receipt": True}),
    ("DEMO-HYD-OIL-68", "DEMO Hydraulic Oil ISO VG 68", "material", "Hydraulic", "LTR", "2710", 18, 165, 7, 420, "main_store", {"batch_controlled": True}),
    ("DEMO-ELE-PROX-M18", "DEMO Proximity Sensor M18 PNP NO", "material", "Electrical", "NOS", "8536", 18, 1850, 21, 25, "main_store", {"inspection_on_receipt": True}),
    ("DEMO-ELE-RELAY-24V", "DEMO Relay 24 VDC 2CO with base", "material", "Electrical", "NOS", "8536", 18, 420, 14, 60, "main_store", {}),
    ("DEMO-ELE-CABLE-4C25", "DEMO Flexible Cable 4C x 2.5 sq mm", "material", "Electrical", "MTR", "8544", 18, 145, 10, 500, "main_store", {}),
    ("DEMO-ELE-BATT-12V100", "DEMO Battery 12 V 100 Ah", "material", "Electrical", "NOS", "8507", 18, 9800, 14, 6, "main_store", {"serial_controlled": True}),
    ("DEMO-ELE-PLC-CPU", "DEMO PLC CPU 24 DI / 16 DO", "material", "Electrical", "NOS", "8537", 18, 42000, 45, 0, None, {"inspection_on_receipt": True, "serial_controlled": True}),
    ("DEMO-MEC-BRG-22216", "DEMO Spherical Roller Bearing 22216 E", "material", "Mechanical Components", "NOS", "8482", 18, 6200, 30, 16, "main_store", {"inspection_on_receipt": True}),
    ("DEMO-MEC-ENGINE-74KW", "DEMO Diesel Engine 74 kW CEV Stage V", "material", "Mechanical Components", "NOS", "8408", 18, 685000, 90, 2, "main_store", {"inspection_on_receipt": True, "test_certificate_required": True, "serial_controlled": True}),
    ("DEMO-MEC-WHEEL-430", "DEMO Rail Guide Wheel dia 430 mm", "material", "Mechanical Components", "NOS", "8607", 18, 48500, 60, 8, "main_store", {"inspection_on_receipt": True, "test_certificate_required": True}),
    ("DEMO-MEC-TYRE-1000R20", "DEMO Road Tyre 10.00 R20", "material", "Mechanical Components", "NOS", "4011", 18, 24500, 21, 6, "main_store", {}),
    ("DEMO-HWF-BOLT-M16X60", "DEMO Hex Bolt M16 x 60 Gr 8.8 HDG", "material", "Hardware & Fasteners", "NOS", "7318", 18, 18, 7, 2000, "main_store", {}),
    ("DEMO-PNT-PU-RAL1003", "DEMO PU Paint Signal Yellow RAL 1003", "material", "Paint & Chemicals", "LTR", "3208", 18, 520, 10, 80, "main_store", {"batch_controlled": True, "expiry_controlled": True, "shelf_life_days": 365}),
    ("DEMO-CN-ELECTRODE-7018", "DEMO Welding Electrode E7018 3.15 mm", "consumable", "Workshop Consumables", "KG", "8311", 18, 210, 7, 150, "production_floor", {}),
    ("DEMO-CN-GRIND-DISC-4", "DEMO Grinding Disc 4 in", "consumable", "Workshop Consumables", "NOS", "6804", 18, 38, 7, 300, "production_floor", {}),
    ("DEMO-SP-FILTER-RET10", "DEMO Return Line Filter Element 10 micron", "material", "Hydraulic", "NOS", "8421", 18, 1650, 21, 18, "spares_store", {}),
    ("DEMO-SP-GRIND-STONE-150", "DEMO Rail Grinding Stone 150 mm", "material", "Mechanical Components", "NOS", "6804", 18, 3400, 30, 40, "spares_store", {}),
]

# Which vendor normally supplies each item group (preferred vendor on the item).
_VENDOR_BY_CATEGORY = {"Raw Material": "steel", "Hydraulic": "hydraulics", "Electrical": "electricals",
                       "Mechanical Components": "bearings", "Hardware & Fasteners": "steel", "Paint & Chemicals": "steel"}

OPENING_TYPE = "Opening stock"


def seed_store_masters(demo) -> None:
    from app.modules.store.models.category import StoreItemCategory
    from app.modules.store.models.location import StoreLocation
    from sqlalchemy import func

    people = demo.data["people"]
    hint = {"unit1": demo.data["branch_id"],
            "rdc": next((i for n, i in demo.data["branches"].items() if "rdc" in n.lower()), demo.data["branch_id"])}
    locations = {}
    for key, (code, name, branch, wtype, inv) in LOCATIONS.items():
        row = demo.db.query(StoreLocation).filter(StoreLocation.code == code).first()
        if row:
            locations[key] = row.id
            continue
        # Only an admin may set a store's manager, so the admin creates them.
        locations[key] = demo.call("POST", "/store/locations", json={
            "name": name, "code": code, "branch_id": hint[branch], "warehouse_type": wtype, "inventory_type": inv,
            "manager_user_id": people["store_manager"].id, "status": "active", "operating_hours": "09:00–17:30 Mon–Sat",
        })["id"]
    demo.data["locations"] = locations

    categories = {}
    for name in sorted({i[3] for i in ITEMS}):
        row = demo.db.query(StoreItemCategory).filter(func.lower(StoreItemCategory.name) == name.lower(),
                                                      StoreItemCategory.parent_id.is_(None)).first()
        categories[name] = row.id if row else demo.call("POST", "/store/categories", people["store_manager"], json={"name": name})["id"]
    demo.data["categories"] = categories

    # A dedicated "Opening stock" entry type keeps go-live balances apart
    # from day-to-day receipts in the stock ledger (standard ERP practice).
    status, types = demo.try_call("GET", "/store/doc-types/stock_entry", people["store_manager"])
    if status != 200:
        raise SystemExit(f"Can't read Store stock entry types ({status}): {types}")
    if not any(t["label"].lower() == OPENING_TYPE.lower() for t in types):
        demo.call("POST", "/store/doc-types/stock_entry", people["store_manager"], json={"label": OPENING_TYPE, "stock_effect": "in"})
    demo.note("store", f"{len(locations)} DEMO stores, {len(categories)} categories, '{OPENING_TYPE}' entry type")


def seed_items(demo) -> None:
    from app.modules.store.models.item import StoreItem

    keeper = demo.data["people"]["store_keeper"]
    vendors = demo.data["vendors"]
    items = {}
    for code, name, itype, cat, uom, hsn, gst, cost, lead, qty, loc, flags in ITEMS:
        row = demo.db.query(StoreItem).filter(StoreItem.item_code == code).first()
        if row:
            item = demo.call("GET", f"/store/items/{row.id}", keeper)
        else:
            reorder = max(round(qty * 0.3), 1) if qty else 2
            item = demo.call("POST", "/store/items", keeper, json={
                "item_code": code, "item_name": name, "item_type": itype, "category": cat, "uom": uom,
                "hsn_sac_code": hsn, "gst_rate": gst, "standard_cost": cost, "lead_time_days": lead,
                "minimum_stock": max(round(reorder / 2), 1), "safety_stock": max(round(reorder / 2), 1), "reorder_level": reorder,
                "maximum_stock": max(qty * 2, reorder * 3), "reorder_quantity": max(reorder * 2, 1),
                "preferred_vendor_id": (vendors.get(_VENDOR_BY_CATEGORY.get(cat)) or {}).get("id"),
                "preferred_warehouse_id": demo.data["locations"][loc or "main_store"],
                "description": f"{LABEL} item for the RRV / rail machine build.", **flags,
            })
        items[code] = {**item, "code": code, "name": item["item_name"], "unit": item["uom"], "rate": cost,
                       "opening_qty": qty, "location": loc}
    demo.data["items"] = items
    demo.note("store", f"{len(items)} DEMO items in the item master")


def seed_opening_stock(demo) -> None:
    from app.modules.store.models.stock_entry import StoreStockEntry

    manager = demo.data["people"]["store_manager"]
    _s, types = demo.try_call("GET", "/store/doc-types/stock_entry", manager)
    opening = next(t["value"] for t in types if t["label"].lower() == OPENING_TYPE.lower())
    entries = {}
    by_loc: dict[str, list[dict]] = {}
    for it in demo.data["items"].values():
        if it["opening_qty"] and it["location"]:
            by_loc.setdefault(it["location"], []).append(it)
    for loc_key, rows in by_loc.items():
        loc_id = demo.data["locations"][loc_key]
        existing = demo.db.query(StoreStockEntry).filter(
            StoreStockEntry.location_id == loc_id, StoreStockEntry.entry_type == opening,
            StoreStockEntry.invoice_number == "DEMO-OPENING").first()
        if existing:
            entries[loc_key] = existing.entry_number
            continue
        payload = {
            "entry_type": opening, "location_id": loc_id, "entry_date": str(demo.today), "invoice_number": "DEMO-OPENING",
            "remarks": f"{LABEL} opening stock at go-live (physical count, valued at standard cost).",
            "lines": [{"item_id": it["id"], "quantity": it["opening_qty"], "unit_cost": it["rate"],
                       "batch_number": "DEMO-OPEN-01" if it.get("batch_controlled") else None} for it in rows],
        }
        entry = demo.call("POST", "/store/stock/entries", manager, data={"payload": json.dumps(payload)})
        entries[loc_key] = entry["entry_number"]
        demo.note("store", f"opening stock {entry['entry_number']} at {entry['location_name']}: {len(rows)} items")
    demo.data["opening_entry"] = entries


# ── CRM customers ────────────────────────────────────────────────────────

CUSTOMERS = {
    "northern_railway": (f"{LABEL} Northern Railway – Lucknow Division", "Railway Division", "Indian Railways", "Northern Railway", "Lucknow Division",
                         "Hazratganj", "Uttar Pradesh", "Lucknow", "226001", "09", "AAAGN1111A",
                         [("Sr. DEN (Co-ord)", "Alok Srivastava", "Engineering"), ("Dy. CMM", "Neha Tripathi", "Stores")]),
    "central_railway_workshop": (f"{LABEL} Central Railway – Matunga Workshop", "Railway Workshop", "Indian Railways", "Central Railway", "Matunga Workshop",
                                 "Matunga", "Maharashtra", "Mumbai", "400019", "27", "AAAGC2222B",
                                 [("Chief Workshop Manager", "Sanjay Patil", "Mechanical"), ("Works Manager (Planning)", "Rohini Deshmukh", "Planning")]),
    "dmrc": (f"{LABEL} Delhi Metro Rail Corporation", "Metro Rail", None, "Not Applicable", None,
             "Metro Bhawan, Barakhamba Road", "Delhi", "New Delhi", "110001", "07", "AAACD3333C",
             [("Dy. GM / Track", "Vikram Malhotra", "Track"), ("Manager / Procurement", "Priya Sethi", "Contracts")]),
    "rvnl": (f"{LABEL} Rail Vikas Nigam Ltd", "Railway PSU", "Ministry of Railways", "Not Applicable", None,
             "August Kranti Bhawan, Bhikaji Cama Place", "Delhi", "New Delhi", "110066", "07", "AABCR4444D",
             [("Chief Project Manager", "Harish Chandra", "Projects"), ("Jt. GM / Contracts", "Meenakshi Rao", "Contracts")]),
    "ircon": (f"{LABEL} IRCON International Ltd", "Railway PSU", "Ministry of Railways", "Not Applicable", None,
              "C-4, District Centre, Saket", "Delhi", "New Delhi", "110017", "07", "AAACI5555E",
              [("GM / Mechanical", "Rajeev Bansal", "Mechanical"), ("Dy. GM / Procurement", "Kavita Joshi", "Procurement")]),
    "lt_metro": (f"{LABEL} L&T Metro Rail (Hyderabad) Ltd", "Metro Rail", "Larsen & Toubro", "Not Applicable", None,
                 "Uppal Depot", "Telangana", "Hyderabad", "500039", "36", "AACCL6666F",
                 [("Head – Rolling Stock & P-Way", "Srinivas Reddy", "Maintenance"), ("Sr. Manager – Purchase", "Lakshmi Narayana", "Purchase")]),
}


def seed_customers(demo) -> None:
    from app.modules.crm.models.organization import Organization
    from sqlalchemy import func

    bd = demo.data["people"]["bd"]
    out = {}
    for n, (key, (name, otype, parent, zone, division, addr, state, city, pin, st, pan, contacts)) in enumerate(CUSTOMERS.items(), 1):
        row = demo.db.query(Organization).filter(func.lower(Organization.name) == name.lower(), Organization.is_deleted == False).first()  # noqa: E712
        org = demo.call("GET", f"/crm/organizations/{row.id}", bd) if row else demo.call("POST", "/crm/organizations", bd, json={
            "name": name, "org_type": otype, "parent_org": parent, "railway_zone": zone, "division_workshop": division,
            "address": addr, "country": "India", "state": state, "city": city, "pin_code": pin,
            "gst_number": demo.gstin(st, pan), "official_phone": f"+91 11 4000 {n:04d}",
            "official_email": f"procurement.{key.replace('_', '')}@example.invalid", "credit_days": 60,
        })
        existing = demo.call("GET", f"/crm/organizations/{org['id']}/contacts", bd)
        have = {c["name"] for c in existing}
        rows = list(existing)
        for i, (designation, person, dept) in enumerate(contacts, 1):
            cname = f"{LABEL} {person}"
            if cname in have:
                continue
            rows.append(demo.call("POST", f"/crm/organizations/{org['id']}/contacts", bd, json={
                "name": cname, "designation": designation, "department": dept, "mobile": f"+91 9{n:02d}00 0{i:04d}",
                "email": f"{person.split()[0].lower()}.{key.replace('_', '')}@example.invalid",
            }))
        out[key] = {**org, "contacts": rows, "contact_ids": [c["id"] for c in rows]}
    demo.data["customers"] = out
    demo.note("crm", f"{len(out)} DEMO customer organizations with {sum(len(c['contacts']) for c in out.values())} contacts")


# ── Entry point ──────────────────────────────────────────────────────────

def seed(demo) -> None:
    seed_roles(demo)
    seed_organization(demo)
    seed_people(demo)
    seed_products(demo)
    seed_vendors(demo)
    seed_store_masters(demo)
    seed_items(demo)
    seed_opening_stock(demo)
    seed_customers(demo)
