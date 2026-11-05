"""Direct notifications sent by the scheduled jobs (app/tasks/** and
app/modules/*/tasks/**). The job itself names who gets each one (the owner,
the buyer, the department head …) through notify_user / broadcast_notification;
a role's Notifications tab only picks the channels those people receive it on
(see register_direct in core/notification_events.py). Reminders default to
bell + Teams, the rest to bell only."""
from app.core.notification_events import register_direct

# ── Accounts ─────────────────────────────────────────────────────────────────
register_direct(
    "accounts", "accounts_bg_expiring", "Bank guarantee expiring",
    "Everyone who can edit guarantees, and the person who created the guarantee",
    "a bank guarantee or similar instrument is nearing expiry or its claim period and needs extending or releasing",
    default_channels=("bell", "teams"), kind="reminder",
)

# ── CRM ──────────────────────────────────────────────────────────────────────
register_direct(
    "crm", "activity_followup_due_today", "Follow-up due today",
    "The follow-up owner (the person it is assigned to, else its creator)",
    "an open follow-up is due today",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "crm", "activity_followup_due_tomorrow", "Follow-up due tomorrow",
    "The follow-up owner (the person it is assigned to, else its creator)",
    "an open follow-up is due tomorrow",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "crm", "activity_followup_overdue", "Follow-up overdue",
    "The follow-up owner (the person it is assigned to, else its creator)",
    "an open follow-up is past its due date",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "crm", "crm_tender_deadline", "Tender closing soon",
    "The tender's creator and its BD owner",
    "a tender is a few days from its closing or submission date",
    default_channels=("bell", "teams"), kind="reminder",
)

# ── Design ───────────────────────────────────────────────────────────────────
register_direct(
    "design", "design_customer_overdue", "Customer response overdue",
    "The Design heads and the project manager of the submission",
    "a drawing or document sent to the customer has had no response past its due date",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "design", "design_review_overdue", "Design review waiting on you",
    "The reviewer or approver a document or BOM revision is waiting on",
    "a document or BOM revision has waited too many days for its check or approval",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "design", "design_request_overdue", "Design request overdue",
    "The lead designer of the request and the Design heads",
    "a design request is past its due date and still with Design",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "design", "design_ecn_ack_pending", "Change notice acknowledgement pending",
    "The people named to acknowledge change notices for the department",
    "an implemented engineering change notice has not been acknowledged by a department after 3 days",
    default_channels=("bell", "teams"), kind="reminder",
)

# ── Service (erp) ────────────────────────────────────────────────────────────
register_direct(
    "erp", "erp_contract_expiring", "Service contract ending",
    "The contract's creator and everyone who can edit service contracts",
    "an active service contract is a set number of days from its end date and has not been renewed",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "erp", "erp_contract_billing_failed", "Contract invoice could not be drafted",
    "The creator of the service contract",
    "a billing period of a service contract fell due but its invoice could not be drafted",
    default_channels=("bell",), kind="info",
)
register_direct(
    "erp", "erp_sla_response_warning", "Response time about to breach",
    "The engineer assigned to the service request and its creator",
    "a service request has used 80 percent of its response time",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "erp", "erp_sla_resolution_warning", "Resolution time about to breach",
    "The engineer assigned to the service request and its creator",
    "a service request has used 80 percent of its resolution time",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "erp", "erp_sla_response_breach", "Response time breached",
    "The engineer assigned to the service request, its creator and the Service heads",
    "a service request passes its response due time without a first response",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "erp", "erp_sla_resolution_breach", "Resolution time breached",
    "The engineer assigned to the service request, its creator and the Service heads",
    "a service request passes its resolution due time without being resolved",
    default_channels=("bell", "teams"), kind="reminder",
)

# ── HR ───────────────────────────────────────────────────────────────────────
register_direct(
    "hr", "hr_document_expiring", "Employee document expiring",
    "HR staff, and the document's owner if they can open HR (not for HR-only documents)",
    "an employee's document (licence, certificate, ID) is about to expire",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "hr", "hr_probation_ending", "Probation ending",
    "The employee, their manager and HR staff",
    "an employee's probation period is about to end",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "hr", "hr_approval_pending_reminder", "HR request pending for days",
    "The approver of the request, or the HR deciders when it has no usable approver",
    "an HR request (leave, claim and similar) has been waiting for a decision for several days",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "hr", "hr_lifecycle_apply_failed", "Scheduled HR change not applied",
    "Everyone with HR access",
    "a scheduled lifecycle event (promotion, transfer, confirmation) could not be applied on its effective date",
    default_channels=("bell",), kind="info",
)

# ── Maintenance ──────────────────────────────────────────────────────────────
register_direct(
    "maintenance", "maintenance_amc_expiring", "AMC or warranty expiring",
    "The maintenance planners (or users) of the asset's branch",
    "an asset's AMC or warranty is about to expire or has just expired",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "maintenance", "maintenance_pm_overdue", "Preventive maintenance overdue",
    "The technician assigned to the job and the plant's maintenance planners",
    "a preventive maintenance job is past its due date and still open",
    default_channels=("bell", "teams"), kind="reminder",
)

# ── Procurement (p2p) ────────────────────────────────────────────────────────
register_direct(
    "p2p", "po_overdue", "Purchase order delivery overdue",
    "The PO's buyer",
    "a purchase order has passed its expected delivery date without being received",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "p2p", "rfq_quotes_due", "Quote-by date passed",
    "The RFQ's buyer (or its creator)",
    "the quote-by date of an RFQ has passed and quotes may still be outstanding",
    default_channels=("bell", "teams"), kind="reminder",
)

# ── Projects ─────────────────────────────────────────────────────────────────
register_direct(
    "projects", "pm_task_due_soon", "Task due tomorrow",
    "The task's assignee",
    "a project task is due tomorrow",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "projects", "pm_task_overdue", "Task overdue",
    "The task's assignee",
    "a project task is past its due date",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "projects", "pm_task_overdue_escalated", "Team task overdue",
    "The owners of the task's milestone",
    "a project task has been overdue for 2 or more days",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "projects", "pm_milestone_at_risk", "Milestone at risk",
    "The project manager and the department heads",
    "a project milestone has blocked or overdue tasks",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "projects", "pm_milestone_overdue", "Milestone overdue",
    "The project manager and the department heads",
    "a project milestone is past its due date",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "projects", "pm_milestone_overdue_escalated", "Milestone overdue, escalated",
    "Project management (the partners)",
    "a project milestone is more than 7 days overdue",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "projects", "pm_milestone_awaiting_acceptance", "Milestone awaiting your acceptance",
    "The project's owners",
    "a department has submitted a milestone and it is still waiting for acceptance",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "projects", "pm_goal_due_soon", "Milestone or sub-task due tomorrow",
    "The owner of the milestone or sub-task",
    "a project milestone or sub-task is due tomorrow",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "projects", "pm_goal_due_today", "Milestone or sub-task due today",
    "The owner of the milestone or sub-task and whoever created it",
    "a project milestone or sub-task is due today",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "projects", "pm_goal_overdue", "Milestone or sub-task overdue",
    "The owner of the milestone or sub-task and whoever created it",
    "a project milestone or sub-task is past its due date and not done",
    default_channels=("bell", "teams"), kind="reminder",
)

# ── Quality ──────────────────────────────────────────────────────────────────
register_direct(
    "quality", "quality_gauge_calibration_due", "Gauge calibration due",
    "The gauge's custodian, or everyone with Quality access when it has none",
    "a gauge is due, or overdue, for calibration",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "quality", "quality_inspection_call_due", "Inspection call coming up",
    "The Quality engineers, or everyone with Quality access when none are set",
    "a third-party or customer inspection call is today or within the reminder days",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "quality", "quality_capa_action_overdue", "Corrective action overdue",
    "The action's owner and the Quality heads",
    "a corrective or preventive action is past its due date",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "quality", "quality_capa_effectiveness_due", "Effectiveness check due",
    "The CAPA's responsible person and the Quality heads",
    "the effectiveness check of a corrective action is due",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "quality", "quality_lot_waiting", "Inspection lot waiting",
    "The Quality engineers, or everyone with Quality access when none are set",
    "an inspection lot has been waiting for inspection too long",
    default_channels=("bell", "teams"), kind="reminder",
)

# ── R&D ──────────────────────────────────────────────────────────────────────
register_direct(
    "rnd", "rnd_review_reminder", "Requirement waiting for review",
    "The R&D heads",
    "a requirement sent by BD has waited for acceptance beyond the reminder days",
    default_channels=("bell", "teams"), kind="reminder",
)
# R&D task due / overdue (modules/rnd/tasks/task_reminders.py) — requirement and project tasks.
register_direct(
    "rnd", "rnd_task_due_soon", "R&D task due tomorrow",
    "The task's assignee",
    "an open R&D task (requirement or project) is due tomorrow",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "rnd", "rnd_task_due_today", "R&D task due today",
    "The task's assignee",
    "an open R&D task (requirement or project) is due today",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "rnd", "rnd_task_overdue", "R&D task overdue",
    "The task's assignee",
    "an open R&D task is past its due date — every day until it is submitted or re-dated",
    default_channels=("bell", "teams"), kind="reminder",
)
register_direct(
    "rnd", "rnd_task_overdue_escalated", "Team R&D task overdue",
    "Whoever gave the task and the R&D head(s)",
    "an open R&D task has been overdue for 2 or more days — every 3 days",
    default_channels=("bell", "teams"), kind="reminder",
)

# ── Store ────────────────────────────────────────────────────────────────────
register_direct(
    "store", "store_jobwork_return_due", "Job work material due back",
    "The issuer, the store location's manager and the store managers",
    "material sent out on a job-work challan is approaching or past its allowed return period",
    default_channels=("bell", "teams"), kind="reminder",
)
