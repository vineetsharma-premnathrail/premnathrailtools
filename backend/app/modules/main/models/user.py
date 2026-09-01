from datetime import date
from sqlalchemy import JSON, ForeignKey, Date
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Modules a user's `assigned_apps` list may contain. The admin role
# bypasses this entirely and gets access to every module regardless
# of what's in the list (see get_user_apps() usage in routes).
AVAILABLE_APPS = {"erp", "rnd", "crm", "purchase", "p2p", "store", "hr", "design", "electrical", "manufacturing"}


class User(Base, TimestampMixin):
    """Portal user account. Authentication is Microsoft SSO only — see
    app/auth/jwt_handler.py and docs/adr/0002-microsoft-sso.md. Authorization
    is role-based (see get_apps() below); `role` and `assigned_apps` are the
    two fields routes/services actually check.
    """

    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(unique=True, index=True)
    name: Mapped[str]
    azure_id: Mapped[str | None] = mapped_column(unique=True, nullable=True)
    role: Mapped[str] = mapped_column(default="user")
    is_active: Mapped[bool] = mapped_column(default=True)
    designation: Mapped[str | None] = mapped_column(nullable=True)
    department: Mapped[str | None] = mapped_column(nullable=True)
    phone: Mapped[str | None] = mapped_column(nullable=True)
    # Azure AD "Office Location" (Graph `officeLocation`) — free-text per
    # tenant convention (e.g. a building/floor label), synced read-only from
    # Azure. Auto-matched/created as an Organization > Branch on every sync
    # (see app/modules/organization/services/provisioning.py); `branch_id`
    # below is the resulting managed link, this field stays as the raw
    # Azure value for reference/re-matching.
    office_location: Mapped[str | None] = mapped_column(nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    assigned_apps: Mapped[list[str]] = mapped_column(JSON, default=list)
    erp_permissions: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_azure_admin: Mapped[bool] = mapped_column(default=False)

    # Set from the Module Access modal (admin only). A department head is the
    # approver auto-assigned to any P2P request raised from their department
    # (see P2PRequest.approver_id in create_p2p_request) — matched by exact
    # string equality against `department`, since that field has no enum/FK.
    is_department_head: Mapped[bool] = mapped_column(default=False)
    # Project Head / Plant Head are org-wide approver roles (not tied to a
    # `department` string) — picked explicitly per-PR via search-select on
    # the New PR form, not auto-matched like the department head.
    is_project_head: Mapped[bool] = mapped_column(default=False)
    is_plant_head: Mapped[bool] = mapped_column(default=False)
    is_purchase_head: Mapped[bool] = mapped_column(default=False)
    is_director: Mapped[bool] = mapped_column(default=False)
    is_md: Mapped[bool] = mapped_column(default=False)

    # Present in the remote production DB (main.users) — added here so the
    # migration from that schema doesn't have to drop them. Not yet wired
    # into any route/UI in Ideal.
    #
    # SECURITY NOTE: `hashed_password` and `must_change_password` are dormant
    # columns, not an active local-auth path — this app authenticates via
    # Microsoft SSO only (app/auth/jwt_handler.py). Do not read or write
    # `hashed_password` directly if a local-password flow is ever wired up:
    # hash with passlib/argon2 (or bcrypt) first, never store or compare
    # plaintext, and add a passlib/argon2 dependency at that time since none
    # is currently in requirements.txt. `encrypted_graph_refresh_token`
    # likewise has no reader/writer yet; despite the name, no encryption is
    # implemented for it in this codebase — encrypt at rest before wiring it
    # up rather than assuming the column name guarantees it.
    hashed_password: Mapped[str | None] = mapped_column(nullable=True)
    azure_display_name: Mapped[str | None] = mapped_column(nullable=True)
    profile_photo_url: Mapped[str | None] = mapped_column(nullable=True)
    must_change_password: Mapped[bool] = mapped_column(default=False)
    dismissed_announcements: Mapped[list[str]] = mapped_column(JSON, default=list)
    encrypted_graph_refresh_token: Mapped[str | None] = mapped_column(nullable=True)
    service_permissions: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # HR directory/org-chart extension — see docs/product/HR_MODULE_PLAN.md
    # Phase 1. Deliberately NOT payroll/attendance/leave (ADP remains system
    # of record for those, per PRODUCT.md's stated non-goal).
    reporting_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    date_of_joining: Mapped[date | None] = mapped_column(Date, nullable=True)

    def get_apps(self) -> list[str]:
        """Modules this user can see: admins get all of them, everyone else
        gets whatever was explicitly assigned to them."""
        if self.role == "admin":
            return sorted(AVAILABLE_APPS)
        return self.assigned_apps or []