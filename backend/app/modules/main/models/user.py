from datetime import date, datetime
from sqlalchemy import JSON, ForeignKey, Date, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, object_session, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.main.models.role import Role, user_roles

# Every portal app (module) key. Which of them a user sees is derived from
# their effective permissions (see get_apps) — admins get all of them.
AVAILABLE_APPS = {"erp", "rnd", "crm", "p2p", "store", "purchase", "quality", "projects", "accounts", "hr", "production", "design", "electrical", "hydraulic", "maintenance", "sales", "products"}


class User(Base, TimestampMixin):
    """Portal user account. Authentication is Microsoft SSO only — see
    app/auth/jwt_handler.py and docs/adr/0002-microsoft-sso.md. Authorization
    is `role == "admin"` (sees and does everything) or, for everyone else,
    the Roles they hold plus extra grants — see effective_permissions and
    core/permission_registry.py.
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
    # The Department the user belongs to; `department` above is its name,
    # kept for display. Set both via organization/services/department_membership.
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL", use_alter=True), nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(nullable=True)
    # Azure AD "Office Location" (Graph `officeLocation`) — free-text per
    # tenant convention (e.g. a building/floor label), synced read-only from
    # Azure. Auto-matched/created as an Organization > Branch on every sync
    # (see app/modules/organization/services/provisioning.py); `branch_id`
    # below is the resulting managed link, this field stays as the raw
    # Azure value for reference/re-matching.
    office_location: Mapped[str | None] = mapped_column(nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    # Legacy, from before roles — get_apps no longer reads it; the roles
    # migration (c4e8a1f3b7d2) turned each assigned app into a role.
    assigned_apps: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Legacy ERP ids (project_create, sr_delete…); has_erp_permission now maps
    # them onto erp:projects:* / erp:service_requests:* grants.
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
    is_partner: Mapped[bool] = mapped_column(default=False)
    # Manager roles for the P2P approval matrix (see p2p_request.py
    # PO_APPROVAL_ROLE_SETS): PO approval is offered to every holder of each
    # role in the PR's set, any one of whom approves. PR approver pickers
    # are NOT filtered by these flags — the requester picks any P2P user per
    # role slot. is_director doubles as the Director role. Edited from the
    # Users & Roles permissions tab.
    is_design_manager: Mapped[bool] = mapped_column(default=False)
    is_rnd_manager: Mapped[bool] = mapped_column(default=False)
    is_production_manager: Mapped[bool] = mapped_column(default=False)
    is_project_manager: Mapped[bool] = mapped_column(default=False)
    is_store_manager: Mapped[bool] = mapped_column(default=False)
    is_purchase_manager: Mapped[bool] = mapped_column(default=False)
    # Accounts module — approves an AP 3-way-match variance before an invoice
    # outside tolerance can post (see old_docs/product/ACCOUNTS_MODULE_ROADMAP.md).
    is_finance_manager: Mapped[bool] = mapped_column(default=False)

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

    # Personal opt-out from the in-app Notification bell + Teams activity
    # push (see app/utils/notifications.py). Doesn't affect the fixed
    # department-inbox emails (TEAM_EMAIL/PURCHASE_EMAIL/RND_EMAIL) — those
    # aren't per-user notifications.
    notifications_enabled: Mapped[bool] = mapped_column(default=True)

    # The user's own EXTRA Permission Matrix grants (module:tab:action ids or
    # module wildcards), on top of whatever their roles give — see
    # effective_permissions. Most users need none; roles are the normal path.
    granular_permissions: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Personal data-scope overrides, module_key -> level; beats whatever the
    # user's roles give for that module (core/data_scope.py user_scope).
    data_access_scopes: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    # Personal notification overrides, "<module>.<event>" -> channels
    # (bell / email / teams). An entry replaces what the user's roles give for
    # that event; an empty list switches it off for this user only. No entry =
    # follow the roles (core/notification_events.notify_event).
    notification_overrides: Mapped[dict[str, list[str]]] = mapped_column(JSON, default=dict)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # App password (app lock, services/app_lock.py): asked after every
    # Microsoft sign-in and after idle time, because shared laptops share the
    # Windows/Microsoft password. Only a salted PBKDF2 hash is stored. A
    # forgotten one is reset with a one-time temporary password sent by email.
    app_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    app_password_set_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    app_password_failed: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    app_password_locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    app_temp_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    app_temp_password_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    app_temp_password_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    roles: Mapped[list[Role]] = relationship(Role, secondary=user_roles, lazy="selectin")

    def role_grants(self) -> list[str]:
        """Raw grants (wildcards unexpanded) from this user's active roles plus
        every active "applies to everyone" role."""
        return [g for src in self.role_grant_lists() for g in src]

    def role_grant_lists(self) -> list[list[str]]:
        """The same grants, one list per role — features inherit per role
        (permission_registry.expand_grants), so roles are expanded apart."""
        lists: list[list[str]] = []
        from app.modules.main.services.grc import inactive_access
        off_roles = inactive_access(self)[0]
        for role in self.roles or []:
            if role.is_active and role.id not in off_roles:
                lists.append(list(role.permissions or []))
        session = object_session(self)
        if session is not None:
            for role in session.query(Role).filter(Role.is_default.is_(True), Role.is_active.is_(True)).all():
                lists.append(list(role.permissions or []))
        return lists

    @property
    def effective_permissions(self) -> set[str]:
        """Concrete `module:tab:action` ids this user holds: the union of
        their roles' grants (assigned + applies-to-everyone) and their own
        extra grants, wildcards expanded. Cached on the instance until their
        roles or extra grants change."""
        from app.core.permission_registry import expand_grant_sources

        from app.modules.main.services.grc import inactive_access
        off_roles, off_grants = inactive_access(self)
        key = (
            tuple(self.granular_permissions or ()), tuple(sorted(off_roles)), tuple(sorted(off_grants)),
            tuple((r.id, r.is_active, tuple(r.permissions or ())) for r in self.roles or []),
        )
        cached = self.__dict__.get("_effective_permissions_cache")
        if cached is not None and cached[0] == key:
            return cached[1]
        eff = expand_grant_sources([g for g in (self.granular_permissions or []) if g not in off_grants], *self.role_grant_lists())
        self.__dict__["_effective_permissions_cache"] = (key, eff)
        return eff

    def invalidate_permissions(self) -> None:
        self.__dict__.pop("_effective_permissions_cache", None)

    def get_apps(self) -> list[str]:
        """Modules this user can see: portal admins and Azure tenant admins get
        every module; everyone else gets each module they can view at least
        one tab of (through a role or an extra grant)."""
        if self.role == "admin" or self.is_azure_admin:
            return sorted(AVAILABLE_APPS)
        from app.core.permission_registry import PRODUCT_TABS, PURCHASE_DESK_GRANT
        perms = self.effective_permissions
        modules = set()
        for g in perms:
            if not g.endswith(":view"):
                continue
            mk, tab = g.split(":", 2)[:2]
            # Sales › Products tabs are the "products" app (Product Management
            # inside Sales), not the "sales" app.
            modules.add("products" if mk == "sales" and tab.split(".", 1)[0] in PRODUCT_TABS else mk)
        if PURCHASE_DESK_GRANT in perms:
            modules.add("purchase")  # buyer desk lives under Procurement
        return sorted(modules & AVAILABLE_APPS)