"""Service & Commissioning (erp) notifiable events (see core/notification_events.py).

Fired from app/modules/erp (machine / service request / spare / contract
routes, the SR-closure approval callback in erp/access.py, the contract
submit in erp/contracts.py) and from the daily jobs
app/tasks/erp_sla_reminders.py and erp_contract_scheduler.py (bell / Teams
only — no email from a job). Every event checks the Service data scope
(erp/notify.py can_open) so a member hears only about records they can open.
The old "everyone in Service" bells (broadcast) skip whoever a role event
already reached, so nobody gets the same notice twice."""
from app.core.notification_events import register_event

# Machines: "machine_registered" lives in events/projects.py (Service Projects moved to Project Management, 2026-10-26).

# ── Service requests ─────────────────────────────────────────────────────────
register_event(
    "erp", "sr_raised", "New service request raised",
    "a customer complaint / service request is logged on a machine", ("service_requests", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "erp", "sr_assigned", "Service request assigned to an engineer",
    "a service engineer is assigned (or re-assigned) to a service request — the engineer is told directly",
    ("service_requests", "view"), default_channels=("bell",), kind="assignment",
)
register_event(
    "erp", "sr_closure_pending", "Service request closure waiting for approval",
    "the engineer finishes the work and sends the SR to Review for closure approval",
    ("service_requests", "view"), default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "erp", "sr_closed", "Service request closed",
    "a service request is closed (directly or by closure approval)", ("service_requests", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "erp", "sr_pr_raised", "Purchase requisition raised from a service request",
    "spares for a service request are requisitioned to Purchase", ("service_requests", "purchase_requisition", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "erp", "sr_spare_issued", "Spare issued from Store for a service request",
    "Store issues a spare to site against a service request (challan posted)", ("service_requests", "spare_issue", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "erp", "sr_sla_alert", "Service request SLA at risk / breached",
    "the daily SLA check finds an SR's response or resolution time about to run out or already passed",
    ("service_requests", "view"), default_channels=("bell", "teams"), kind="reminder",
)

# ── Service contracts (AMC / CMC) ────────────────────────────────────────────
register_event(
    "erp", "contract_submitted", "Service contract waiting for approval",
    "an AMC / CMC contract is sent for approval", ("service_contracts", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "erp", "contract_expiring", "Service contract ending — renewal due",
    "an active AMC / CMC contract ends soon (daily contract job)", ("service_contracts", "renew", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)
register_event(
    "erp", "contract_billing_failed", "Contract billing period could not be invoiced",
    "the daily contract job could not draft a due billing period's invoice", ("service_contracts", "billing_plan", "view"),
    default_channels=("bell",), kind="reminder",
)
