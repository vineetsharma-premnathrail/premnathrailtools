from datetime import datetime, date
from sqlalchemy import String, Integer, DateTime, Text, Date, func, event
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class AuditLog(Base):
    """Generic polymorphic audit trail, shared across ERP entities via `entity_type`/`entity_id`.

    `ip_address`/`user_agent`/`session_id` are auto-populated on insert (see
    the `before_insert` listener at the bottom of this file) from the current
    request's context — every existing call site that creates an AuditLog
    row gets this for free, no call-site changes needed.

    `module_key`/`subtab_key`/`branch_id`/`department`/`status`/`result`/
    `reason`/`attachment_url`/`retention_date` are nullable and populated
    only by call sites that choose to set them — same situation as
    `User.erp_permissions` before it: the columns exist so new/updated call
    sites have somewhere real to write, not because every existing one has
    been retrofitted."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    field_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    performed_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Module/sub-module classification (see app/core/permission_registry.py
    # for the same key vocabulary) — set by newer call sites; older rows are
    # classified on the fly at read time from `entity_type` (see the audit
    # log route's _infer_module()).
    module_key: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    subtab_key: Mapped[str | None] = mapped_column(String(50), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    result: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    retention_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Auto-populated — see before_insert listener below.
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "web_app" | "bearer_token" — which auth path the request that
    # triggered this log took, set by get_current_user() (see
    # app/modules/main/routes/auth.py) via app/core/audit_context.py.
    api_source: Mapped[str | None] = mapped_column(String(30), nullable=True)


@event.listens_for(AuditLog, "before_insert")
def _populate_request_context(mapper, connection, target: AuditLog) -> None:
    # Local imports avoid a cross-module cycle at startup (this model is
    # imported very early, before app.core.audit_context's own imports
    # would be safe to resolve) and avoid the cost when no request is active
    # (e.g. background jobs, seed scripts) — get_request_ip() etc. just
    # return None in that case.
    from app.core.audit_context import get_request_ip, get_request_user_agent, get_request_refresh_token, get_api_source

    if target.ip_address is None:
        target.ip_address = get_request_ip()
    if target.user_agent is None:
        target.user_agent = get_request_user_agent()
    if target.api_source is None:
        target.api_source = get_api_source()
    if target.session_id is None:
        raw = get_request_refresh_token()
        if raw:
            from app.auth.jwt_handler import hash_refresh_token
            from app.modules.main.models.user_session import UserSession

            # Raw Core query against the same `connection` the flush is
            # already using — deliberately not an ORM Session.query(), which
            # would risk re-entrant flush/autoflush issues mid-insert.
            row = connection.execute(
                UserSession.__table__.select().where(UserSession.token_hash == hash_refresh_token(raw))
            ).first()
            if row:
                target.session_id = row.id
