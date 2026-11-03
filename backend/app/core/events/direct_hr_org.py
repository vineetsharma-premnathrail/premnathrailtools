"""Direct-notification catalog for HR, Organization and the main (users / auth /
roles / jobs) code (see core/notification_events.register_direct).

A direct notification is one the code sends to a named person through
utils/notifications.notify_user / broadcast_notification, not to a role's
subscribers. A role (or a user's own setting) under Organization › Roles ›
Notifications only picks the channels these people get it on; the defaults
below apply when nothing is set. Types ending in _created / _updated /
_deleted are never sent and are not listed.

Defaults: approval / reminder / assignment = bell + Teams; result / info = bell.
Auto-imported with the rest of core/events (pkgutil)."""
from app.core.notification_events import register_direct

# ── HR: assets ───────────────────────────────────────────────────────────────
register_direct(
    "hr", "hr_asset_issued", "Asset issued to you", "The employee the asset is issued to",
    "HR issues a company asset (laptop, phone, tools …) to an employee",
)
register_direct(
    "hr", "hr_asset_returned", "Asset return recorded", "The employee who held the asset",
    "HR records that an asset was received back from the employee",
)

# ── HR: attendance, leave ────────────────────────────────────────────────────
register_direct(
    "hr", "hr_attendance", "Attendance correction decision", "The employee who asked for the correction",
    "an attendance correction request is approved or rejected",
)
register_direct(
    "hr", "hr_leave", "Leave update",
    "The employee (leave approved, rejected, cancelled by HR, balance adjusted or applied on their behalf) "
    "or the approver (leave cancelled by the employee)",
    "a leave request is approved, rejected or cancelled, HR adjusts a leave balance, or leave is applied on an employee's behalf",
)

# ── HR: safety ───────────────────────────────────────────────────────────────
register_direct(
    "hr", "hr_safety", "Safety incident and follow-up",
    "Everyone who edits safety records, the branch head and the partners (serious incidents); "
    "the investigation lead; the owner of a corrective action",
    "a safety incident is reported, someone is asked to lead its investigation, or a corrective action is assigned to them",
    default_channels=("bell", "teams"), kind="assignment",
)

# ── HR: expense claims ───────────────────────────────────────────────────────
register_direct(
    "hr", "hr_expense_approved", "Expense claim approved", "The employee who raised the claim",
    "an expense claim is approved",
)
register_direct(
    "hr", "hr_expense_rejected", "Expense claim rejected or returned", "The employee who raised the claim",
    "an expense claim is rejected or returned for changes",
)
register_direct(
    "hr", "hr_expense_cancelled", "Expense claim withdrawn", "The claim's approver",
    "the employee withdraws a claim that was waiting for a decision",
)
register_direct(
    "hr", "hr_expense_paid", "Expense claim paid", "The employee who raised the claim",
    "Finance records the payment of an expense claim",
)

# ── HR: travel ───────────────────────────────────────────────────────────────
register_direct(
    "hr", "hr_travel_approved", "Travel request approved", "The employee who raised the request",
    "a travel request is approved",
)
register_direct(
    "hr", "hr_travel_rejected", "Travel request rejected or returned", "The employee who raised the request",
    "a travel request is rejected or returned for changes",
)
register_direct(
    "hr", "hr_travel_cancelled", "Travel request cancelled", "The approver (or the person who approved it)",
    "an employee cancels a travel request that was pending or approved",
)

# ── HR: visitors ─────────────────────────────────────────────────────────────
register_direct(
    "hr", "hr_visitor_checked_in", "Your visitor has arrived", "The host being visited",
    "reception checks a visitor in",
)
register_direct(
    "hr", "hr_visitor_registered", "Visitor registered for you", "The host being visited",
    "a visitor is registered to meet them, or the host of a visit is changed to them",
)
register_direct(
    "hr", "hr_visitor_cancelled", "Visitor cancelled", "The host being visited",
    "a visit is cancelled by someone other than the host",
)

# ── HR: joining, exit and other lifecycle events ────────────────────────────
register_direct(
    "hr", "hr_checklist_assigned", "Lifecycle checklist tasks assigned", "The owner of each checklist task",
    "a joining, exit, transfer or similar checklist is started and tasks are assigned to them",
    default_channels=("bell", "teams"), kind="assignment",
)
register_direct(
    "hr", "hr_approval_rerouted", "Pending requests moved to you", "The new reporting manager (or the HR queue)",
    "an employee's reporting manager changes and their pending requests move to the new approver",
    default_channels=("bell", "teams"), kind="approval",
)
register_direct(
    "hr", "hr_manager_changed", "Your reporting manager has changed", "The employee whose reporting manager changed",
    "their reporting manager leaves and they are moved to the handover person",
)
register_direct(
    "hr", "hr_exit_handover", "Handover from a leaver", "The handover person named for the exit",
    "an employee's exit is completed and their approvals, records and reportees are handed over to them",
    default_channels=("bell", "teams"), kind="assignment",
)
register_direct(
    "hr", "hr_lifecycle_completed", "Lifecycle event completed", "Everyone with HR access",
    "a joining, exit, transfer, promotion or similar lifecycle event is completed",
)

# ── Organization: approvals engine, access governance, system ───────────────
register_direct(
    "organization", "approval", "Approval needed, handed over or escalated",
    "The approver (and their delegates)",
    "a request in any module waits for your approval, is handed over to you, is escalated or is overdue",
    default_channels=("bell", "teams"), kind="approval",
)
register_direct(
    "organization", "approval_decided", "Your request was approved or rejected", "The requester",
    "an approver approves or rejects a request you raised (any module)",
)
register_direct(
    "organization", "feedback", "New feedback received", "Every admin",
    "a user sends feedback from the portal",
)
register_direct(
    "organization", "access_expired", "Access expired", "The user whose access ended and every admin",
    "a time-limited role or permission reaches its end date and is removed",
)
register_direct(
    "organization", "access_review", "Access review: confirm your team's access", "The reporting manager doing the review",
    "an access review is started and their reports' roles and grants need a confirm or revoke",
    default_channels=("bell", "teams"), kind="assignment",
)
register_direct(
    "organization", "access_review_reminder", "Access review reminder", "The reviewer with undecided lines",
    "an access review still has lines waiting for the reviewer's decision",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "organization", "sod_mitigated", "Conflicting duties accepted", "Every partner",
    "someone accepts a high-risk segregation-of-duties conflict for a user",
)
register_direct(
    "organization", "job_failed", "Background job failing", "Every admin",
    "a scheduled background job fails twice in a row",
)
