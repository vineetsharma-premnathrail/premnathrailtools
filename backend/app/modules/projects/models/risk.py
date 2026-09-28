from __future__ import annotations
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

PM_RISK_PROBABILITIES = ("low", "medium", "high")
PM_RISK_IMPACTS = ("low", "medium", "high")
PM_RISK_STATUSES = ("identified", "monitoring", "mitigated", "occurred", "closed")

_RISK_SCORE_WEIGHTS = {"low": 1, "medium": 2, "high": 3}


class PmRisk(Base, TimestampMixin):
    """A risk tracked against a Project Management module project.
    Table `pm_project_risks`, FK'd to `pm_projects.id` and `users.id`."""

    __tablename__ = "pm_project_risks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    probability: Mapped[str] = mapped_column(String(10), default="medium", nullable=False)
    impact: Mapped[str] = mapped_column(String(10), default="medium", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="identified", nullable=False)
    mitigation_plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    @property
    def risk_score(self) -> int:
        """Simple 1-9 computed convenience for the frontend to sort/color
        by. Not a DB column — probability/impact strings each map to
        1/2/3 and the score is their product."""
        return _RISK_SCORE_WEIGHTS.get(self.probability, 2) * _RISK_SCORE_WEIGHTS.get(self.impact, 2)
