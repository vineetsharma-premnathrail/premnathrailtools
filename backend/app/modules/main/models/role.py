from sqlalchemy import JSON, Boolean, Column, ForeignKey, Integer, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

# Which users hold which roles. A user's effective permissions are the union
# of every active role's grants plus their own extra grants
# (User.granular_permissions) — see User.effective_permissions.
user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


class Role(Base, TimestampMixin):
    """A named bundle of Permission Matrix grants ("Store Keeper",
    "Finance – View Only") assigned to users, so access is set up once per
    job instead of per person (Organization › Role & Permissions).

    `permissions` holds `module:tab:action` ids or module wildcards
    (`store:*:*`, `store:*:view`) — see core/permission_registry.py.
    `is_system` roles are the seeded per-module Full Access / View Only
    presets: assignable, not editable or deletable. `is_default` roles apply
    to every user without being assigned (e.g. Employee self-service)."""

    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    permissions: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    # module_key -> data scope level (core/data_scope.py SCOPE_LEVELS). A
    # module missing here gets default_scope() (settings.DEFAULT_DATA_SCOPE).
    data_scopes: Mapped[dict[str, str]] = mapped_column(JSON, default=dict, nullable=False)
    # Notification subscriptions: event key ("crm.quotation_submitted", see
    # core/notification_events.py) -> channels ["bell", "email", "teams"].
    # Members get the event only for records they can open.
    notification_events: Mapped[dict[str, list[str]]] = mapped_column(JSON, default=dict, nullable=False, server_default="{}")
    # "Assign to" restrictions: "<module>:<tab>.<feature>" -> rule (who this
    # role's members may pick there) — see core/assignee_rules.py.
    assignee_rules: Mapped[dict[str, dict]] = mapped_column(JSON, default=dict, nullable=False, server_default="{}")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
