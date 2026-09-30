from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

RND_PROTOTYPE_STATUSES = ("design", "building", "testing", "validated", "rejected")


class RndPrototype(Base, TimestampMixin, SoftDeleteMixin):
    """A prototype build under an R&D project (SAP PLM prototype / phantom
    BOM equivalent). Its BOM lines' cost rolls up into the project's actual
    spend."""

    __tablename__ = "rnd_prototypes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    prototype_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_projects.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str] = mapped_column(String(20), default="v1", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="design", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    build_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    findings: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Set once the validated BOM is released to Production as a draft
    # ProductionBom (see routes/prototypes.py release_to_production).
    production_bom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_boms.id"), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    released_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    bom_items: Mapped[list["RndPrototypeBomItem"]] = relationship(
        back_populates="prototype", cascade="all, delete-orphan", order_by="RndPrototypeBomItem.id",
    )


class RndPrototypeBomItem(Base, TimestampMixin):
    """One line of a prototype's BOM. `store_item_id` is optional — R&D often
    uses parts that don't exist in the Item Master yet, so code/name are
    stored as free text either way."""

    __tablename__ = "rnd_prototype_bom_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    prototype_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_prototypes.id", ondelete="CASCADE"), index=True, nullable=False)
    store_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, default=1, nullable=False)
    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    unit_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    prototype: Mapped[RndPrototype] = relationship(back_populates="bom_items")
