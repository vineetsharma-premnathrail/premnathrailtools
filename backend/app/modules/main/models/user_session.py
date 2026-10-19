from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class UserSession(Base):
    """A refresh-token session, separate from the short-lived JWT access
    token. Only the hash of the refresh token is stored (never the raw
    value) so a stolen DB row can't be replayed as a cookie. Existing here
    (rather than only as a JWT) is what makes logout / deactivation /
    "sign out everywhere" actually revoke access instead of just expiring
    after the fact — a bare JWT can't be un-issued."""
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Why it ended when revoked: logout | admin | deactivated | idle | rotated | limit
    revoked_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # App lock (services/app_lock.py): every new sign-in starts 'locked' until
    # the app password is entered; 'reset' = unlocked by an emailed temporary
    # password, only allowed to set a new password. Carried over on refresh
    # rotation. app_activity_at = last real user activity, for the idle lock.
    app_lock_state: Mapped[str] = mapped_column(String(10), default="locked", server_default="locked")
    app_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
