"""Purpose of a purchase requisition (2026-10-23).

The PR form asks "what is this purchase for?" first; the answer decides what
it must be charged to, so every rupee lands on a real cost object:

  customer_order   production of an ordered machine: its Order Project (a
                   sales order is accepted too — its project is derived);
                   lines name their vehicle / lot
  machine_project  service of a delivered machine (ERP project); the charge
                   is optional (work order, internal order, sales order, order project)
  development      an internal order (the development job and its budget)
  department       nothing on the PR — Purchase picks the cost centre on the
                   PO (the requester's department's by default, see below)
  capital          an internal order (the asset job and its budget)
  stock            nothing — store stock is charged when it is issued

Overhead purposes (department / capital / development / stock) are not bought
for a customer project, so every line is Inhouse. Requisitions raised before
this (purpose NULL) keep the old existing/new project rules.

The purpose also narrows the PR category (what is bought, which decides the
buyer) to the ones that make sense for it, and pre-fills the category and
requirement type where one answer is the usual one (PURPOSE_FORM)."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import event, func, select

from app.modules.p2p.models.p2p_request import P2P_PURPOSES, P2P_REQUIREMENT_TYPES, P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder

# Purposes whose lines are never for a customer project.
INHOUSE_ONLY = ("development", "department", "capital", "stock")

# What each purpose may be charged to; the first is the required one where
# the purpose has a single answer. None in the tuple = may be left blank.
_ALLOWED: dict[str, tuple] = {
    "customer_order": ("order_project", "sales_order"),
    "machine_project": (None, "work_order", "internal_order", "sales_order", "order_project"),
    "development": ("internal_order",),
    # Older requisitions carry a cost centre; new ones leave it to the PO.
    "department": (None, "cost_center"),
    "capital": ("internal_order",),
    "stock": (None,),
}

# Per purpose: categories offered (in this order), the pre-filled category
# (None = the requester picks) and the pre-filled requirement type. 'Others'
# is never offered — it has no buyer and says nothing in reports.
PURPOSE_FORM: dict[str, dict] = {
    "customer_order": {"categories": ("RAW", "PNH", "ELE", "HWC", "MKT", "JOB"),
                       "category": None, "requirement_type": "Material"},
    "machine_project": {"categories": ("PNH", "ELE", "HWC", "MKT", "JOB", "SRV"),
                        "category": None, "requirement_type": "Material + Service"},
    "development": {"categories": ("RAW", "PNH", "ELE", "HWC", "MKT", "JOB", "SRV"),
                    "category": None, "requirement_type": "Material"},
    "department": {"categories": ("ADM", "HWC", "MKT", "SRV", "ELE"),
                   "category": "ADM", "requirement_type": "Material"},
    "capital": {"categories": ("CAP", "ELE", "PNH", "SRV"),
                "category": "CAP", "requirement_type": "Capital Equipment"},
    "stock": {"categories": ("HWC", "RAW", "PNH", "ELE", "MKT"),
              "category": "HWC", "requirement_type": "Material"},
}

# Per purpose: the Item Master item types (store/models/item.py STORE_ITEM_TYPES)
# a line may be bought as, most usual first. The form offers only these in the
# line's Item Type picker and item list. A service type is allowed wherever job
# work / outside services are bought; an asset is only for a capital purchase.
PURPOSE_ITEM_TYPES: dict[str, tuple[str, ...]] = {
    "customer_order": ("material", "consumable", "tool_equipment", "service"),
    "machine_project": ("material", "consumable", "service", "tool_equipment"),
    "development": ("material", "consumable", "tool_equipment", "service"),
    "department": ("consumable", "service", "material", "tool_equipment"),
    "capital": ("asset", "tool_equipment", "service"),
    "stock": ("material", "consumable", "tool_equipment"),
}
for _code, _form in PURPOSE_FORM.items():
    _form["item_types"] = PURPOSE_ITEM_TYPES[_code]


# ------------------------------------------------------------ editable rules
#
# The dicts above are the code DEFAULTS. Procurement > Settings > Purpose rules
# stores an override per purpose (module_settings row key "purpose_rules.<code>",
# written by routes/purpose_rules.py); resolve_purpose_rules() merges the two and
# is the ONE place the PR form (/meta) and the server validators read from.

RULES_KEY_PREFIX = "purpose_rules."

# Accepted by the server for old requisitions / derived charges but never
# offered on the form: a customer order may carry a sales order (its Order
# Project is derived), a department cost centre is filled by Purchase on the PO.
_LEGACY_EXTRA_KINDS: dict[str, tuple[str, ...]] = {"customer_order": ("sales_order",), "department": ("cost_center",)}

# Charged To kinds an admin may pick for each purpose.
VALID_CHARGED_TO: dict[str, tuple[str, ...]] = {
    "customer_order": ("order_project", "sales_order"),
    "machine_project": ("work_order", "internal_order", "sales_order", "order_project"),
    "development": ("internal_order", "work_order"),
    "department": ("internal_order", "cost_center"),
    "capital": ("internal_order", "work_order"),
    "stock": (),
}
CHARGED_TO_LABELS = {"order_project": "Order project", "sales_order": "Sales order", "work_order": "Production work order",
                     "internal_order": "Internal order", "cost_center": "Cost centre"}


# How a requisition line says what project it is for (2026-10-24 - one project
# per machine, so a line never picks a vehicle / lot or Project-vs-Inhouse):
#   inherit   the header names the one project (Order project / Machine project);
#             every line is stored as "Project" - what Service-raised requisitions
#             store - tied to that project (see p2p/order_project_links.py)
#   inhouse   overhead buying: every line is Inhouse
LINE_PROJECT_MODES = {"inherit": "Every line is for the header's project",
                      "inhouse": "Every line is Inhouse (no project)"}
DEFAULT_LINE_PROJECT_MODE = {p: ("inhouse" if p in INHOUSE_ONLY else "inherit") for p in PURPOSE_FORM}


def default_rules(purpose: str) -> dict:
    """The code default rules of one purpose, in the shape the settings store."""
    form = PURPOSE_FORM[purpose]
    allowed = _ALLOWED[purpose]
    extra = _LEGACY_EXTRA_KINDS.get(purpose, ())
    return {
        "categories": list(form["categories"]),
        "default_category": form["category"],
        "lock_category": False,
        "requirement_types": list(P2P_REQUIREMENT_TYPES),
        "default_requirement_type": form["requirement_type"],
        "lock_requirement_type": False,
        "item_types": list(PURPOSE_ITEM_TYPES[purpose]),
        "charged_to_kinds": [k for k in allowed if k and k not in extra],
        "charged_required": None not in allowed,
        "line_project_mode": DEFAULT_LINE_PROJECT_MODE[purpose],
    }


def _names(codes, labels: dict) -> str:
    return ", ".join(labels.get(c, c) for c in codes)


def validate_rules(purpose: str, raw: dict) -> dict:
    """Check an admin's rules for `purpose` and return them cleaned. Raises
    ValueError naming the field, the rule and the fix (nothing is saved)."""
    from app.modules.p2p.models.p2p_request import P2P_CATEGORIES
    from app.modules.store.models.item import STORE_ITEM_TYPES
    if purpose not in P2P_PURPOSES:
        raise ValueError(f"'{purpose}' is not a purpose - use one of: {', '.join(P2P_PURPOSES)}.")
    if not isinstance(raw, dict):
        raise ValueError("Send the rules as an object - reload the page and try again.")
    label = P2P_PURPOSES[purpose]
    base = default_rules(purpose)
    unknown = set(raw) - set(base)
    if unknown:
        raise ValueError(f"Unknown rule(s) {', '.join(sorted(unknown))} - reload the page and try again.")
    r = {**base, **raw}

    def _list(key: str, what: str, valid, labels: dict, *, empty_ok: bool = False) -> list[str]:
        v = r[key]
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            raise ValueError(f"{label}: {what} must be a list - pick the options from the list.")
        if len(set(v)) != len(v):
            raise ValueError(f"{label}: {what} lists the same option twice - remove the repeat.")
        bad = [x for x in v if x not in valid]
        if bad:
            raise ValueError(f"{label}: {_names(bad, labels)} {'is' if len(bad) == 1 else 'are'} not valid for {what} - "
                             f"choose from: {_names(valid, labels) or 'nothing'}.")
        if not v and not empty_ok:
            raise ValueError(f"{label}: pick at least one option for {what} - with none, the requisition form could not be filled.")
        return v

    cats = _list("categories", "categories", [c for c in P2P_CATEGORIES if c != "OTH"], P2P_CATEGORIES)
    reqs = _list("requirement_types", "requirement types", list(P2P_REQUIREMENT_TYPES), {})
    types = _list("item_types", "item types", list(STORE_ITEM_TYPES), {t: t.replace("_", " ") for t in STORE_ITEM_TYPES})
    kinds = _list("charged_to_kinds", "Charged To", list(VALID_CHARGED_TO[purpose]), CHARGED_TO_LABELS, empty_ok=True)

    def _default(key: str, lock_key: str, options: list[str], labels: dict, what: str) -> tuple[str | None, bool]:
        d = r[key] or None
        lock = bool(r[lock_key])
        if d is not None and d not in options:
            raise ValueError(f"{label}: the default {what} ({labels.get(d, d)}) must be one of the {what}s offered - "
                             f"add it to the list or pick another default.")
        if lock and d is None and len(options) != 1:
            raise ValueError(f"{label}: to lock the {what} pick a default {what} - the form fills in the default and shows it as fixed.")
        return d, lock
    cat_default, cat_lock = _default("default_category", "lock_category", cats, P2P_CATEGORIES, "category")
    req_default, req_lock = _default("default_requirement_type", "lock_requirement_type", reqs, {}, "requirement type")

    required = bool(r["charged_required"])
    if required and not kinds:
        raise ValueError(f"{label}: Charged To is marked required but no kind is allowed - "
                         + ("pick at least one kind, or untick required." if VALID_CHARGED_TO[purpose]
                            else "a store stock refill is never charged, so untick required."))
    mode = r["line_project_mode"]
    if mode not in LINE_PROJECT_MODES:
        raise ValueError(f"{label}: line project mode must be one of: {', '.join(LINE_PROJECT_MODES.values())} - pick one from the list.")
    return {"categories": cats, "default_category": cat_default, "lock_category": cat_lock,
            "requirement_types": reqs, "default_requirement_type": req_default, "lock_requirement_type": req_lock,
            "item_types": types, "charged_to_kinds": kinds, "charged_required": required,
            "line_project_mode": mode}


def load_overrides(db) -> dict[str, dict]:
    """The saved override rows, {purpose: rules}. None db = none."""
    if db is None:
        return {}
    from app.modules.main.models.module_setting import ModuleSetting
    rows = db.query(ModuleSetting).filter(
        ModuleSetting.module_key == "p2p", ModuleSetting.branch_id.is_(None),
        ModuleSetting.key.like(RULES_KEY_PREFIX + "%")).all()
    return {r.key[len(RULES_KEY_PREFIX):]: r.value for r in rows if isinstance(r.value, dict)}


def derive(code: str, rules: dict) -> dict:
    """Add what the form uses: the pre-filled `category` / `requirement_type`,
    whether each is locked (exactly one option = always fixed; the lock switch
    fixes it when a default exists even with several options) and the tuple of
    Charged To values the server accepts (`allowed_charges`, None = blank)."""
    rules = dict(rules)
    for field, opts, dflt, lock in (("category", "categories", "default_category", "lock_category"),
                                    ("requirement_type", "requirement_types", "default_requirement_type", "lock_requirement_type")):
        if len(rules[opts]) == 1:
            rules[field], rules[f"{field}_locked"] = rules[opts][0], True
        else:
            rules[field] = rules[dflt]
            rules[f"{field}_locked"] = bool(rules[lock] and rules[dflt])
    allowed: list = list(rules["charged_to_kinds"])
    allowed += [k for k in _LEGACY_EXTRA_KINDS.get(code, ()) if k not in allowed]
    if not rules["charged_required"]:
        allowed.insert(0, None)
    rules["allowed_charges"] = tuple(allowed)
    rules["inhouse_only"] = rules["line_project_mode"] == "inhouse"
    return rules


def resolve_purpose_rules(db=None) -> dict[str, dict]:
    """Rules of every purpose: code defaults merged with the saved overrides
    (a saved override that no longer validates - e.g. a category retired in
    code - falls back to the default rather than breaking the form), plus the
    derived fields of derive()."""
    overrides = load_overrides(db)
    out: dict[str, dict] = {}
    for code in P2P_PURPOSES:
        try:
            rules = validate_rules(code, overrides[code]) if code in overrides else default_rules(code)
        except ValueError:
            rules = default_rules(code)
        out[code] = derive(code, rules)
    return out


def _rules(db, purpose: str | None) -> dict | None:
    return resolve_purpose_rules(db).get(purpose or "")


def item_type_problem(purpose: str | None, line_label: str, item_code: str, item_name: str,
                      item_type: str | None, db=None) -> str | None:
    """Why this Item Master item can't be bought for the purpose (None when it
    can). Only the standard item types are judged - an item with no type, or a
    custom type Store added, is left alone."""
    from app.modules.store.models.item import STORE_ITEM_TYPES
    rules = _rules(db, purpose)
    allowed = rules["item_types"] if rules else None
    t = (item_type or "").strip().lower()
    if allowed is None or t not in STORE_ITEM_TYPES or t in allowed:
        return None
    fit = ", ".join(x.replace("_", " ") for x in allowed)
    return (f"{line_label} ({item_code} {item_name}) is a {t.replace('_', ' ')} item, which isn't bought on a "
            f"{P2P_PURPOSES[purpose].lower()} requisition — pick an item of type: {fit}, or change the purpose.")


def category_problem(purpose: str | None, category_code: str | None, db=None) -> str | None:
    """Why `category_code` doesn't fit the purpose (None when it does)."""
    rules = _rules(db, purpose)
    if rules is None:
        return None
    from app.modules.p2p.models.p2p_request import P2P_CATEGORIES
    label = P2P_PURPOSES[purpose].lower()
    if category_code not in rules["categories"]:
        ok = ", ".join(P2P_CATEGORIES[c] for c in rules["categories"])
        return (f"Category {P2P_CATEGORIES.get(category_code or '', category_code or 'none')} doesn't fit a "
                f"{label} requisition — pick one of: {ok}.")
    if rules["category_locked"] and category_code != rules["category"]:
        name = P2P_CATEGORIES[rules["category"]]
        return f"A {label} requisition is always {name} — change the category to {name}."
    return None


def requirement_type_problem(purpose: str | None, requirement_type: str | None, db=None) -> str | None:
    """Why the requirement type doesn't fit the purpose (None when it does, or
    when none was given)."""
    rules = _rules(db, purpose)
    if rules is None or not requirement_type:
        return None
    label = P2P_PURPOSES[purpose].lower()
    if requirement_type not in rules["requirement_types"]:
        return (f"Requirement type {requirement_type} doesn't fit a {label} requisition — "
                f"pick one of: {', '.join(rules['requirement_types'])}.")
    if rules["requirement_type_locked"] and requirement_type != rules["requirement_type"]:
        return f"A {label} requisition's requirement type is always {rules['requirement_type']} — change it to {rules['requirement_type']}."
    return None


def line_project_mode(db, purpose: str | None) -> str | None:
    """inherit / inhouse for the purpose (None for a legacy requisition)."""
    rules = _rules(db, purpose)
    return rules["line_project_mode"] if rules else None


def apply_line_project_mode(db, purpose: str | None, items) -> None:
    """Make the lines say what the purpose's mode dictates: inhouse = every line
    Inhouse with no project; inherit = every line "Project" (the header's
    project). A vehicle / lot an older requisition's line already carries is
    kept; new lines have none and link_pr_lines ties them to the project."""
    mode = line_project_mode(db, purpose)
    if mode == "inhouse":
        for i in items:
            i.project_inhouse = "Inhouse"
            i.order_project_element_id = None
    elif mode == "inherit":
        for i in items:
            i.project_inhouse = "Project"


_NEED = {
    "customer_order": "the order project of the machine being built",
    "development": "the internal order of the development job — ask Finance to open one in Finance › Masters › Internal orders if it isn't in the list",
    "capital": "the internal order of the asset purchase — ask Finance to open one in Finance › Masters › Internal orders if it isn't in the list",
}


def project_type_for(purpose: str | None) -> str | None:
    """The older existing/new project type, still filled on every requisition:
    approval workflow conditions are written on it, and a NULL project_type
    means "pre-matrix legacy PR" to the PO approval code. Only new development
    is 'new'; everything else follows the 'existing' route it always took."""
    if not purpose:
        return None
    return "new" if purpose == "development" else "existing"


def header_problems(purpose: str | None, account_assignment: str | None, project_label: str | None, db=None) -> list[str]:
    """What is missing / wrong on a submitted requisition's header, worded as
    the fix. Empty when it is fine."""
    if not purpose:
        return ["Choose the purpose of this requisition — customer order, machine / service project, new development, "
                "department running cost, asset / capital purchase or store stock refill."]
    if purpose not in P2P_PURPOSES:
        return [f"Purpose must be one of: {', '.join(P2P_PURPOSES.values())}."]
    label = P2P_PURPOSES[purpose].lower()
    names = {"order_project": "order project", "sales_order": "sales order", "work_order": "production work order",
             "internal_order": "internal order", "cost_center": "cost centre"}
    allowed = _rules(db, purpose)["allowed_charges"]
    if account_assignment not in allowed:
        if not any(allowed):
            return [f"A {label} requisition isn't charged to anything when it is bought"
                    + (" — its cost goes to whoever Store issues it to" if purpose == "stock" else "")
                    + ". Set Charged To back to blank, or pick another purpose."]
        if account_assignment is None:
            default_kinds = tuple(k for k in _ALLOWED[purpose] if k)
            need = (_NEED.get(purpose) if tuple(k for k in allowed if k) == default_kinds else None)                 or ("a charge to one of: " + ", ".join(names[a] for a in allowed if a))
            return [f"A {label} requisition needs {need}."]
        ok = ", ".join(names[a] for a in allowed if a)
        return [f"A {label} requisition can't be charged to a {names.get(account_assignment, account_assignment)} — "
                f"charge it to: {ok}."]
    if purpose == "machine_project" and not (project_label or "").strip():
        return ["Pick the machine project this requisition is for."]
    return []


# ---------------------------------------------------------------- PO cost centre

@event.listens_for(P2PPurchaseOrder, "before_insert")
def _po_cost_center_from_pr(_mapper, connection, target: P2PPurchaseOrder) -> None:
    """Every way a PO is made (RFQ draft, quotation award, direct) starts it
    with a cost centre when its requisition is overhead: the PR's own one
    (older requisitions), else — for a department running cost — the
    requester's department's one active cost centre. Purchase can change it."""
    if target.cost_center_id is not None or not target.p2p_request_id or target.internal_order_id:
        return
    row = connection.execute(
        select(P2PRequest.cost_center_id, P2PRequest.purpose, P2PRequest.department)
        .where(P2PRequest.id == target.p2p_request_id)).first()
    if row is None:
        return
    if row[0]:
        target.cost_center_id = row[0]
    elif row[1] == "department" and (row[2] or "").strip():
        from app.modules.organization.models.cost_center import CostCenter
        from app.modules.organization.models.department import Department
        ids = connection.execute(
            select(CostCenter.id).join(Department, CostCenter.department_id == Department.id)
            .where(func.lower(Department.name) == row[2].strip().lower(), CostCenter.status == "active")).all()
        if len(ids) == 1:
            target.cost_center_id = ids[0][0]


def check_po_charge(db, pr: P2PRequest, po: P2PPurchaseOrder) -> None:
    """400 when a department running-cost PO goes for approval with no cost
    centre (an internal order also counts as a charge)."""
    if pr.purpose == "department" and not po.cost_center_id and not po.internal_order_id:
        raise HTTPException(status_code=400, detail=(
            f"PO '{po.po_number}' is for a department running cost ({pr.department or 'no department'}) but has no cost "
            "centre — pick the cost centre on the PO before sending it for approval. If the department has none, ask "
            "Finance to set one up in Organization › Cost centres."))


def check_cost_center(db, cost_center_id: int | None) -> None:
    """400 unless the cost centre exists and is active."""
    if not cost_center_id:
        return
    from app.modules.organization.models.cost_center import CostCenter
    cc = db.get(CostCenter, cost_center_id)
    if cc is None:
        raise HTTPException(status_code=400, detail="That cost centre doesn't exist — pick it again from the list.")
    if cc.status != "active":
        raise HTTPException(status_code=400, detail=f"Cost centre {cc.code} — {cc.name} is {cc.status} — pick an active one.")
