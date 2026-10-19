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
)

# "Assign to" rules per role (core/assignee_rules.py). They apply to people
# whose roles open these features; My Tasks users outside Project Management
# are not restricted (no role of theirs opens the feature).
register_pickers("projects", "overview",
                 ("milestones", "Set milestone owners to",
                  "Who this role may make the responsible person (or a co-owner) of a project milestone, when adding or handing it over."),
                 ("tasks", "Assign tasks to",
                  "Who this role may give a milestone's tasks to, add as collaborators, or reassign them to (project Milestones tab and My Tasks)."))
