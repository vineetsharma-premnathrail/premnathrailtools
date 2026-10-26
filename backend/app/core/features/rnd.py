"""R&D features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had.

Requirements: before features, everything on a requirement page was gated
only by "view" on R&D › Requirements (rnd:requirements:create / edit were
declared but never checked) plus the per-requirement rules in
rnd/services/requirement_access.py (R&D head, the Access tab's View /
Download / Upload / Respond ticks, Technical Offer team flags, department
shares). Those record-level rules stay; a feature grant is an extra
role-level gate on top — both must pass. The features apply to R&D-side
users only: Design / Electrical / Hydraulic & Pneumatic people who work on a
shared requirement through their own department's Requirements tab are
governed by that module's permissions."""
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
    }, "Tasks & Departments sub-tab: see tasks, create tasks / sub-tasks, edit / reopen / tick tasks you review, decide approval requests and cancel tasks. Record rules stay: only whoever gave a task (or the R&D head) reviews it."),
    _feature("departments", "Share with departments", "section", {"view": "view", "create": "view"},
             "Which departments (Design / Electrical / Hydraulic & Pneumatic) a requirement is shared with and their feasibility replies. Create = share it (R&D head only)."),
    _feature("technical_offers", "Technical Offers", "subtab", {
        "view": "view", "create": "view", "edit": "view", "delete": "view", "approve": "view",
    }, "Technical Offers sub-tab: see offers; create / revise, edit and delete drafts (Technical Offer creators in R&D › Settings); approve = send the offer to the BD team (R&D head)."),
    # Explicit-only (None): never inherited and never given by a module preset —
    # a role or a user's extra permission must tick it. Replaces the hand-picked
    # "Can create / Can see Technical Offers" lists that lived in R&D › Settings.
    _feature("offer_team", "Technical Offer team (every requirement)", "action", {"view": None, "create": None},
             "View = see every requirement and its Technical Offers and download them, without being added to each requirement. "
             "Create = also start a Technical Offer on any requirement and edit its Word document. Releasing to BD stays with the R&D head. "
             "Not given by No access / View only / Contributor / Full access — tick it on purpose."),
    _feature("documents", "Documents", "subtab", {"view": "view", "create": "view", "export": "view"},
             "Documents sub-tab: list the requirement's files, upload (create) and open / download (export). The per-requirement Upload / Download ticks still apply."),
    _feature("discussion", "Discussion", "subtab", {"view": "view", "create": "view"},
             "Discussion sub-tab: read the CRM ↔ R&D discussion and post messages (create)."),
    _feature("access", "Access", "subtab", {"view": "view", "edit": "view"},
             "Access sub-tab: see and change who has View / Download / Upload / Respond on a requirement (R&D head only)."),
)

register_features(
    "rnd", "projects",
    _feature("tasks", "Project tasks", "section", {
        "view": "view", "create": "view", "edit": "view", "approve": "view", "cancel": "view",
    }, "The Tasks board of a Prototype / Research project: see tasks, create tasks / sub-tasks, edit / reopen, decide approval requests and cancel. Record rules stay: project leads give tasks, the task's creator reviews it."),
    _feature("team", "Project lead & team", "section", {"view": "view"},
             "The Project Lead(s) and Team Members fields of a Prototype / Research project. Changing them still needs 'edit' on Prototype / Research; this row carries the role's 'Assign to' rule for those fields."),
    _feature("milestones", "Milestones", "subtab", {
        "view": "view", "create": "view", "edit": "view", "delete": "view",
    }, "The Milestones tab of a Prototype / Research project: see the plan; add, edit and delete milestones. Record rule stays: only project leads change the plan."),
    _feature("milestone_status", "Achieve, reopen & cancel milestones", "action", {
        "view": "view", "approve": "view", "edit": "view", "cancel": "view",
    }, "Approve = mark a milestone achieved (its responsible people or a lead, once every task is finished); edit = reopen an achieved one; cancel = cancel an open one (leads, with a reason)."),
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
                 ("milestones", "Set milestone owners to", "Who this role may make responsible for a milestone of a Prototype / Research project (only people on the project team)."))
register_pickers("rnd", "projects",
                 ("team", "Pick project lead & team","Who this role may make a project lead or team member when creating or editing a Prototype / Research project."))
register_pickers("rnd", "experiments",
                 ("conducted_by", "Assign experiment to", "Who this role may set as 'Conducted by' on an experiment / test (new or edited)."))
