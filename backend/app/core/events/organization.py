"""Organization notifiable events (see core/notification_events.py).

Governance changes people responsible for access and company master data
need to hear about. Fired from app/modules/organization/routes/company.py
(partners, legal / tax details, financial years), workflows.py (approval
workflow saved / reset), app/modules/main/routes/roles.py (role changed,
role holders changed) and users.py (a user's roles changed, user
deactivated / reactivated). Organization records are not data-scoped, so
the permission on each event is the whole check. The actor is never told."""
from app.core.notification_events import register_event

# ── Company Info ─────────────────────────────────────────────────────────────
register_event(
    "organization", "partners_changed", "Partners changed",
    "someone is added to or removed from the company's Partners (the top approval level)",
    ("info", "partners", "view"), default_channels=("bell", "teams"), kind="info",
)
register_event(
    "organization", "statutory_changed", "Legal / tax details changed",
    "a company registration or tax detail (GSTIN, PAN, TAN, CIN, registrations, tax set-up) is changed",
    ("info", "statutory", "view"), default_channels=("bell",), kind="info",
)
register_event(
    "organization", "financial_year_changed", "Financial year added or its status changed",
    "a financial year is added, or its status changes (open / closed)",
    ("info", "financial_years", "view"), default_channels=("bell",), kind="info",
)

# ── Access ───────────────────────────────────────────────────────────────────
register_event(
    "organization", "role_changed", "Role permissions changed",
    "a role's permissions, data access or active / everyone flags are changed",
    ("roles", "view"), default_channels=("bell",), kind="info",
)
register_event(
    "organization", "role_members_changed", "Role holders changed",
    "people are given or removed from a role (from the role's Users tab or a user's Roles)",
    ("roles", "members", "view"), default_channels=("bell",), kind="info",
)
register_event(
    "organization", "user_deactivated", "User deactivated / reactivated",
    "a portal user is deactivated (can no longer sign in) or reactivated",
    ("users", "view"), default_channels=("bell",), kind="info",
)
register_event(
    "organization", "workflow_changed", "Approval workflow changed",
    "an approval workflow is saved with new stages / rules, or reset to its default",
    ("workflows", "view"), default_channels=("bell",), kind="info",
)
