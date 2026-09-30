"""Static catalog of every module and its sub-nav sections, used to drive
the admin Permission Matrix UI. Mirrors each module's real *Nav.tsx
component — kept in sync by hand since there's no single source of truth
shared between frontend nav and backend registry.

Nothing in the app enforces `granular_permissions`/`data_access_scopes`
against routes yet (same situation as `User.erp_permissions` before it) —
this registry only defines what the admin UI can grant, not what's checked."""

ACTIONS = ["view", "create", "edit", "delete", "approve", "reject", "export", "print", "import"]

DATA_ACCESS_SCOPES = ["own", "department", "branch", "company", "all"]

MODULES: dict[str, dict] = {
    "organization": {
        "label": "Organization",
        "subtabs": {
            "info": "Info",
            "branches": "Branches",
            "department": "Department",
            "users": "Users",
            "roles": "Role & Permissions",
        },
    },
    "erp": {
        "label": "Service Module",
        "subtabs": {
            "dashboard": "Dashboard",
            "projects": "Projects",
            "service_requests": "Service Requests",
            "reports": "Reports",
            "recycle_bin": "Recycle Bin",
        },
    },
    "crm": {
        "label": "CRM Module",
        "subtabs": {
            "dashboard": "Dashboard",
            "organizations": "Organizations",
            "inquiries_tenders": "Inquiries & Tenders",
        },
    },
    "p2p": {
        "label": "Procurement",
        "subtabs": {
            "purchase_requisitions": "Purchase Requisitions",
            "pr_approval": "P.R Approval",
            "rfq": "R.F.Q",
            "po_approval": "P.O Approval",
            "grn": "G.R.N",
        },
    },
    "rnd": {
        "label": "R&D",
        "subtabs": {
            "dashboard": "Dashboard",
            "projects": "R&D Projects",
            "experiments": "Experiments & Tests",
            "prototypes": "Prototypes",
            "documents": "Documents",
            # "all" was the old calculator landing page — kept as the key
            # for the Engineering Tools tab so existing grants still apply.
            "all": "Engineering Tools",
            "braking": "Braking",
            "hydraulic": "Hydraulic",
            "qmax": "Qmax",
            "load_distribution": "Load Distribution",
            "tractive_effort": "Tractive Effort",
            "vehicle_performance": "Vehicle Performance",
            "spline": "Spline",
            "history": "History",
        },
    },
    "maintenance": {
        "label": "Maintenance",
        "subtabs": {
            "dashboard": "Dashboard",
            "assets": "Assets",
            "requests": "Requests",
            "work_orders": "Work Orders",
            "schedule": "PM Schedule",
            "spares": "Spares",
            "reports": "Maintenance Reports",
        },
    },
    "production": {
        "label": "Production",
        "subtabs": {
            "dashboard": "Dashboard",
            "rrv_builds": "RRV Builds",
            "work_orders": "Work Orders",
            "shop_floor": "Shop Floor",
            "planning": "Planning",
            "bom": "BOM & Routing",
            "workstations": "Workstations",
            "reports": "Production Reports",
        },
    },
    "design": {
        "label": "Design",
        "subtabs": {
            "dashboard": "Dashboard",
            "documents": "Documents",
            "tasks": "My Tasks",
            "change_notices": "Change Notices (ECN)",
            "reports": "Reports",
        },
    },
    "electrical": {
        "label": "Electrical",
        "subtabs": {
            "dashboard": "Dashboard",
            "jobs": "RRV Electrical Jobs",
            "drawings": "Drawings",
            "purchase": "Purchase Requirements",
            "testing": "Testing",
            "troubleshooting": "Troubleshooting",
        },
    },
    "hydraulic": {
        "label": "Hydraulic & Pneumatic",
        "subtabs": {
            "dashboard": "Dashboard",
            "systems": "Systems",
            "components": "Component Master",
            "circuits": "Circuits & Diagrams",
            "bom": "BOM",
            "calculations": "Calculations",
            "testing": "Testing & Inspection",
            "maintenance": "Maintenance Plans",
            "service_records": "Service Records",
            "spare_parts": "Spare Parts",
        },
    },
    "store": {"label": "Store", "subtabs": {}},
    "purchase": {"label": "Purchase", "subtabs": {}},
    "quality": {
        "label": "Quality",
        "subtabs": {
            "dashboard": "Dashboard",
            "standards": "Standards",
            "inspection_plans": "Inspection Plans",
            "incoming_inspection": "Incoming Inspection",
            "in_process_inspection": "In-Process Inspection",
            "final_inspection": "Final Inspection",
            "checklists": "Checklists",
            "ncr": "Non-Conformance (NCR)",
            "rejections": "Rejection Management",
            "capa": "Corrective & Preventive Actions",
            "complaints": "Customer Complaints",
            "supplier_quality": "Supplier Quality",
            "documents": "Quality Documents",
            "reports": "Quality Reports",
        },
    },
    "projects": {
        "label": "Project Management",
        "subtabs": {
            "dashboard": "Dashboard", "all_projects": "All Projects", "my_projects": "My Projects", "project_reports": "Project Reports",
            "overview": "Overview", "details_scope": "Details & Scope", "planning": "Planning", "tasks": "Tasks",
            "milestones": "Milestones", "budget_cost": "Budget & Cost", "resources": "Resources", "deliverables": "Deliverables",
            "documents": "Documents", "issues": "Issues", "risks": "Risks", "changes": "Changes", "activities": "Activities",
            "meetings": "Meetings & Communication", "approvals": "Approvals", "reports": "Reports",
            "project_history": "Project History", "closure": "Closure",
        },
    },
    "hr": {
        "label": "HR & Administration",
        "subtabs": {
            "dashboard": "Dashboard",
            "me": "My HR",
            "approvals": "Approvals",
            "employees": "Employees",
            "org_chart": "Org Chart",
            "lifecycle": "Lifecycle",
            "leave": "Leave",
            "attendance": "Attendance",
            "holidays": "Holidays",
            "assets": "Assets",
            "visitors": "Visitors",
            "travel": "Travel & Claims",
            "masters": "Masters",
        },
    },
}


def permission_id(module_key: str, subtab_key: str, action: str) -> str:
    return f"{module_key}:{subtab_key}:{action}"


def can_view_tab(user, module_key: str, subtab_key: str) -> bool:
    """True if `user` may view a given module's subtab under the Permission
    Matrix. Admins always pass. A user with zero matrix grants anywhere in
    `module_key` is unrestricted for it — the matrix is opt-in per module,
    so a user an admin never touched in the matrix keeps today's behavior
    (gated only by the module/app-access check, not by this)."""
    if user.role == "admin":
        return True
    grants = user.granular_permissions or []
    if not any(g.startswith(f"{module_key}:") for g in grants):
        return True
    return f"{module_key}:{subtab_key}:view" in grants



def can_perform(user, module_key: str, subtab_key: str, action: str) -> bool:
    """True if `user` may do `action` (create / edit / delete / approve …) in
    a module's subtab under the Permission Matrix. Same opt-in rule as
    can_view_tab: admins always pass, and a user with no matrix grants
    anywhere in `module_key` is unrestricted for it."""
    if user.role == "admin":
        return True
    grants = user.granular_permissions or []
    if not any(g.startswith(f"{module_key}:") for g in grants):
        return True
    return permission_id(module_key, subtab_key, action) in grants

def restricted_subtabs(user) -> dict[str, list[str]]:
    """module_key -> the subtab keys `user` may view, for every module where
    the admin has actually granted them at least one Permission Matrix entry.
    A module absent from this dict is unrestricted for `user` (see
    can_view_tab) — *Nav.tsx components show every one of their tabs in that
    case, same as before the matrix existed. Powers GET /auth/me's
    `tab_access` field."""
    if user.role == "admin":
        return {}
    grants = user.granular_permissions or []
    touched = {g.split(":", 1)[0] for g in grants if ":" in g}
    return {
        mk: sorted({g.split(":")[1] for g in grants if g.startswith(f"{mk}:") and g.endswith(":view")})
        for mk in touched if mk in MODULES
    }
