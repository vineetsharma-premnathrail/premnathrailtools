"""Direct-notification catalog for R&D, CRM and Project Management.

Every notification these modules send straight to a named person through
utils/notifications.notify_user (or a helper that forwards a notification_type
to it) is declared here with register_direct (core/notification_events.py):
who gets it, when, and the channels it uses when no role or personal setting
says otherwise. The code names the recipient; a role's Notifications tab (and a
user's own override) only picks the channels. Assignments, approvals and
reminders default to bell + Teams, results and information to bell only.

Types ending in _created / _updated / _deleted are suppressed app-wide and are
not listed. "rnd_review_reminder" (a scheduled job) is declared in
direct_scheduled.py.
"""
from app.core.notification_events import register_direct

BELL = ("bell",)
BELL_TEAMS = ("bell", "teams")

# ── R&D · project tasks (R&D and Prototype / Research projects) ───────────────
register_direct(
    "rnd", "rnd_project_task_assigned", "Task assigned on a project",
    "The assignee",
    "someone gives you a task or sub-task on an R&D project",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "rnd", "rnd_project_task_edited", "Task changed on a project",
    "The task's assignee, and the previous assignee when it is handed to someone else",
    "a task on an R&D project is edited, re-assigned or its due date changes",
)
register_direct(
    "rnd", "rnd_project_task_extended", "Task re-dated on a project",
    "The task creator and the project leads (the task creator only for a sub-task)",
    "the assignee moves a task's completion date on an R&D project",
)
register_direct(
    "rnd", "rnd_project_task_completed", "Task completed on a project",
    "The task creator and the project leads (the task creator only for a sub-task)",
    "the assignee completes a task on an R&D project",
)
register_direct(
    "rnd", "rnd_project_task_approval_requested", "Task approval requested on a project",
    "The task creator and the project leads (the task creator only for a sub-task)",
    "the assignee asks for approval on a task of an R&D project",
    default_channels=BELL_TEAMS, kind="approval",
)
register_direct(
    "rnd", "rnd_project_task_approval_approved", "Task approval granted on a project",
    "The person who asked for the approval",
    "your approval request on an R&D project task is approved",
)
register_direct(
    "rnd", "rnd_project_task_approval_rejected", "Task approval rejected on a project",
    "The person who asked for the approval",
    "your approval request on an R&D project task is rejected",
)
register_direct(
    "rnd", "rnd_project_task_update", "Task progress update on a project",
    "The task creator",
    "the assignee posts a progress update on a task of an R&D project",
)
register_direct(
    "rnd", "rnd_project_task_reopened", "Task reopened on a project",
    "The task's assignee",
    "a closed task of an R&D project is reopened and sent back to you",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "rnd", "rnd_project_task_cancelled", "Task cancelled on a project",
    "The task's assignee",
    "a task of an R&D project that was given to you is cancelled",
)

# ── R&D · requirement tasks (work on a BD requirement) ───────────────────────
register_direct(
    "rnd", "rnd_task_assigned", "Task assigned on a requirement",
    "The assignee",
    "someone gives you a task or sub-task on a customer requirement",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "rnd", "rnd_task_assigned_head", "Your team member got a requirement task",
    "The assignee's department head(s)",
    "someone in your department is given a task or sub-task on a customer requirement",
)
register_direct(
    "rnd", "rnd_task_extended", "Task re-dated on a requirement",
    "The task creator and the R&D head(s) (the task creator only for a sub-task)",
    "the assignee moves a requirement task's completion date",
)
register_direct(
    "rnd", "rnd_task_completed", "Task completed on a requirement",
    "The task creator and the R&D head(s) (the task creator only for a sub-task)",
    "the assignee completes a requirement task",
)
register_direct(
    "rnd", "rnd_task_approval_requested", "Task approval requested on a requirement",
    "The task creator and the R&D head(s) (the task creator only for a sub-task)",
    "the assignee asks for approval on a requirement task",
    default_channels=BELL_TEAMS, kind="approval",
)
register_direct(
    "rnd", "rnd_task_approval_approved", "Task approval granted on a requirement",
    "The person who asked for the approval",
    "your approval request on a requirement task is approved",
)
register_direct(
    "rnd", "rnd_task_approval_rejected", "Task approval rejected on a requirement",
    "The person who asked for the approval",
    "your approval request on a requirement task is rejected",
)
register_direct(
    "rnd", "rnd_task_edited", "Task changed on a requirement",
    "The task's assignee, and the previous assignee when it is handed to someone else",
    "a requirement task is edited or taken away from you",
)
register_direct(
    "rnd", "rnd_task_update", "Task progress update on a requirement",
    "The task creator",
    "the assignee posts a progress update on a requirement task",
)
register_direct(
    "rnd", "rnd_task_reopened", "Task reopened on a requirement",
    "The task's assignee",
    "a closed requirement task is reopened and sent back to you",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "rnd", "rnd_task_cancelled", "Task cancelled on a requirement",
    "The task's assignee",
    "a requirement task that was given to you is cancelled",
)

# ── R&D · requirement intake and Technical Offers ────────────────────────────
register_direct(
    "rnd", "rnd_request_assigned", "New requirement for R&D",
    "The R&D head(s)",
    "BD sends a customer requirement (or a new revision of it) to R&D to accept",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "rnd", "rnd_request_withdrawn", "Requirement taken back by BD",
    "The R&D head(s)",
    "BD takes a requirement back from R&D, so nothing is needed from R&D unless it is sent again",
)
register_direct(
    "rnd", "rnd_technical_offer_submitted", "Technical Offer needs release",
    "The R&D head(s)",
    "a Technical Offer is uploaded and waits for you to release it to BD or return it",
    default_channels=BELL_TEAMS, kind="approval",
)
register_direct(
    "rnd", "rnd_technical_offer_released", "Technical Offer released",
    "The person who uploaded the offer, and the BD owner of the inquiry or tender",
    "R&D releases a Technical Offer to the BD team",
)

# ── CRM · answers from R&D back to BD ────────────────────────────────────────
register_direct(
    "crm", "rnd_requirement_accepted", "R&D accepted the requirement",
    "The BD person who sent the requirement and the BD owner of the inquiry or tender",
    "R&D accepts a revision of your customer requirement",
)
register_direct(
    "crm", "rnd_requirement_returned", "R&D returned the requirement",
    "The BD person who sent the requirement and the BD owner of the inquiry or tender",
    "R&D returns a revision of your customer requirement for correction",
)
register_direct(
    "crm", "rnd_request_details_asked", "R&D needs more details",
    "The BD person who sent the requirement",
    "R&D asks for more details on a requirement you sent",
)
register_direct(
    "crm", "rnd_request_responded", "R&D responded to your request",
    "The BD person who sent the requirement",
    "R&D responds to a Technical Offer Request you sent",
)
register_direct(
    "crm", "rnd_request_closed", "R&D closed your request",
    "The BD person who sent the requirement",
    "R&D closes a Technical Offer Request without a response",
)

# ── Project Management · project ─────────────────────────────────────────────
register_direct(
    "projects", "pm_project_manager", "You are project manager",
    "The new project manager",
    "someone makes you the project manager of a project",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "projects", "sales_order_project_needed", "Confirmed order waiting for its project",
    "Every Project Manager who can open Project Management",
    "a confirmed New Project order is waiting for its project to be created",
)
register_direct(
    "projects", "pm_project_hold", "Project put on hold",
    "The WBS leads and department heads of open WBS elements, and the people holding open tasks",
    "a project that is in progress is put on hold",
)
register_direct(
    "projects", "pm_project_resume", "Project resumed",
    "The WBS leads and department heads of open WBS elements, and the people holding open tasks",
    "a project that was on hold is resumed",
)
register_direct(
    "projects", "pm_project_cancel", "Project cancelled",
    "The WBS leads and department heads of open WBS elements, and the people holding open tasks",
    "a project that is in progress is cancelled",
)
register_direct(
    "projects", "pm_project_technically_complete", "Project technically complete",
    "The project manager (every Partner and Director when no project manager is set)",
    "every WBS of a project is accepted and it only needs its closure checklist and final report",
)

# ── Project Management · WBS (milestone steps owned by a department) ─────────
register_direct(
    "projects", "pm_milestone_assigned", "You are on a project WBS",
    "The WBS lead, the department head(s) and the assistants",
    "a WBS element of a project is given to you, or you are added to it",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "projects", "pm_milestone_unlocked", "Your WBS can start now",
    "The WBS lead, the department head(s) and the assistants",
    "the step a WBS element was waiting for is done, so its work can start",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "projects", "pm_milestone_date_changed", "WBS date changed",
    "The WBS lead and the department head(s)",
    "the due date of a WBS element is moved",
)
register_direct(
    "projects", "pm_milestone_achieved", "WBS accepted",
    "The WBS lead and the department head(s)",
    "the project manager accepts a WBS element as achieved",
)
register_direct(
    "projects", "pm_milestone_rejected", "WBS sent back",
    "The WBS lead and the department head(s)",
    "a WBS element you submitted is rejected and sent back with a reason",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "projects", "pm_milestone_cancelled", "WBS cancelled",
    "The WBS lead and the department head(s)",
    "a WBS element of a project is cancelled",
)
register_direct(
    "projects", "pm_evidence", "WBS evidence attached",
    "The project manager (every Partner and Director when no project manager is set)",
    "a WBS lead attaches evidence files to a WBS element",
)
register_direct(
    "projects", "pm_chat_files", "Files sent in WBS chat",
    "The project manager (every Partner and Director when no project manager is set)",
    "a department sends files in the chat of a WBS element",
)

# ── Project Management · tasks inside a WBS ──────────────────────────────────
register_direct(
    "projects", "pm_task_assigned", "Task assigned",
    "The assignee",
    "someone gives you a task on a WBS element, or hands an existing task to you",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "projects", "pm_task_reassigned", "Task reassigned",
    "The previous assignee",
    "a task you held is reassigned to someone else",
)
register_direct(
    "projects", "pm_task_reopened", "Task sent back",
    "The task's assignee",
    "a finished task is sent back to you with a reason",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "projects", "pm_task_cancelled", "Task cancelled",
    "The task's assignee",
    "a task given to you is cancelled or removed, alone or together with its WBS element",
)
register_direct(
    "projects", "pm_task_blocked", "Task blocked",
    "The WBS lead and the department head(s)",
    "someone in the team reports a task as blocked",
)
register_direct(
    "projects", "pm_task_done", "Task done",
    "The WBS lead and the department head(s)",
    "someone in the team completes a task",
)
register_direct(
    "projects", "pm_task_self_added", "Team member added a task",
    "The WBS lead and the department head(s)",
    "a team member adds a task for themselves on a WBS element",
)
register_direct(
    "projects", "pm_task_comment", "Task comment",
    "The task's assignee, or the WBS lead and department head(s) when the assignee comments",
    "someone comments on a task",
)
register_direct(
    "projects", "pm_mention", "You were mentioned",
    "The people tagged in the comment or WBS chat message",
    "someone tags you in a task comment or a WBS chat message",
)

# ── Project Management · milestones and sub-tasks of a project ───────────────
# pm_dept_task is shared by several events: a milestone handed to you or
# handed over to you, removed, reopened or cancelled, and a sub-task finished.
register_direct(
    "projects", "pm_dept_task", "Milestone or sub-task activity",
    "The milestone owner(s); for a finished sub-task also the milestone creator",
    "a milestone is given to you, handed over, removed, reopened or cancelled, or a sub-task of it is done",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "projects", "pm_project_task_done", "Milestone done",
    "The project manager (every Partner and Director when none is set) and the milestone creator",
    "the owner marks a milestone of a project as done",
)
register_direct(
    "projects", "pm_subtask", "Sub-task given to you",
    "The sub-task's assignee, and its collaborators",
    "someone gives you a sub-task or task on a milestone, or adds you as a collaborator",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "projects", "pm_task_remark", "Remark or file on a task",
    "The project manager, the person who gave the milestone, its owner(s) and, for a sub-task, its assignee and collaborators",
    "someone adds a remark or attaches a file on a milestone or sub-task",
)

register_direct(
    "rnd", "rnd_technical_offer_returned", "Your Technical Offer was returned", "The person who uploaded the offer",
    "the R&D head returns an uploaded Technical Offer for correction", default_channels=BELL, kind="info",
)
