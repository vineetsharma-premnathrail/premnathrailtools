"""Project Management features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had.

All of them sit on the project workspace's Overview tab: its Milestones
sub-tab is opened by projects:overview:view, and every milestone / task
operation was guarded only by that view plus the record rules (project
manager / management, whoever created it, its owner, assignee or
collaborators) — so every action inherits "view".

My Tasks is open to everyone without a Project Management role. The task /
milestone endpoints it shares (pm-ongoing) apply these features only to
people whose roles open projects:overview; people outside Project
Management keep working their own items under the record rules alone."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features

# Machine register (our past projects), moved from Service & Commissioning on 2026-10-26 and merged into
# All Projects on 2026-11-02 — these features guard the machine page (/dashboard/projects/service-projects/{id}).
register_features(
    "projects", "all_projects",
    _feature("technical_specs", "Technical specs & operator", "subtab", {"view": "view"},
             "The Technical Specs tab of a machine: operator details, software version, options and engineering notes."),
    _feature("client_contacts", "Client & site contacts", "section", {"view": "view"},
             "The Client & Site block of a machine's Overview: customer contact names, phones, e-mails, GST and site address."),
    _feature("warranty", "Warranty & AMC", "section", {"view": "view"},
             "The Warranty & AMC block and the warranty status tile of a machine (warranty dates, terms, extended warranty, AMC)."),
    _feature("service_history", "Maintenance history", "subtab", {"view": "view"},
             "The Maintenance History tab of a machine: the service requests raised on it (opening one still needs Service Requests › View)."),
    _feature("production", "Production work orders", "subtab", {"view": "view"},
             "The Production tab of a machine: the production work orders that built it."),
    _feature("documents", "Uploaded documents", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "delete",
    }, "Uploaded files on a machine (Documents tab): see / open, upload, change who a private file is shared with, delete (own uploads only)."),
    _feature("letters", "Delivery letters & certificates", "action", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "delete", "print": "print",
    }, "Created documents on a machine (cover letter, delivery confirmation, guarantee certificate): see, create, edit, delete (own only), and download / edit in Word."),
    _feature("audit_trail", "Audit trail", "subtab", {"view": "view"},
             "The Audit Trail tab of a machine: who registered, edited, approved or uploaded what, and when."),
    _feature("store_issues", "Store Issues", "subtab", {"view": "view"},
             "The Store Issues list on a machine: material issued to it, to its service requests or to its project."),
    _feature("purchases", "Purchases", "subtab", {"view": "view"},
             "The Purchases list on a machine: requisitions, purchase orders and goods receipts of its project "
             "(PO values also need Procurement > Purchase Orders > Prices)."),
    _feature("task_history", "Tasks", "subtab", {"view": "view"},
             "The Tasks list on a machine: every task of the project it was built under."),
)

# History tab of a project workspace: what was issued, bought and worked on for the project.
register_features(
    "projects", "project_history",
    _feature("store_issues", "Store Issues", "subtab", {"view": "view"},
             "The Store Issues list on a project's History tab: material issued to the project."),
    _feature("purchases", "Purchases", "subtab", {"view": "view"},
             "The Purchases list on a project's History tab: requisitions, purchase orders and goods receipts charged to "
             "the project (PO values also need Procurement > Purchase Orders > Prices)."),
    _feature("task_history", "Tasks", "subtab", {"view": "view"},
             "The Tasks list on a project's History tab: every task of the project, open ones first."),
)

register_features(
    "projects", "overview",
    _feature("milestones", "Milestones", "subtab", {
        "view": "view", "create": "view", "edit": "view", "delete": "view",
    }, "The Milestones sub-tab of a project: see the plan; add, edit and delete milestones "
       "(also limited to the project manager / management and whoever created the milestone)."),
    _feature("milestone_status", "Achieve, reopen & cancel milestones", "action", {
        "view": "view", "approve": "view", "edit": "view", "cancel": "view",
    }, "Approve = Mark achieved, Edit = Reopen an achieved milestone, Cancel = cancel an open one "
       "(also limited to the milestone's owner / creator and the project manager)."),
    _feature("tasks", "Tasks in a milestone", "action", {
        "view": "view", "create": "view", "edit": "view", "delete": "view",
    }, "Create tasks inside a milestone, edit them (incl. status) and remove them "
       "(also limited to the milestone owner, whoever created the task, its assignee for status)."),
    _feature("task_checklist", "Task › Checklist", "subtab", {
        "view": "view", "create": "view", "edit": "view", "delete": "view",
    }, "The Checklist tab of a task: see it, add items, tick / untick (Edit) and remove items."),
    _feature("task_files", "Task › Files", "subtab", {
        "view": "view", "create": "view", "delete": "view", "export": "view",
    }, "The Files tab of a task: see the list, attach (Create), remove (Delete — uploader only) and download (Export)."),
    _feature("task_comments", "Task › Comments", "subtab", {
        "view": "view", "create": "view",
    }, "The Comments tab of a task: read the remarks and post new ones."),
    _feature("task_log", "Task › Activity Log", "subtab", {
        "view": "view",
    }, "The Activity Log tab of a task: everything that happened to it (created, edited, status changes)."),
    # Units tab of the project workspace (department 360 view per vehicle / lot) — rode silently on
    # Overview › View until the matrix cleanup of 2026-11-03.
    _feature("units", "Units tab", "subtab", {"view": "view"},
             "The Units tab of a project: one row per vehicle / lot (or one 'Whole project' row) with what each "
             "department linked to it. Opening it also needs All Projects › View."),
)

# "Assign to" rules per role (core/assignee_rules.py). They apply to people
# whose roles open these features; My Tasks users outside Project Management
# are not restricted (no role of theirs opens the feature).
register_pickers("projects", "overview",
                 ("milestones", "Set milestone owners to",
                  "Who this role may make the responsible person (or a co-owner) of a project milestone, when adding or handing it over."),
                 ("tasks", "Assign tasks to",
                  "Who this role may give a milestone's tasks to, add as collaborators, or reassign them to (project Milestones tab and My Tasks)."))

# UI visibility per role (core/visibility.py): what a member of a role sees on
# All Projects (the list and the "Add New Project" machine form, which is also
# the machine edit form) and on the task form inside a milestone. Values are
# the coded ones (never retyped); a value a role does not allow is also refused
# by the server (erp/routes/projects.py, projects/routes/project_tasks.py,
# projects/routes/work.py). Sections that hold a required field are locked.
# Machine classification / application type are not offered: "Other" lets the
# user type a custom value, so they are not a fixed list.
from app.core.priority import PRIORITIES, PRIORITY_LABELS  # noqa: E402
from app.core.visibility import register_visibility  # noqa: E402
from app.modules.erp.schemas.project import PROJECT_STATUS_LABELS  # noqa: E402

register_visibility(
    "projects", "all_projects",
    label="All Projects — form, page & list",
    screens=(("form", "New Project / machine form"), ("detail", "Project page"), ("list", "All Projects list")),
    sections=(
        # "Add New Project" form (also the machine edit form), tab by tab.
        ("machine_identity", "Machine Asset Identity", "Project name, serial, model, classification, status and identity notes.", True, "form"),
        ("site_location", "Operational Site Location", "Site name, location, state / country, pincode and zone (Client & Site tab).", False, "form"),
        ("client_details", "Client Details", "Client company (required), contact person, phone, e-mail, GST and address.", True, "form"),
        ("technical_specs", "Technical Specifications", "Specifications, installed options, software version and engineering notes (its tab is hidden with it).", False, "form"),
        ("procurement_delivery", "Procurement & Delivery Information", "Customer PO number (required on a new project), PO date, dispatch, commissioning and handover dates.", True, "form"),
        ("warranty", "Warranty Coverage Details", "Warranty status and dates, terms, extended warranty and AMC status.", False, "form"),
        ("attachments", "Attachments & Documents", "Files uploaded with the machine (its tab is hidden with it).", False, "form"),
        # Project page (dashboard/projects/[id]) › Overview tab. The other tabs (Milestones, Units, Store
        # Issues, Purchases, Tasks, Documents, History) are opened by their own tab / feature grants.
        ("detail_summary", "Project summary", "Name, scope, client, dates, project manager and progress — the header of the Overview tab.", True, "detail"),
        ("detail_progress", "Progress", "Lifecycle stage, milestones achieved, next milestone, departments working now, forecast and health.", False, "detail"),
        ("detail_record", "Record", "Customer PO, sales order, Finance budget link, created / released / closed by.", False, "detail"),
        ("detail_budget", "Finance budget card", "Budget vs spend of the linked Finance budget.", False, "detail"),
        ("detail_machine", "Machine details", "The machine registered with the project: identity, client & site, technical specs, timeline & warranty.", False, "detail"),
    ),
    options=(
        ("status", "Operational Status", dict(PROJECT_STATUS_LABELS),
         "The machine's operational status on the form. A value not allowed here is also refused by the server.", "form"),
    ),
    tables=(
        ("all_projects", "All Projects list", {"client": "Client", "site": "Site", "project_manager": "Project manager",
                                               "closing_dispatch": "Closing / Dispatch"}, "list"),
    ),
)

register_visibility(
    "projects", "overview", "tasks",
    label="Task form (Create / Edit Task in a milestone)",
    screens=(("form", "Task form"),),
    sections=(
        ("basic_information", "Basic Information", "Task name (required), description, project and milestone.", True, "form"),
        ("assignment", "Assignment", "Assignee (required) and collaborators.", True, "form"),
        ("schedule_status", "Schedule & Status", "Start date, due date (required), priority and status.", True, "form"),
        ("labels", "Labels / Tags", "Free labels on the task.", False, "form"),
        ("checklist", "Checklist", "Checklist items typed while creating the task.", False, "form"),
        ("attachments", "Attachments", "Files attached while creating the task.", False, "form"),
    ),
    options=(
        ("priority", "Priority", {p: PRIORITY_LABELS[p] for p in PRIORITIES},
         "Standard / Urgent on the task form (milestone tasks, sub-tasks and the milestone team's tasks).", "form"),
    ),
)
