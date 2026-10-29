"""CRM notifiable events (see core/notification_events.py).

Fired from app/modules/crm (inquiry / tender / discussion routes, the
quotation status service and its approval-engine callback, the R&D response
in services/requirement_movement.py) and from the daily CRM job
(app/tasks/followup_reminders.py — bell / Teams only, no email from a job).
Every event checks the CRM data scope (crm/access.py can_open_record) so a
member hears only about records they can open."""
from app.core.notification_events import register_event

# ── Waiting for a decision ───────────────────────────────────────────────────
register_event(
    "crm", "quotation_submitted", "Quotation sent for approval",
    "a quotation is submitted for approval", ("inquiries_tenders", "quotations", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)

# ── New business ─────────────────────────────────────────────────────────────
register_event(
    "crm", "inquiry_received", "New inquiry received",
    "a new customer inquiry is logged in CRM", ("inquiries_tenders", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "crm", "tender_received", "New tender added",
    "a new tender is added in CRM", ("inquiries_tenders", "view"),
    default_channels=("bell",), kind="info",
)

# ── Quotation outcome ────────────────────────────────────────────────────────
register_event(
    "crm", "quotation_approved", "Quotation approved",
    "a quotation is released (approved) and can be sent to the customer", ("inquiries_tenders", "quotations", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "crm", "quotation_returned", "Quotation returned for changes",
    "an approver returns a quotation to its creator for changes", ("inquiries_tenders", "quotations", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "crm", "quotation_rejected", "Quotation rejected",
    "an approver rejects a quotation", ("inquiries_tenders", "quotations", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "crm", "quotation_expired", "Quotation expired",
    "a sent / approved quotation's validity ended without a customer decision", ("inquiries_tenders", "quotations", "view"),
    default_channels=("bell",), kind="info",
)

# ── R&D / discussion ─────────────────────────────────────────────────────────
register_event(
    "crm", "tor_responded", "R&D answered a Technical Requirement",
    "R&D submits its response to a Technical Requirement (TOR) sent from an inquiry / tender",
    ("inquiries_tenders", "send_tor", "view"), default_channels=("bell",), kind="info",
)
register_event(
    "crm", "discussion_message", "New message in a requirement discussion",
    "someone posts in the BD ↔ R&D discussion of an inquiry / tender", ("inquiries_tenders", "discussion", "view"),
    default_channels=("bell",), kind="info",
)

# ── Reminders (daily CRM job) ────────────────────────────────────────────────
register_event(
    "crm", "quotation_expiring", "Quotation validity ending soon",
    "a sent / approved quotation's validity ends in 3 days", ("inquiries_tenders", "quotations", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)
register_event(
    "crm", "followup_overdue", "Follow-up overdue",
    "an open inquiry / tender follow-up passed its follow-up date yesterday", ("inquiries_tenders", "followups", "view"),
    default_channels=("bell",), kind="reminder",
)
register_event(
    "crm", "tender_submission_due", "Tender submission date approaching",
    "a live tender's last date (closing date-time, else submission date) is 7, 3 or 1 day(s) away", ("inquiries_tenders", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)
