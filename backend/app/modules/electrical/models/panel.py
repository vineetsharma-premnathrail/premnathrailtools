from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

ELECTRICAL_PANEL_TYPES: dict[str, str] = {
    "main_distribution": "Main Distribution Panel",
    "control": "Control Panel",
    "driver_console": "Driver Console / Desk",
    "junction_box": "Junction Box",
    "battery_box": "Battery Box",
    "lighting": "Lighting Panel",
    "other": "Other",
}

# designed → in_assembly → assembled → tested → installed. Panel Design needs
# at least one panel; Panel Assembly is complete once every panel is at
# least "assembled".
ELECTRICAL_PANEL_STATUSES = ("designed", "in_assembly", "assembled", "tested", "installed")
ELECTRICAL_PANEL_ASSEMBLED = ("assembled", "tested", "installed")


class ElectricalPanel(Base, TimestampMixin, SoftDeleteMixin):
    """An electrical panel / enclosure on the RRV — designed in Panel
    Design, built in Panel Assembly. BOM lines can point at the panel they
    are mounted in, and tests / issues can point at it too."""

    __tablename__ = "electrical_panels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("electrical_jobs.id"), index=True, nullable=False)
    panel_tag: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    panel_type: Mapped[str] = mapped_column(String(30), default="control", nullable=False)
    location_on_vehicle: Mapped[str | None] = mapped_column(String(150), nullable=True)
    enclosure_material: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ip_rating: Mapped[str | None] = mapped_column(String(20), nullable=True)
    dimensions: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="designed", nullable=False)
    assembled_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    assembled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
