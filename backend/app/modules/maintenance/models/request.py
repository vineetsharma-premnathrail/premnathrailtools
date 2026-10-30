from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

MAINTENANCE_REQUEST_TYPES = ("breakdown", "abnormality", "improvement", "safety")
MAINTENANCE_PRIORITIES = ("standard", "urgent")
# open → acknowledged → converted (to a work order), or rejected / duplicate.
MAINTENANCE_REQUEST_STATUSES = ("open", "acknowledged", "converted", "rejected", "duplicate")


class MaintenanceRequest(Base, TimestampMixin):
    """A breakdown / maintenance request raised from the shop floor (MRQ-).
    If `machine_down`, the downtime clock starts at `reported_at` and runs
    until the work order hands the machine back."""

    __tablename__ = "maintenance_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    asset_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_assets.id"), index=True, nullable=False)
    request_type: Mapped[str] = mapped_column(String(20), default="breakdown", nullable=False)
    machine_down: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    problem_description: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str] = mapped_column(String(10), default="standard", nullable=False)  # standard | urgent
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)

    raised_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    acknowledged_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The work order a converted request became is MaintenanceWorkOrder.request_id
    # (one direction only, so the two tables don't FK each other).
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


# Data-scope helpers (core/data_scope.py, see maintenance/access.py): the
# plant and department of the asset this record is about — the record has no
# plant column of its own. Deferred SQL expressions, not DB columns (no
# migration); computed only when a scope filter uses them.
def _scope_columns() -> None:
    from sqlalchemy import select
    from sqlalchemy.orm import column_property
    from app.modules.maintenance.models.asset import MaintenanceAsset
    from app.modules.organization.models.department import Department

    MaintenanceRequest.scope_branch_id = column_property(
        select(MaintenanceAsset.branch_id).where(MaintenanceAsset.id == MaintenanceRequest.asset_id)
        .correlate_except(MaintenanceAsset).scalar_subquery(),
        deferred=True,
    )
    MaintenanceRequest.scope_department = column_property(
        select(Department.name).join(MaintenanceAsset, MaintenanceAsset.department_id == Department.id)
        .where(MaintenanceAsset.id == MaintenanceRequest.asset_id)
        .correlate_except(MaintenanceAsset, Department).scalar_subquery(),
        deferred=True,
    )


_scope_columns()
