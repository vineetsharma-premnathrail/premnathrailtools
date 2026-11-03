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
    # The R&D Settings gear (next to the bell) used to ride silently on Requirements › view.
    _feature("settings", "R&D Settings (gear)", "subtab", {"view": "view"},
             "The R&D Settings page behind the gear next to the bell: who heads R&D and where the Technical Offer team is given. Read-only."),
)

register_features(
    "rnd", "projects",
    _feature("tasks", "Project tasks", "subtab", {
        "view": "view", "create": "view", "edit": "view", "approve": "view", "cancel": "view",
    }, "The Tasks board of a Prototype / Research project: see tasks, create tasks / sub-tasks, edit / reopen, decide approval requests and cancel. Record rules stay: project leads give tasks, the task's creator reviews it."),
    _feature("team", "Project lead & team", "picker", {"view": "view"},
             "Only carries the role's 'Assign to' rule for the Project Lead(s) and Team Members pickers of a Prototype / Research project. Changing them still needs 'edit' on Prototype / Research."),
)

register_features(
    "rnd", "experiments",
    _feature("conducted_by", "Conducted by", "picker", {"view": "view"},
             "Only carries the role's 'Assign to' rule for the 'Conducted by' picker of an experiment / test. Setting it still needs 'create' / 'edit' on Experiments & Tests."),
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

# UI visibility per role (core/visibility.py): what a member of a role sees on the
# Requirements list, the New / Edit Prototype-Research project form, the project page and
# the projects list, and on the R&D Tasks › Create Task form. Coded values come from the
# model / core constants (never retyped); a value a role does not allow is also refused by
# the server (routes/projects.py, routes/tasks.py). The calculator tool pages are not part
# of this (owner rule: untouchable). BOM / budget money stays behind the "BOM costs" switch.
from app.core.priority import PRIORITY_LABELS  # noqa: E402
from app.core.visibility import register_visibility  # noqa: E402
from app.modules.rnd.models.project import RND_IMPROVEMENT_REASON_LABELS, RND_ORIGIN_LABELS  # noqa: E402

register_visibility(
    "rnd", "requirements",
    label="Requirements — list",
    screens=(("list", "Requirements list"),),
    tables=(
        ("requirements", "Requirements list",
         {"revision": "Revision", "source": "Source", "customer": "Customer", "product": "Product / Tender",
          "rnd_response": "R&D Response", "bd_owner": "BD Owner", "last_received": "Last Received"}, "list"),
    ),
)

register_visibility(
    "rnd", "projects",
    label="Prototype / Research — form, page & list",
    screens=(("form", "New Project form"), ("detail", "Project page"), ("list", "Projects list")),
    sections=(
        # New / Edit project form (dashboard/rnd/projects/new, the project page's Edit)
        ("origin", "Project Origin", "Why the project exists: Existing Projects or New Project, with its source / reason / note.", True, "form"),
        ("initiation", "Project Initiation", "Title, objective and scope.", True, "form"),
        ("priority_schedule", "Priority & Schedule", "Priority, start date and target end date.", False, "form"),
        ("budget", "Budget", "A Finance budget to link, or a typed amount.", False, "form"),
        ("members", "Project Members", "Project leads and team members.", False, "form"),
        ("remarks", "Remarks", "Free-text remarks on the project.", False, "form"),
        ("attachments", "Attachments",
         "Files uploaded with the project. A New Project origin needs a proof document here, so the section is always shown.", True, "form"),
        # Project page › Overview (dashboard/rnd/projects/[id])
        ("detail_summary", "Project summary", "Number, title, objective, priority, schedule and lead.", True, "detail"),
        ("detail_origin", "Origin & scope", "Why it exists, the source record, reason, note and scope.", False, "detail"),
        ("detail_members", "Members & remarks", "Team members and remarks.", False, "detail"),
        ("detail_attachments", "Attachments", "The project's files on the Overview.", False, "detail"),
        ("detail_budget", "Budget card",
         "Budget, committed, actual and available. Figures still follow the BOM costs switch; this only hides the card on screen.", False, "detail"),
    ),
    options=(
        ("origin", "Project Origin", dict(RND_ORIGIN_LABELS),
         "Existing Projects / New Project. A value not allowed here is also refused by the server.", "form"),
        ("improvement_reason", "Reason", dict(RND_IMPROVEMENT_REASON_LABELS),
         "Why an existing project is being improved (Existing Projects origin only).", "form"),
        ("priority", "Priority", dict(PRIORITY_LABELS), "Standard / Urgent on the project form.", "form"),
    ),
    # Hiding Priority & Schedule means the form sends the default priority (Standard), so a role
    # that hides it must still allow Standard (clean_rules refuses the combination).
    section_defaults=(("priority_schedule", "priority", "standard"),),
    tables=(
        ("projects", "Projects list", {"origin": "Origin", "priority": "Priority", "lead": "Lead", "target_end": "Target End"}, "list"),
    ),
)

if "tasks" in MODULES["rnd"]["actions"]:
    register_visibility(
        "rnd", "tasks",
        label="R&D Tasks — Create Task form",
        screens=(("form", "Create Task form"),),
        sections=(
            ("type", "Type", "Requirement / Prototype / Project and the record the task belongs to.", True, "form"),
            ("basic", "Basic Information", "Task name and details.", True, "form"),
            ("assignment", "Assignment", "Who does the task.", True, "form"),
            ("schedule_priority", "Schedule & Priority", "Start date, due date (required) and priority.", True, "form"),
            ("checklist", "Checklist", "Steps the assignee ticks off.", False, "form"),
            ("attachments", "Attachments", "Files given with the task.", False, "form"),
        ),
        options=(
            ("priority", "Priority", dict(PRIORITY_LABELS),
             "Standard / Urgent on Create Task. A value not allowed here is also refused by the server.", "form"),
        ),
    )
