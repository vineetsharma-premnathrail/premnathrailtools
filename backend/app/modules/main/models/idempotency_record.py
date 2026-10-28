from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class IdempotencyRecord(Base):
    """One saving request per Idempotency-Key (app/middleware/idempotency.py).

    The portal sends the same key again when a save is retried after a network
    failure; the stored response is replayed instead of saving twice. Only
    successful (2xx) saves are kept, for 24 hours."""

    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("user_key", "idem_key", name="uq_idempotency_user_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Who sent it: "u<user id>", or a hash of the credential when no user id is readable.
    user_key: Mapped[str] = mapped_column(String(80), nullable=False)
    idem_key: Mapped[str] = mapped_column(String(100), nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    # in_progress -> done (2xx stored); a failed save deletes its row so it can be retried.
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="in_progress")
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
