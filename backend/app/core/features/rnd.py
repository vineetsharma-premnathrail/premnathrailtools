"""R&D features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had.

Requirements: everything on a requirement page is gated by "view" on R&D ›
Requirements plus the record rules in rnd/services/requirement_access.py (R&D
head, task assignees outside R&D, Technical Offer team). A feature grant is an
extra role-level gate on top — both must pass. The features apply to R&D-side
users only: Design / Electrical / Hydraulic & Pneumatic people who work on a
requirement through a task only view and download it.

R&D rework 2026-10-30: Discussion, Access, Share Department and Milestones
are gone (their grants are dropped by the migration); `history` is the
Timeline; `review` (accept / return to BD) is new; the R&D Tasks tab has the
`analytics` feature."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features

register_features(
    "rnd", "requirements",
    # ── sections of the Requirement tab ──
    _feature("customer", "Customer & contact", "section", {"view": "view"},
             "The Customer block of a requirement: organization, type, city and the customer's contact person (name, phone, email)."),
    _feature("crm_info", "From CRM (commercial)", "section", {"view": "view"},
             "The 'From CRM' block — BD owner, CRM status, priority — and a tender's value."),
    _feature("product_requirement", "Product requirement", "section", {"view": "view"},
             "The Product Requirement / Tender Details block: product, quantity, delivery, specification and requirement text."),
    _feature("projects", "Linked projects", "section", {"view": "view"},
             "The Prototype / Research projects card on a requirement. Linking / unlinking stays with the R&D head."),
    _feature("crm_request", "CRM request & response", "section", {"view": "view", "submit": "view"},
             "The Technical Offer Request card (what CRM asked and when). Submit = respond to CRM (remarks / documents); the per-requirement Respond tick is still needed."),
    # ── sub-tabs ──
    _feature("tasks", "Tasks", "subtab", {
        "view": "view", "create": "view", "edit": "view", "approve": "view", "cancel": "view",
    }, "Tasks tab: see tasks, create tasks / sub-tasks (once the requirement is accepted), edit / reopen / tick tasks you review, decide approval requests and cancel tasks. Record rules stay: only whoever gave a task (or the R&D head) reviews it."),
    _feature("history", "Timeline", "subtab", {"view": "view"},
             "The Timeline tab of a requirement: revisions BD sent (with what changed), accept / return, responses, tasks, offers and documents in one list (R&D side only)."),
    # Explicit-only (None): never inherited and never given by a module preset — a role or a user's
    # extra permission must tick it. The R&D head and admins accept / return without it.
    _feature("review", "Review (accept / return to BD)", "action", {"view": "view", "approve": None, "reject": None},
             "Approve = accept a requirement (or a new revision of it) that BD sent; Reject = return it to BD with the reason to fix. "
             "The R&D head and admins can always do both; tick it for someone else on purpose."),
    _feature("technical_offers", "Technical Offers", "subtab", {
        "view": "view", "create": "view", "edit": "view", "delete": "view", "approve": "view",
    }, "Technical Offers sub-tab: see offers; create = upload a Word / PDF offer (Technical Offer team or the R&D head, once the requirement is accepted); edit its title / date / notes before release; delete a not-yet-released upload; approve = release the offer to the BD team (R&D head)."),
    # Explicit-only (None): never inherited and never given by a module preset —
    # a role or a user's extra permission must tick it. Replaces the hand-picked
    # "Can create / Can see Technical Offers" lists that lived in R&D › Settings.
    _feature("offer_team", "Technical Offer team (every requirement)", "action", {"view": None, "create": None},
             "View = see every requirement and its Technical Offers and download them, without being added to each requirement. "
             "Create = also upload a Technical Offer on any requirement. Releasing to BD stays with the R&D head. "
             "Not given by No access / View only / Contributor / Full access — tick it on purpose."),
    _feature("documents", "Documents", "subtab", {"view": "view", "create": "view", "export": "view"},
             "Documents sub-tab: list the requirement's files by category, upload (create, one category per file) and open / download (export)."),
)

register_features(
    "rnd", "projects",
    _feature("tasks", "Project tasks", "section", {
        "view": "view", "create": "view", "edit": "view", "approve": "view", "cancel": "view",
    }, "The Tasks board of a Prototype / Research project: see tasks, create tasks / sub-tasks, edit / reopen, decide approval requests and cancel. Record rules stay: project leads give tasks, the task's creator reviews it."),
    _feature("team", "Project lead & team", "section", {"view": "view"},
             "The Project Lead(s) and Team Members fields of a Prototype / Research project. Changing them still needs 'edit' on Prototype / Research; this row carries the role's 'Assign to' rule for those fields."),
)

register_features(
    "rnd", "experiments",
    _feature("conducted_by", "Conducted by", "section", {"view": "view"},
             "The 'Conducted by' field of an experiment / test — who runs it. Setting it still needs 'create' / 'edit' on Experiments & Tests; this row carries the role's 'Assign to' rule for that field."),
)

register_features(
    "rnd", "prototypes",
    _feature("release_production", "Release to Production", "action", {"view": "view", "approve": "approve"},
             "The Release to Production panel of a prototype: see its release status; approve = freeze the BOM and release it to Production."),
    _feature("costs", "BOM costs", "sensitive", {"view": "view"},
             "Prototype BOM unit / line costs and the BOM total (also on the project page). People with 'edit' on Prototypes always see them — they enter the costs."),
)

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("rnd", "requirements",
                 ("tasks", "Assign tasks to", "Who this role may give requirement tasks / sub-tasks to, or reassign them to."))
register_pickers("rnd", "projects",
                 ("tasks", "Assign tasks to", "Who this role may give project tasks / sub-tasks to, or reassign them to."))
register_pickers("rnd", "projects",
                 ("team", "Pick project lead & team","Who this role may make a project lead or team member when creating or editing a Prototype / Research project."))
register_pickers("rnd", "experiments",
                 ("conducted_by", "Assign experiment to", "Who this role may set as 'Conducted by' on an experiment / test (new or edited)."))

# R&D › R&D Tasks board. The tab is declared in core/permission_registry.py; the feature is registered
# only once it is (a feature on an undeclared tab would stop the app from importing).
from app.core.permission_registry import MODULES  # noqa: E402

if "tasks" in MODULES["rnd"]["actions"]:
    register_features(
        "rnd", "tasks",
        _feature("analytics", "All R&D tasks & analytics", "action", {"view": None},
                 "Without it a person sees only the R&D tasks assigned to or created by them. With it: every R&D task, and the summary / "
                 "by-person / by-project analytics over all of them. The R&D head and admins always see all. "
                 "Not given by presets — tick it on purpose."),
    )
