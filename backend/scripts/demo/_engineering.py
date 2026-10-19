"""Shared set-up for the engineering seeders (design, electrical, hydraulic).

Each of the three seeders calls `ensure_engineering(demo)` first, so any of
them can run on its own (`--just electrical`) and still find its people and
product items. Everything here is idempotent (matched by email / code).

What it adds to demo.data:

  people          + design_checker      Senior Design Engineer (checker — the 2nd signature)
                  + electrical_engineer Electrical Design Engineer
                  + hydraulic_engineer  Hydraulics & Pneumatics Engineer
  product_items   dict product code -> Store item dict (+ "code", "name", "unit")
                  for the finished product (item code = product code), linked to
                  the product master (products.store_item_id). Re-uses the item a
                  sales seeder already linked, if any.
  subassembly_items dict code -> Store item dict for the sub-assemblies the
                  multi-level BOMs use (DEMO-SA-HPU-RRV, DEMO-SA-EPNL-RRV,
                  DEMO-SA-GWU-RRV).

Access (RBAC through demo.role / demo.assign — nobody is made admin):
  "DEMO Design Checker"             design_checker: Design Engineer + approve on
                                    documents / BOMs / reviews (the check stage
                                    of the approval engine needs design:<tab>:approve).
  "DEMO Electrical Engineer"        routine Electrical work + Design register
                                    drawing authoring (E/H/P drawings live there).
  "DEMO Hydraulic Engineer"         routine Hydraulic & Pneumatic work + Design
                                    register drawing authoring.
  "DEMO E/H/P drawing release"      electrical_head + hydraulic_head: approve /
                                    release E/H/P drawings in the Design register
                                    (owner decision 2026-10-07: the discipline head
                                    or their assignee releases E/H/P drawings).
  "DEMO Design requester"           bd, rnd_head: raise design requests.
  "DEMO Design viewer (departments)" production / store / purchase / quality
                                    managers: see released drawings & BOMs, raise
                                    ECRs, vote on the change board, acknowledge ECNs.
"""
from __future__ import annotations

from demo._common import LABEL

EMPLOYEE_ROLE = "Employee self-service"

# key: (slug, name, designation, department, reports_to, role)
ENGINEERS = {
    "design_checker": ("design.checker", "Design Checker", "Senior Design Engineer (Checker)", "Design", "design_head", "Design Checker"),
    "electrical_engineer": ("electrical.engineer", "Electrical Engineer", "Electrical Design Engineer", "Electrical", "electrical_head", "Electrical Engineer"),
    "hydraulic_engineer": ("hydraulic.engineer", "Hydraulic Engineer", "Engineer – Hydraulics & Pneumatics", "Fluids", "hydraulic_head", "Hydraulic Engineer"),
}

# Sub-assemblies with their own BOM (multi-level explosion).
SUBASSEMBLIES = {
    "DEMO-SA-HPU-RRV": ("DEMO Hydraulic Power Pack – RRV 8W (sub-assembly)", "Hydraulic", "8412", 165000),
    "DEMO-SA-EPNL-RRV": ("DEMO Main Electrical Panel – RRV 8W (sub-assembly)", "Electrical", "8537", 98000),
    "DEMO-SA-GWU-RRV": ("DEMO Rail Guide Wheel Unit – RRV 8W (sub-assembly)", "Mechanical Components", "8607", 142000),
}

FINISHED_CATEGORY = "Finished Goods"


def _roles(demo) -> dict[str, list]:
    from app.core.permission_registry import AUTHORITY_GRANTS
    P = demo.perms

    def std(module, skip=("delete", "approve", "reject")):
        return [g for g in P(module, skip=skip) if g not in AUTHORITY_GRANTS and not g.endswith(":settings:edit")]

    item_lookup = ["store:items:view", "store:stock:view"]
    pr_raise = P("p2p", "purchase_requisitions", actions=["view", "create", "edit", "submit", "cancel"])
    design_author = [P("design", "dashboard"), P("design", "documents", "boms", actions=["view", "create", "edit", "submit", "cancel", "print"]),
                     P("design", "change_notices", "reviews", "library", actions=["view"])]
    design_engineer = [g for g in std("design") if ":settings:" not in g]
    return {
        "Design Checker": [design_engineer, P("design", "documents", "boms", "reviews", actions=["approve"]), "products:*:view", item_lookup, pr_raise],
        "Electrical Engineer": [std("electrical"), design_author, item_lookup, pr_raise],
        "Hydraulic Engineer": [std("hydraulic"), design_author, item_lookup, pr_raise],
        "E/H/P drawing release": [P("design", "dashboard"), P("design", "documents", "reviews", actions=["view", "approve", "reject"]),
                                  P("design", "boms", "change_notices", "library", actions=["view"])],
        "Design requester": [P("design", "dashboard"), P("design", "project_work", actions=["view", "create", "edit"]),
                             P("design", "documents", "boms", actions=["view"])],
        "Design viewer (departments)": [P("design", "dashboard"), P("design", "documents", "boms", "change_notices", "library", actions=["view"]),
                                        P("design", "change_notices", actions=["create"])],
    }


def _ensure_people(demo) -> None:
    from app.modules.main.models.role import Role
    from app.modules.main.models.user import User
    from app.modules.organization.models.department import Department
    from sqlalchemy import func

    people = demo.data["people"]
    roles = {name: demo.role(name, grants) for name, grants in _roles(demo).items()}
    for key, (slug, name, designation, dept, boss, role) in ENGINEERS.items():
        u = demo.user(slug, name, [], designation=designation, department=dept)
        boss_user = people.get(boss)
        u.branch_id = boss_user.branch_id if boss_user else demo.data.get("branch_id")
        demo.db.commit()
        dept_id = (demo.data.get("departments") or {}).get(dept)
        if not dept_id:
            row = demo.db.query(Department).filter(func.lower(Department.name) == dept.lower()).first()
            dept_id = row.id if row else None
        if dept_id and (u.department or "").lower() != dept.lower():
            demo.try_call("POST", f"/organization/departments/{dept_id}/members", json={"user_id": u.id})
        extra = [EMPLOYEE_ROLE] if demo.db.query(Role).filter(Role.name == EMPLOYEE_ROLE).first() else []
        u = demo.assign(u, roles[role], *extra)
        if boss_user and u.reporting_manager_id != boss_user.id:
            row = demo.db.get(User, u.id)
            row.reporting_manager_id = boss_user.id
            demo.db.commit()
        people[key] = demo.db.get(User, u.id)
    for key in ("electrical_head", "hydraulic_head"):
        people[key] = demo.assign(people[key], roles["E/H/P drawing release"])
    for key in ("bd", "rnd_head"):
        people[key] = demo.assign(people[key], roles["Design requester"])
    for key in ("production_manager", "store_manager", "purchase_manager", "quality_manager", "project_manager"):
        people[key] = demo.assign(people[key], roles["Design viewer (departments)"])
    demo.data.setdefault("roles", {}).update(roles)


def _store_category(demo, name: str) -> None:
    from app.modules.store.models.category import StoreItemCategory
    from sqlalchemy import func
    cats = demo.data.setdefault("categories", {})
    if name in cats:
        return
    row = demo.db.query(StoreItemCategory).filter(func.lower(StoreItemCategory.name) == name.lower(), StoreItemCategory.parent_id.is_(None)).first()
    cats[name] = row.id if row else demo.call("POST", "/store/categories", demo.data["people"]["store_manager"], json={"name": name})["id"]


def _store_item(demo, code: str, name: str, category: str, hsn: str, cost: float, uom: str = "NOS", description: str = "") -> dict:
    from app.modules.store.models.item import StoreItem
    keeper = demo.data["people"]["store_keeper"]
    row = demo.db.query(StoreItem).filter(StoreItem.item_code == code).first()
    if row:
        item = demo.call("GET", f"/store/items/{row.id}", keeper)
    else:
        _store_category(demo, category)
        item = demo.call("POST", "/store/items", keeper, json={
            "item_code": code, "item_name": name, "item_type": "material", "category": category, "uom": uom,
            "hsn_sac_code": hsn, "gst_rate": 18, "standard_cost": cost, "lead_time_days": 90,
            "minimum_stock": 0, "safety_stock": 0, "reorder_level": 0, "maximum_stock": 2, "reorder_quantity": 1,
            "preferred_warehouse_id": demo.data["locations"]["main_store"],
            "description": description or f"{LABEL} item built in-house (made to order).",
        })
    return {**item, "code": code, "name": item["item_name"], "unit": item["uom"]}


def _ensure_product_items(demo) -> None:
    from app.modules.store.models.item import StoreItem
    owner = demo.data["people"]["rnd_head"]
    out = dict(demo.data.get("product_items") or {})
    for code, product in (demo.data.get("products") or {}).items():
        if code in out and isinstance(out[code], dict) and out[code].get("id"):
            continue
        fresh = demo.call("GET", f"/products/{product['id']}", owner)
        item_id = fresh.get("store_item_id")
        if item_id and demo.db.get(StoreItem, item_id):
            item = demo.call("GET", f"/store/items/{item_id}", demo.data["people"]["store_keeper"])
            out[code] = {**item, "code": item["item_code"], "name": item["item_name"], "unit": item["uom"]}
            continue
        item = _store_item(demo, code, fresh["name"], FINISHED_CATEGORY, fresh.get("hsn_code") or "8430", 0, "NOS",
                           f"{LABEL} finished product — the Store / BOM key of product {code}.")
        out[code] = item
        st, body = demo.try_call("PATCH", f"/products/{product['id']}", owner, json={"store_item_id": item["id"]})
        if st >= 400:
            demo.note("products", f"couldn't link {code} to its store item ({st}): {body}")
    demo.data["product_items"] = out
    subs = {}
    for code, (name, cat, hsn, cost) in SUBASSEMBLIES.items():
        subs[code] = _store_item(demo, code, name, cat, hsn, cost, "NOS", f"{LABEL} sub-assembly with its own Design BOM.")
    demo.data["subassembly_items"] = subs


def ensure_engineering(demo) -> None:
    """People, roles and product / sub-assembly items for E/H/P + Design."""
    if demo.data.get("_engineering_ready"):
        return
    _ensure_people(demo)
    _ensure_product_items(demo)
    demo.data["_engineering_ready"] = True
    demo.note("engineering", "design checker, electrical & hydraulic engineers, E/H/P release role, "
                             f"{len(demo.data['product_items'])} product items + {len(demo.data['subassembly_items'])} sub-assembly items ready")


# ── Upstream links (each optional — other seeders may not have run) ────────

def _rows(value) -> list[dict]:
    if isinstance(value, dict):
        vals = list(value.values())
        if vals and all(isinstance(v, dict) for v in vals):
            return vals
        return [value] if value.get("id") else []
    if isinstance(value, list):
        return [v for v in value if isinstance(v, dict)]
    return []


def upstream(demo, key: str) -> list[dict]:
    """Registry rows of another seeder (dicts), or [] when it hasn't run."""
    return _rows(demo.data.get(key))


def number_of(row: dict | None) -> str | None:
    if not row:
        return None
    for k in ("order_number", "so_number", "number", "offer_number", "technical_offer_number", "universal_id", "quotation_number", "code"):
        if row.get(k):
            return str(row[k])
    return f"#{row.get('id')}" if row.get("id") else None


def sales_order_for(demo, product_code: str, index: int = 0) -> dict | None:
    """A sales order that mentions the product, else the index-th one."""
    orders = upstream(demo, "sales_orders")
    if not orders:
        return None
    for so in orders:
        if product_code in str(so):
            return so
    return orders[index % len(orders)]


def customer_id(demo, key: str) -> int | None:
    c = (demo.data.get("customers") or {}).get(key)
    return c.get("id") if isinstance(c, dict) else None


def customer_name(demo, key: str) -> str | None:
    c = (demo.data.get("customers") or {}).get(key)
    return c.get("name") if isinstance(c, dict) else None


def pdf(demo, name: str):
    """Multipart file tuple for an upload field."""
    return demo.pdf(name)


def reply_requirement_shares(demo, department, user, remarks):
    """Answer the oldest open R&D requirement share of `department`
    (Design / Electrical / Hydraulic › Requirements); any others stay open.
    `remarks` = (response, text). Skipped with a note when R&D shared none."""
    st, rows = demo.try_call("GET", f"/rnd/department-requirements/{department}", user, params={"include_closed": False})
    if st != 200:
        demo.note(department, f"R&D requirement shares not readable ({st}): {rows}")
        return None
    open_rows = [r for r in rows if r.get("status") == "open"]
    if not open_rows:
        demo.note(department, "no open R&D requirement share for this department (rnd seeder didn't share one) — reply skipped")
        return None
    share = open_rows[-1]
    resp, text = remarks
    st, body = demo.try_call("POST", f"/rnd/department-requirements/{department}/{share['id']}/respond", user,
                             data={"response": resp, "remarks": text}, files=[("files", demo.pdf(f"DEMO-{department}-feasibility.pdf"))])
    if st >= 400:
        demo.note(department, f"reply to R&D share #{share['id']} failed ({st}): {body}")
        return None
    demo.note(department, f"replied '{resp}' to R&D requirement share #{share['id']} ({len(open_rows) - 1} left open)")
    return body
