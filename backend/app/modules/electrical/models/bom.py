from __future__ import annotations
from sqlalchemy import String, Integer, Float, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

ELECTRICAL_COMPONENT_CATEGORIES: dict[str, str] = {
    "battery": "Battery",
    "alternator": "Alternator / Charger",
    "protection": "MCB / Fuse / Protection",
    "relay": "Relay / Contactor",
    "switch": "Switch / Push Button",
    "lighting": "Lamp / Lighting",
    "instrument": "Meter / Instrument",
    "sensor": "Sensor",
    "controller": "Controller / PLC",
    "cable": "Cable / Wire",
    "connector": "Connector / Terminal",
    "enclosure": "Enclosure / Box",
    "accessory": "Accessory / Hardware",
    "other": "Other",
}

# proposed → selected → approved. Component Selection is complete once every
# line is at least "selected" (a make + part number was picked).
ELECTRICAL_SELECTION_STATUSES = ("proposed", "selected", "approved")

# required = still needs buying; in_stock = will be drawn from Store;
# pr_raised / ordered / received track the purchase; issued = handed to the
# assembly floor. Purchase Requirement is complete once no line is still
# "required".
ELECTRICAL_PROCUREMENT_STATUSES = ("required", "in_stock", "pr_raised", "ordered", "received", "issued")


class ElectricalBomItem(Base, TimestampMixin, SoftDeleteMixin):
    """One component line of a job's electrical BOM. The same row carries
    the component selection (make / part number), its specification
    (rating + spec text) and its procurement state, so the Component
    Selection, Component Specification, Electrical BOM and Purchase
    Requirement stages are all views of this one list."""

    __tablename__ = "electrical_bom_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("electrical_jobs.id"), index=True, nullable=False)
    line_no: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str] = mapped_column(String(30), default="other", nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    store_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True)
    make: Mapped[str | None] = mapped_column(String(150), nullable=True)
    part_number: Mapped[str | None] = mapped_column(String(150), nullable=True)
    rating: Mapped[str | None] = mapped_column(String(150), nullable=True)
    specification: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    uom: Mapped[str] = mapped_column(String(20), default="NOS", nullable=False)
    estimated_unit_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    panel_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("electrical_panels.id"), nullable=True)
    selection_status: Mapped[str] = mapped_column(String(20), default="proposed", nullable=False)
    procurement_status: Mapped[str] = mapped_column(String(20), default="required", nullable=False)
    p2p_request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_requests.id"), index=True, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
