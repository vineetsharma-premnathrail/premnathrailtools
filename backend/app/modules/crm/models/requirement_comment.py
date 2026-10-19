from __future__ import annotations
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class CrmRequirementComment(Base, TimestampMixin):
    """One message in the Discussion thread of a requirement sent to R&D
    (CRM Inquiry / Tender ↔ R&D › Requirements). Both sides read and write the
    same thread. Attachments are CrmDocument rows with
    related_sub_module="discussion", related_sub_id=<this id> and
    shared_via_tor=True, so R&D users without CRM access can open them."""

    __tablename__ = "crm_requirement_comments"
    __table_args__ = (Index("ix_crm_requirement_comments_record", "source", "record_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # "inquiry" | "tender"
    record_id: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    author_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Which side wrote it — shown as a CRM / R&D tag on the message.
    author_side: Mapped[str] = mapped_column(String(10), nullable=False, default="crm")  # "crm" | "rnd" | "design" | "electrical" | "hydraulic"
    mentioned_user_ids: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
