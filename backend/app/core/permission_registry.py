"""Catalog of every module, its tabs (and grouped sub-tabs) and the actions
each tab actually has — the single source of truth for the Role & Permission
matrix, route checks (core/permissions.py) and the frontend's `can()`.

A permission id is `module:tab:action` (e.g. "store:issues:approve"). Roles
(main/models/role.py) hold these ids — plus two wildcard forms,
`module:*:*` (every action on every tab) and `module:*:<action>` (that action
on every tab that has it) — so a "Store – Full Access" role keeps covering
tabs added later. A user's effective set is the union of their roles' grants
and their own extra grants (User.granular_permissions); see
User.effective_permissions.

Deny by default: a user may view a tab / do an action only when it is in
their effective set (admins always pass). A module counts as assigned to a
user (User.get_apps) when they can view at least one of its tabs.

Each tab lists only the actions that exist on it — a dashboard is view-only,
a document tab has create/edit/delete/approve…, so the matrix never offers a
box that does nothing. Keep tabs in sync with each module's *Nav.tsx
(`subtabKey`), and check any new triple with require_tab_action/can_perform
— backend/app/tests/test_permission_registry.py fails on an undeclared one."""

ACTIONS = ["view", "create", "edit", "delete", "submit", "approve", "reject", "cancel", "export", "print", "import"]

ACTION_LABELS = {
    "view": "View", "create": "Create", "edit": "Edit", "delete": "Delete", "submit": "Submit", "approve": "Approve",
    "reject": "Reject", "cancel": "Cancel", "export": "Export", "print": "Print", "import": "Import",
}

# Action bundles, in ACTIONS order.
V = ["view"]
VE = ["view", "edit"]
REPORT = ["view", "export", "print"]
SETTINGS = ["view", "edit"]
CRUD = ["view", "create", "edit", "delete"]
DOC = CRUD + ["export", "print"]
WORKFLOW = ["view", "create", "edit", "delete", "approve", "reject", "export", "print"]


def _with(base: list[str], *extra: str) -> list[str]:
    wanted = set(base) | set(extra)
    return [a for a in ACTIONS if a in wanted]


def _module(label: str, *tabs: tuple) -> dict:
    """Build a module entry from (key, label, actions[, group]) tuples.

    `subtabs` (key -> label) keeps the shape older callers read; `actions`
    and `groups` are the per-tab action list and optional parent-tab heading
    (a sub-tab row such as Finance › Masters › Ledgers)."""
    subtabs, actions, groups = {}, {}, {}
    for t in tabs:
        key, tab_label, tab_actions = t[0], t[1], t[2]
        subtabs[key] = tab_label
        actions[key] = [a for a in ACTIONS if a in tab_actions]
        if len(t) > 3 and t[3]:
            groups[key] = t[3]
    return {"label": label, "subtabs": subtabs, "actions": actions, "groups": groups}


MODULES: dict[str, dict] = {
    "organization": _module(
        "Organization",
        ("info", "Company Info", SETTINGS),
        ("branches", "Branches", CRUD),
        ("department", "Department", CRUD),
        ("users", "Users", ["view", "create", "edit"]),
        ("roles", "Role & Permissions", CRUD),
        ("workflows", "Approval Workflows", SETTINGS),
        ("delegations", "Delegations", CRUD),
        ("security", "Security & Sessions", SETTINGS),
        ("audit_logs", "Audit Logs", V),
        # Governance / Basis (main/routes/grc.py, basis.py, analytics.py)
        ("access_reviews", "Access Reviews", VE),  # edit = start / close a campaign, decide any line
        ("grc", "Access Risk (SoD)", VE),  # edit = record / withdraw a mitigation
        ("monitor", "System Monitor (jobs, errors, denied access)", VE),  # edit = re-run a job
        ("cockpit", "Management Cockpit", V),
    ),
    "erp": _module(
        "Service & Commissioning",
        ("dashboard", "Dashboard", V),
        ("projects", "Projects (Machines)", _with(DOC, "import")),
        ("service_requests", "Service Requests", _with(DOC, "import")),
        ("service_contracts", "Service Contracts (AMC / CMC)", _with(WORKFLOW, "submit", "cancel")),  # VA41: approval engine erp.service_contract
        ("reports", "Reports", REPORT),
        ("recycle_bin", "Recycle Bin", VE),  # edit = restore; items auto-purge after 10 days
        ("settings", "Settings", SETTINGS),
    ),
    "crm": _module(
        "CRM",
        ("dashboard", "Dashboard", V),
        ("organizations", "Customer Organizations", _with(CRUD, "export", "import")),
        ("inquiries_tenders", "Inquiries & Tenders", WORKFLOW),
        ("settings", "Settings", SETTINGS),
    ),
    "p2p": _module(
        "Procurement",
        ("purchase_requisitions", "Purchase Requisitions", _with(WORKFLOW, "submit", "cancel")),
        ("vendors", "Vendors", _with(CRUD, "export", "import")),
        ("rfq", "R.F.Q", WORKFLOW),
        ("purchase_orders", "Purchase Orders", _with(WORKFLOW, "submit", "cancel")),
        ("mis", "M.I.S Report", REPORT),
        # The buyer desk: works every PR (RFQs, POs, vendors). Granting it
        # gives the user the internal "purchase" app (User.get_apps) — there
        # is no separate Purchase Team module. Never granted by a wildcard.
        ("purchase_desk", "Purchase Desk (buyer — handles RFQs, POs and vendors for every PR)", V),
        ("settings", "Settings", SETTINGS),
    ),
    "rnd": _module(
        "R&D",
        ("dashboard", "Dashboard", V),
        ("project_work", "Ongoing Projects", VE),
        ("requirements", "Requirements", ["view", "create", "edit"]),  # no delete endpoint
        ("projects", "Prototype / Research", _with(CRUD, "approve")),
        ("experiments", "Experiments & Tests", CRUD),
        ("prototypes", "Prototypes", _with(CRUD, "approve")),
        ("documents", "Documents", CRUD),
        # "all" was the old calculator landing page — kept as the key for the
        # Engineering Tools tab so existing grants still apply.
        ("all", "Engineering Tools (landing)", V, "Engineering Tools"),
        ("braking", "Braking", ["view", "create", "print"], "Engineering Tools"),
        ("hydraulic", "Hydraulic", ["view", "create", "print"], "Engineering Tools"),
        ("qmax", "Qmax", ["view", "create", "print"], "Engineering Tools"),
        ("load_distribution", "Load Distribution", ["view", "create", "print"], "Engineering Tools"),
        ("tractive_effort", "Tractive Effort", ["view", "create", "print"], "Engineering Tools"),
        ("vehicle_performance", "Vehicle Performance", ["view", "create", "print"], "Engineering Tools"),
        ("spline", "Spline", ["view", "create", "print"], "Engineering Tools"),
        ("history", "Calculation History", ["view", "delete", "export"], "Engineering Tools"),
    ),
    "design": _module(
        "Design",
        ("dashboard", "Dashboard", V),
        ("ongoing_projects", "Ongoing Projects", VE),
        ("requirements", "Requirements (from R&D)", VE),  # edit = send the feasibility reply
        ("project_work", "Requests", WORKFLOW),
        ("tasks", "My Work", VE),
        ("documents", "Drawings", _with(DOC, "submit", "approve", "cancel")),
        ("boms", "BOMs", _with(DOC, "submit", "approve", "cancel")),
        ("reviews", "Reviews & Approvals", ["view", "approve", "reject"]),
        ("change_notices", "Changes (ECR / ECN)", _with(WORKFLOW, "submit", "cancel")),
        ("library", "Library", CRUD),
        ("reports", "Reports", REPORT),
        ("settings", "Settings", SETTINGS),
    ),
    "electrical": _module(
        "Electrical",
        ("dashboard", "Dashboard", V),
        ("project_work", "Ongoing Projects", VE),
        ("requirements", "Requirements (from R&D)", VE),  # edit = send the feasibility reply
        ("jobs", "RRV Electrical Jobs", _with(CRUD, "submit", "approve", "cancel", "print")),
        ("drawings", "Drawings", _with(CRUD, "approve")),
        ("purchase", "Purchase Requirements", CRUD),
        ("testing", "Testing", _with(CRUD, "print")),
        ("troubleshooting", "Troubleshooting", CRUD),
    ),
    "hydraulic": _module(
        "Hydraulic & Pneumatic",
        ("dashboard", "Dashboard", V),
        ("project_work", "Ongoing Projects", VE),
        ("requirements", "Requirements (from R&D)", VE),  # edit = send the feasibility reply
        ("systems", "Systems", CRUD),
        ("components", "Component Master", _with(CRUD, "export", "import")),
        ("circuits", "Circuits & Diagrams", _with(CRUD, "approve")),
        ("bom", "BOM", _with(CRUD, "submit", "approve", "cancel", "export")),
        ("calculations", "Calculations", CRUD),
        ("testing", "Testing & Inspection", _with(CRUD, "submit", "approve", "cancel", "print")),
    ),
    "maintenance": _module(
        "Maintenance",
        ("dashboard", "Dashboard", V),
        ("project_work", "Ongoing Projects", VE),
        ("requests", "Requests", ["view", "create", "edit"]),  # no delete endpoint
        ("work_orders", "Work Orders", [a for a in WORKFLOW if a != "delete"]),  # no delete endpoint
        ("assets", "Assets / AMC & Warranty", _with(CRUD, "export", "import")),
        ("schedule", "PM Schedule", CRUD),
        ("spares", "Spares", _with(CRUD, "export")),
        ("reports", "Maintenance Reports", REPORT),
        ("settings", "Settings", SETTINGS),
    ),
    "production": _module(
        "Production",
        ("dashboard", "Dashboard", V),
        ("project_work", "Ongoing Projects", VE),
        ("rrv_builds", "RRV Builds", WORKFLOW),
        ("work_orders", "Work Orders", WORKFLOW),
        ("shop_floor", "Shop Floor", CRUD),
        ("planning", "Planning", ["view", "create", "edit"]),
        ("bom", "BOM & Routing", _with(DOC, "approve")),
        ("workstations", "Workstations", CRUD),
        ("reports", "Production Reports", REPORT),
    ),
    "store": _module(
        "Store",
        ("items", "Items", _with(CRUD, "export", "import")),
        ("stock", "Stock", ["view", "export", "print"]),
        # Racks / shelves / bins inside a store — kept by the store team itself,
        # not a Settings master (a store re-slots as it fills up).
        ("bins", "Bins (rack / shelf / bin)", CRUD),
        ("movements", "Movements", ["view", "export", "print"]),
        # Issues post at once — no approval, so no approve/reject action.
        ("issues", "Issues", ["view", "create", "edit", "delete", "export", "print"]),
        ("reservations", "Reservations", CRUD),
        ("adjustments", "Adjustments", WORKFLOW),
        ("returns", "Returns", WORKFLOW),
        ("transfers", "Transfers", WORKFLOW),
        ("grn", "GRN & Inspection", WORKFLOW),
        ("project_work", "Ongoing Projects", VE),
        ("settings", "General settings", SETTINGS, "Settings"),
        ("item_types", "Item Types", CRUD, "Settings"),
        ("uoms", "Units of Measure", CRUD, "Settings"),
        ("categories", "Categories", CRUD, "Settings"),
        ("warehouses", "Stores (locations)", CRUD, "Settings"),
        ("entry_types", "Stock Entry Types", CRUD, "Settings"),
        ("issue_types", "Issue Types", CRUD, "Settings"),
        ("issue_rules", "Issue Rules", CRUD, "Settings"),
        # Plant Access moved to the central data scope (Organization › Role & Permissions).
    ),
    "quality": _module(
        "Quality",
        ("dashboard", "Dashboard", V),
        ("project_work", "Ongoing Projects", VE),
        ("my_inspections", "My Inspections", VE),
        ("inspection_lots", "Inspection Lots", _with(CRUD, "approve", "print")),
        ("ncr", "Non-Conformance (NCR)", WORKFLOW),
        ("inspection_plans", "Inspection Plans", _with(CRUD, "submit", "approve", "cancel")),  # submit/cancel: approval engine
        ("masters", "Masters (Characteristics, Defects, Dispositions, Sampling)", ["view", "create", "edit"]),  # no delete endpoint
        ("in_process_inspection", "In-process (Operation Gate) Inspections", _with(CRUD, "approve")),
        ("final_inspection", "RRV Final Inspections", _with(CRUD, "approve", "print")),
        ("first_article", "First Article Inspection (FAI)", ["view", "create", "edit", "approve", "print"]),  # no delete endpoint
        ("inspection_calls", "Customer / Third-party Inspection Calls", ["view", "create", "edit", "approve", "print"]),  # no delete endpoint
        ("standards", "Standards", CRUD),
        ("capa", "Corrective & Preventive Actions", ["view", "create", "edit", "approve"]),  # no delete endpoint
        ("complaints", "Customer Complaints", ["view", "create", "edit", "approve"]),  # no delete endpoint
        ("supplier_quality", "Supplier Quality", ["view", "create", "edit", "approve"]),  # no delete endpoint
        ("documents", "Quality Documents", CRUD),
        ("reports", "Quality Reports", REPORT),
        ("settings", "Quality Settings", SETTINGS),
    ),
    "projects": _module(
        "Project Management",
        ("dashboard", "Dashboard", V),
        ("all_projects", "All Projects", _with(CRUD, "export")),
        ("department_board", "Department Board", V),
        ("department_work", "Department Work", VE),
        ("my_tasks", "My Tasks", VE),
        ("overview", "Overview", VE, "Project workspace"),
        ("milestones", "WBS", CRUD, "Project workspace"),
        ("documents", "Documents", CRUD, "Project workspace"),
        ("project_history", "History", V, "Project workspace"),
    ),
    "sales": _module(
        "Sales",
        ("dashboard", "Dashboard", V),
        ("orders", "Sales Orders", _with(WORKFLOW, "submit", "cancel")),  # submit/cancel: approval engine (orders + amendments)
        ("delivery", "Delivery", ["view", "create", "edit", "approve", "print"]),  # no delete endpoint
        ("order_projects", "Order Projects", VE),  # OP-YYYY-NNN execution projects; edit = project manager / hold / dates
        # Product Management (finished-product master) lives inside Sales; its
        # tabs give the internal "products" app (User.get_apps). The retired
        # "products" module's grants (products:*) alias to these.
        ("products", "Products", CRUD, "Products"),
        ("applications", "Applications", _with(V, "create", "edit"), "Products"),
        ("product_mapping", "Product Mapping", VE, "Products"),  # legacy crm_products / free-text product → product master
        ("pricing", "Pricing", CRUD),  # VK11 price / discount / freight conditions (products/pricing.py)
        ("reports", "Sales Reports", REPORT),
        ("settings", "Settings", SETTINGS),
    ),
    "accounts": _module(
        "Finance & Accounting",
        ("company_fy", "Company & FY", SETTINGS, "Masters"),
        ("account_groups", "Account Groups", CRUD, "Masters"),
        ("ledgers", "Ledgers", _with(CRUD, "export", "import"), "Masters"),
        ("ledger_settings", "Ledger Settings", SETTINGS, "Masters"),
        ("gst_rates", "GST Rates", CRUD, "Masters"),
        ("bank_cash_accounts", "Bank & Cash Accounts", CRUD, "Masters"),
        ("vendors", "Vendors", _with(CRUD, "export", "import"), "Masters"),
        ("internal_orders", "Internal Orders", CRUD, "Masters"),
        ("opening_balances", "Opening Balances", ["view", "edit", "import"], "Masters"),
        ("settings", "Finance Settings", SETTINGS, "Masters"),
        ("currencies", "Currencies & FX", ["view", "create", "edit", "approve", "export"], "Masters"),  # approve = month-end revaluation
        ("journal_vouchers", "Journal Vouchers", _with(WORKFLOW, "submit", "cancel"), "Journals"),
        ("day_book", "Day Book", REPORT, "Journals"),
        ("ledger_statement", "Ledger Statement", REPORT, "Journals"),
        ("period_close", "Period Close", ["view", "edit", "approve"], "Journals"),
        ("purchase_invoices", "Purchase Invoices", _with(WORKFLOW, "submit", "cancel"), "Purchase"),
        ("debit_notes", "Debit Notes", _with(WORKFLOW, "submit", "cancel"), "Purchase"),
        ("sales_invoices", "Sales Invoices", _with(WORKFLOW, "submit", "cancel"), "Sales"),
        ("credit_notes", "Credit Notes", _with(WORKFLOW, "submit", "cancel"), "Sales"),
        ("payments", "Payments & Receipts", WORKFLOW, "Payments"),
        ("payment_runs", "Payment Runs (proposals)", _with(WORKFLOW, "submit", "cancel"), "Payments"),
        ("bank_book", "Bank / Cash Book", REPORT, "Bank & Cash"),
        ("reconciliation", "Reconciliation (BRS)", ["view", "create", "edit", "delete", "export"], "Bank & Cash"),
        ("liquidity", "Liquidity Forecast", _with(REPORT, "create", "edit", "delete"), "Bank & Cash"),  # create/edit/delete = planned cash items
        ("guarantees", "Bank Guarantees, LC & EMD", _with(WORKFLOW, "submit", "cancel"), "Bank & Cash"),
        ("gst", "GST Registers & Returns", ["view", "edit", "export", "print"], "GST"),
        ("outstanding", "Receivables & Payables", REPORT, "Outstanding"),
        ("collections", "Collections & Dunning", ["view", "create", "edit", "export", "print"], "Outstanding"),
        ("disputes", "Disputes", ["view", "create", "edit", "export"], "Outstanding"),
        ("credit_management", "Credit Management", ["view", "approve", "export"], "Outstanding"),  # approve = release a credit block
        ("inventory", "Stock Value & Closing Stock", ["view", "edit", "export", "print"], "Inventory"),
        ("fixed_assets", "Asset Register", _with(CRUD, "export"), "Assets"),
        ("depreciation", "Depreciation", ["view", "approve", "export"], "Assets"),  # run & reverse = approve
        ("tax_depreciation", "Tax Depreciation & Deferred Tax", ["view", "edit", "export"], "Assets"),
        ("financial_reports", "Financial Reports", REPORT, "Reports"),
        ("year_end_close", "Year-end Close", ["view", "approve"], "Reports"),
        # CO product costing (CK11N/CK24: approve = release to standard price), profit centres (KE51/KE5Z), CO-PA (KE30).
        ("product_costing", "Product Costing (cost estimates)", _with(DOC, "approve"), "Controlling"),
        ("profit_centers", "Profit Centres", CRUD, "Controlling"),
        ("profitability", "Profitability", REPORT, "Controlling"),
        # CO (Finance › Controlling). approve = lock a plan / post or reverse a run.
        ("co_planning", "Cost Centre Planning", _with(CRUD, "approve", "export", "import"), "Controlling"),
        ("activity_rates", "Activity Types & Rates", CRUD, "Controlling"),
        ("allocations", "Assessment & Distribution", _with(CRUD, "approve"), "Controlling"),
        ("overhead", "Overhead (Costing Sheet)", _with(CRUD, "approve"), "Controlling"),
    ),
    "hr": _module(
        "HR & Administration",
        ("dashboard", "Dashboard", V),
        ("me", "My HR (self-service)", ["view", "create", "edit"]),
        ("approvals", "Approvals", ["view", "approve", "reject"]),
        ("employees", "Employees", CRUD),
        ("org_chart", "Org Chart", V),
        ("lifecycle", "Lifecycle", _with(CRUD, "approve")),
        ("leave", "Leave", _with(CRUD, "approve", "reject", "export")),
        ("attendance", "Attendance", _with(CRUD, "export", "import")),
        ("holidays", "Holidays", CRUD),
        ("assets", "Assets", CRUD),
        ("visitors", "Visitors", CRUD),
        ("travel", "Travel & Claims", _with(CRUD, "approve", "reject")),
        ("safety", "Safety (EHS incidents)", _with(CRUD, "approve", "export", "print")),
        ("reports", "Statutory registers & reports", REPORT),
        ("masters", "Masters", CRUD),
        ("settings", "Settings", SETTINGS),
    ),
}

# ── Features: the third level under a tab ────────────────────────────────────
# A tab is a nav page; a feature is something INSIDE it a role may or may not
# get — a record-detail sub-tab (Inquiry › Quotations), a page section
# (Requirement › Customer & commercial), a specific action (Send TOR to R&D) or
# a sensitive switch (view prices / costs / margins). Its id is
# `module:tab.feature:action`, e.g. "crm:inquiries_tenders.quotations:create".
#
# Popups need no entry of their own: a popup opens from an action, so the
# action's feature grant gates it.
#
# Keep current access: each feature action names the TAB action that guarded
# it before features existed (`inherit`). Until a role is customised for that
# tab — it holds at least one `module:tab.<feature>:…` id — the feature
# follows the tab: a role with inquiries_tenders:edit still creates quotations.
# Once customised, only the role's explicit feature ids count for that tab
# (deny by default). Inheritance is worked out per role / per grant list, so
# customising one role never changes what another role inherits.

FEATURE_KINDS = {
    "subtab": "Sub-tab",            # a tab inside a record page
    "section": "Section",           # a block of a page / record
    "action": "Action",             # one specific button / operation
    "sensitive": "Sensitive data",  # prices, costs, margins …
}


def _feature(key: str, label: str, kind: str, inherit: dict[str, str], hint: str = "") -> tuple:
    """(key, label, kind, {feature action: tab action it inherits from}, hint)."""
    assert kind in FEATURE_KINDS, kind
    assert set(inherit) <= set(ACTIONS), (key, inherit)
    return (key, label, kind, inherit, hint)


# module -> tab -> features. Every feature has "view"; the inherited tab action
# must exist on the tab (test_permission_registry checks both).
FEATURES: dict[str, dict[str, list[tuple]]] = {}


def _attach_features() -> None:
    for mk, m in MODULES.items():
        m["features"] = {}
        m["feature_kinds"] = FEATURE_KINDS
    for mk, tabs in FEATURES.items():
        for tk, feats in tabs.items():
            assert tk in MODULES[mk]["actions"], f"{mk}:{tk} is not a tab"
            out = {}
            for key, label, kind, inherit, hint in feats:
                out[key] = {
                    "label": label, "kind": kind, "hint": hint,
                    "actions": [a for a in ACTIONS if a in inherit],
                    "inherit": dict(inherit),
                }
            MODULES[mk]["features"][tk] = out


_attach_features()


def register_features(module_key: str, tab_key: str, *features: tuple) -> None:
    """Declare the features of one tab (call at import time, below)."""
    FEATURES.setdefault(module_key, {})[tab_key] = list(features)
    _attach_features()


# Modules that are portal apps (User.get_apps); organization is the admin area.
NON_APP_MODULES = {"organization"}

# Procurement › Purchase Desk is the buyer authority (it gives the internal
# "purchase" app); the old "Purchase Team" module's grants (purchase:*) alias
# to it. A module wildcard (p2p:*:*) never grants it — only an explicit tick.
PURCHASE_DESK_GRANT = "p2p:purchase_desk:view"
EXPLICIT_ONLY_TABS = {("p2p", "purchase_desk")}

# Sales › Products / Applications / Product Mapping: Product Management sits
# inside Sales. Viewing one of them gives the internal "products" app; only
# the other Sales tabs give the "sales" app (User.get_apps).
PRODUCT_TABS = {"products", "applications", "product_mapping"}

# Grants that, before roles existed, needed an explicit grant even when the
# opt-in matrix left a user unrestricted (approver / head / settings-editor
# authority). The access-preserving migration leaves these out of the
# "Standard access (migrated)" roles so nobody silently became a Quality head,
# settings editor or approver; admins grant them through a role on purpose.
AUTHORITY_GRANTS = {
    *(f"{mk}:settings:edit" for mk, m in MODULES.items() if "settings" in m["subtabs"]),
    "quality:ncr:approve", "quality:ncr:edit", "quality:inspection_lots:approve",
    "quality:first_article:approve", "quality:inspection_calls:edit", "quality:inspection_plans:approve",
    "quality:capa:approve", "quality:capa:edit", "quality:complaints:approve", "quality:supplier_quality:approve",
    "projects:all_projects:create",
}


def permission_id(module_key: str, subtab_key: str, action: str) -> str:
    return f"{module_key}:{subtab_key}:{action}"


def feature_id(module_key: str, tab_key: str, feature_key: str, action: str) -> str:
    return f"{module_key}:{tab_key}.{feature_key}:{action}"


def _feature_ids(mk: str) -> set[str]:
    return {
        feature_id(mk, tk, fk, a)
        for tk, feats in MODULES[mk].get("features", {}).items()
        for fk, f in feats.items()
        for a in f["actions"]
    }


def all_permission_ids() -> set[str]:
    """Every concrete id the registry declares (tab and feature ids)."""
    ids = {
        permission_id(mk, tk, a)
        for mk, m in MODULES.items()
        for tk, acts in m["actions"].items()
        for a in acts
    }
    for mk in MODULES:
        ids |= _feature_ids(mk)
    return ids


def _feature_spec(mk: str, tk: str) -> dict | None:
    """The feature entry for a `tab.feature` key, or None."""
    tab, _, fk = tk.partition(".")
    return MODULES[mk].get("features", {}).get(tab, {}).get(fk) if fk else None


def is_valid_grant(grant: str) -> bool:
    """A concrete id the registry declares, or a module wildcard
    (`module:*:*` / `module:*:<action>`)."""
    parts = grant.split(":")
    if len(parts) != 3:
        return False
    mk, tk, a = parts
    module = MODULES.get(mk)
    if not module:
        return False
    if tk == "*":
        return a == "*" or a in ACTIONS
    if "." in tk:
        tab, _, fk = tk.partition(".")
        if fk == "*":
            # `module:tab.*:none` — the role was customised for this tab and
            # holds none of its features (so they stop following the tab).
            return a == "none" and bool(module.get("features", {}).get(tab))
        spec = _feature_spec(mk, tk)
        return bool(spec) and a in spec["actions"]
    return a in module["actions"].get(tk, [])


def legacy_grant_aliases(grant: str) -> list[str]:
    """Current ids for a grant of a retired module: Purchase Team (purchase:*)
    → Procurement › Purchase Desk; Product Management (products:*) → the
    Sales › Products tabs (a products wildcard covers only those tabs, never
    the rest of Sales). Any other grant is returned unchanged."""
    if grant.startswith("purchase:"):
        return [PURCHASE_DESK_GRANT]
    if grant.startswith("products:"):
        parts = grant.split(":")
        if len(parts) != 3:
            return []
        _, tk, a = parts
        if tk != "*":
            return [f"sales:{tk}:{a}"]
        acts = MODULES["sales"]["actions"]
        return [f"sales:{t}:{x}" for t in sorted(PRODUCT_TABS) for x in acts.get(t, []) if a in ("*", x)]
    return [grant]


def expand_grants(grants) -> set[str]:
    """Concrete ids for ONE grant list (a role's, or a user's extra grants),
    wildcards expanded against the current registry; unknown ids (a retired
    tab) are dropped. Any action on a tab implies viewing it (no "edit without
    view"); any action on a feature implies viewing the feature and its tab.

    Features of a tab the list has no explicit feature id for inherit from
    the tab (see FEATURES above). Expand each role separately and union the
    results (expand_grant_sources) — never expand a merged list, or one
    role's customisation would switch off another role's inheritance."""
    out: set[str] = set()
    customised: set[tuple[str, str]] = set()
    for g in [n for g in grants or [] for n in legacy_grant_aliases(g)]:
        parts = g.split(":")
        if len(parts) != 3:
            continue
        mk, tk, a = parts
        module = MODULES.get(mk)
        if not module:
            continue
        if tk == "*":
            for tab, acts in module["actions"].items():
                if (mk, tab) in EXPLICIT_ONLY_TABS:
                    continue
                out.update(permission_id(mk, tab, x) for x in acts if a == "*" or x == a)
            for tab, feats in module.get("features", {}).items():
                for fk, f in feats.items():
                    out.update(feature_id(mk, tab, fk, x) for x in f["actions"] if a == "*" or x == a)
        elif "." in tk:
            tab = tk.split(".", 1)[0]
            customised.add((mk, tab))
            spec = _feature_spec(mk, tk)
            if spec and a in spec["actions"]:
                out.add(g)
                out.add(f"{mk}:{tk}:view")
                out.add(permission_id(mk, tab, "view"))
        elif a in module["actions"].get(tk, []):
            out.add(g)
            out.add(permission_id(mk, tk, "view"))
    # Inherit: an uncustomised tab's features follow the tab's own actions.
    for mk, module in MODULES.items():
        for tab, feats in module.get("features", {}).items():
            if (mk, tab) in customised or permission_id(mk, tab, "view") not in out:
                continue
            for fk, f in feats.items():
                for a, legacy in f["inherit"].items():
                    if permission_id(mk, tab, legacy) in out:
                        out.add(feature_id(mk, tab, fk, a))
                        out.add(feature_id(mk, tab, fk, "view"))
    return out


def expand_grant_sources(*sources) -> set[str]:
    """Union of expand_grants over several grant lists (each role, the user's
    extra grants) — inheritance is decided per list."""
    out: set[str] = set()
    for src in sources:
        out |= expand_grants(src)
    return out


def _grants_of(user) -> set[str]:
    eff = getattr(user, "effective_permissions", None)
    return eff if eff is not None else expand_grants(getattr(user, "granular_permissions", None))


def is_admin_user(user) -> bool:
    return user is not None and (user.role == "admin" or bool(getattr(user, "is_azure_admin", False)))


def has_grant(user, grant: str) -> bool:
    """True if `user` holds this exact `module:tab:action` id (admins always)."""
    if user is None:
        return False
    return is_admin_user(user) or grant in _grants_of(user)


def can_view_tab(user, module_key: str, subtab_key: str) -> bool:
    """True if `user` may view a module's tab. Deny by default: only an
    explicit (role or extra) `view` grant opens it; admins always pass."""
    return has_grant(user, permission_id(module_key, subtab_key, "view"))


def can_perform(user, module_key: str, subtab_key: str, action: str) -> bool:
    """True if `user` may do `action` (create / edit / delete / approve …) on
    a module's tab. Deny by default; admins always pass."""
    return has_grant(user, permission_id(module_key, subtab_key, action))


def can_feature(user, module_key: str, tab_key: str, feature_key: str, action: str) -> bool:
    """True if `user` may do `action` on a feature of a tab (Inquiry ›
    Quotations › Create). Deny by default; admins always pass. An undeclared
    feature / action is a coding mistake (it would deny everyone but admins)
    and is logged loudly."""
    spec = MODULES.get(module_key, {}).get("features", {}).get(tab_key, {}).get(feature_key)
    if not spec or action not in spec["actions"]:
        import logging
        logging.getLogger(__name__).error(
            "Permission check on undeclared feature %s — declare it in app/core/features/%s.py",
            feature_id(module_key, tab_key, feature_key, action), module_key)
    return has_grant(user, feature_id(module_key, tab_key, feature_key, action))


def can_access_module(user, module_key: str) -> bool:
    """True if `user` can view at least one tab of `module_key`."""
    if is_admin_user(user):
        return True
    prefix = f"{module_key}:"
    return any(g.startswith(prefix) and g.endswith(":view") for g in _grants_of(user))


def restricted_subtabs(user) -> dict[str, list[str]]:
    """module_key -> the tab keys `user` may view, for EVERY module (an empty
    list means no tab). Admins get {} — the frontend treats a missing module
    as unrestricted only for them. Powers GET /auth/me's `tab_access`."""
    if is_admin_user(user):
        return {}
    grants = _grants_of(user)
    return {
        mk: sorted(tk for tk in m["subtabs"] if permission_id(mk, tk, "view") in grants)
        for mk, m in MODULES.items()
    }


def legacy_erp_permissions(user) -> list[str]:
    """The old ERP ids (project_view, sr_delete …) `user` effectively holds,
    for frontend code that still checks User.erp_permissions."""
    return [
        f"{prefix}_{action}"
        for prefix, tab in (("project", "projects"), ("sr", "service_requests"))
        for action in ("view", "create", "edit", "delete")
        if can_perform(user, "erp", tab, action)
    ]


# Tab keys renamed/merged when the registry was rebuilt with roles.
LEGACY_GRANT_RENAMES = {
    "p2p:po_approval:": "p2p:purchase_orders:",
    "p2p:pr_approval:view": "p2p:purchase_requisitions:view",
    "p2p:pr_approval:approve": "p2p:purchase_requisitions:approve",
    "p2p:pr_approval:reject": "p2p:purchase_requisitions:reject",
}
_ERP_LEGACY_TABS = {"project": "projects", "sr": "service_requests"}


def _rename_legacy(grant: str) -> str:
    for old, new in LEGACY_GRANT_RENAMES.items():
        if grant.startswith(old):
            return new + grant[len(old):]
    return grant


def standard_module_grants(module_key: str) -> set[str]:
    """Every grant of a module except AUTHORITY_GRANTS — what a user of it
    could do before roles, when the matrix was opt-in."""
    return {g for g in expand_grants([f"{module_key}:*:*"]) - AUTHORITY_GRANTS if not g.endswith(":settings:edit")}


def legacy_access(apps, erp_permissions, grants) -> tuple[list[str], list[str]]:
    """Translate pre-roles access (assigned_apps + opt-in matrix grants +
    erp_permissions) into (extra grants to keep, modules that get the
    "Standard access (migrated)" role). Used by the c4e8a1f3b7d2 migration;
    see its docstring for the rules."""
    old = [_rename_legacy(g) for g in (grants or [])]
    legacy_erp = set(erp_permissions or [])
    keep: set[str] = set()
    standard: list[str] = []
    for mk in sorted(set(apps or [])):
        if mk not in MODULES or mk in NON_APP_MODULES:
            continue
        mine = {g for g in old if g.startswith(f"{mk}:") and is_valid_grant(g)}
        if mk == "erp":
            base = mine or standard_module_grants("erp")
            for g in base:
                _, tab, action = g.split(":")
                prefix = next((p for p, t in _ERP_LEGACY_TABS.items() if t == tab), None)
                if not mine and prefix and action in ("create", "edit", "delete") and f"{prefix}_{action}" not in legacy_erp:
                    continue
                keep.add(g)
            if mine:
                for legacy in legacy_erp:
                    prefix, _, action = legacy.partition("_")
                    tab = _ERP_LEGACY_TABS.get(prefix)
                    if tab and action in ("create", "edit", "delete") and f"erp:{tab}:view" in mine:
                        keep.add(f"erp:{tab}:{action}")
        elif mine:
            keep |= mine
        else:
            standard.append(mk)
    if "purchase" in (apps or []):
        # The purchase team worked every PR (RFQ, PO) and booked/inspected GRNs
        # (GRN now sits under Store › GRN & Inspection).
        if "p2p" not in apps:
            standard.append("p2p")
        keep |= {PURCHASE_DESK_GRANT, "store:grn:view", "store:grn:create", "store:grn:approve"}
    return sorted(keep), standard


# Before roles, anyone named as a PR/PO approver (Settings or per-PR) or
# holding a PO-approval flag could open and decide those requisitions without
# the Procurement app. The migration gives them this role so they still can.
P2P_APPROVER_ROLE = ("Procurement – Approver", ["p2p:purchase_requisitions:view", "p2p:purchase_orders:view"])


MIGRATED_ROLE_SUFFIX = "Standard access (migrated)"


def holds_deliberately(user, grant: str) -> bool:
    """True if `user` holds `grant` through their extra grants or a role other
    than the blanket "<Module> – Standard access (migrated)" ones. For
    notification fan-outs ("who reviews circuits?"): the migrated roles carry
    every routine action of a module for everyone who used it before roles,
    so they say nothing about who is actually the reviewer."""
    if grant in expand_grants(getattr(user, "granular_permissions", None)):
        return True
    return any(
        r.is_active and not r.name.endswith(MIGRATED_ROLE_SUFFIX) and grant in expand_grants(r.permissions)
        for r in getattr(user, "roles", None) or []
    )


# Per-module feature declarations (app/core/features/<module>.py) — one file
# per module so modules can be extended independently.
from app.core import features as _features  # noqa: E402,F401
