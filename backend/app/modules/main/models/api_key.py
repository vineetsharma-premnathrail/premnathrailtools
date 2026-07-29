from datetime import datetime, timezone
from sqlalchemy import JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class APIKey(Base):
    """A long-lived credential external systems can use instead of a user login.
    Only the keyed hash is stored — the raw key is shown once at creation time
    and can never be recovered (see app/middleware/api_key.py)."""
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    key_hash: Mapped[str] = mapped_column(unique=True, index=True)
    prefix: Mapped[str]
    allowed_apps: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_by_id: Mapped[int | None] = mapped_column(nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
