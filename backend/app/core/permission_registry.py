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
        "label": "Procure-to-Pay",
        "subtabs": {
            "purchase_requisitions": "Purchase Requisitions",
            "pr_approval": "P.R Approval",
            "rfq": "R.F.Q",
            "po_approval": "P.O Approval",
            "grn": "G.R.N",
        },
    },
    "rnd": {
        "label": "R&D Tools",
        "subtabs": {
            "all": "All",
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
}


def permission_id(module_key: str, subtab_key: str, action: str) -> str:
    return f"{module_key}:{subtab_key}:{action}"
