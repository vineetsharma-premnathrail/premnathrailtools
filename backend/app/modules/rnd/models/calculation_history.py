from datetime import datetime
from typing import Any
from sqlalchemy import String, Integer, DateTime, JSON, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class CalculationHistory(Base):
    """Cross-tool save/rename/list/delete log — one row per named save,
    regardless of which R&D calculation tool produced it (see tool_name)."""

    __tablename__ = "rnd_calculation_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    tool_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    calculation_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    inputs_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    results_json: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
