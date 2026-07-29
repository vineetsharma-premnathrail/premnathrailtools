from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class CrmStageLog(Base):
    __tablename__ = "crm_stage_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    related_module: Mapped[str] = mapped_column(String(30), nullable=False)
    related_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    universal_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    stage: Mapped[str] = mapped_column(String(100), nullable=False)
    entered_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    entered_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
