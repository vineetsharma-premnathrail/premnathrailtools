from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Where the returned material came from — issue: unused material handed
# back from a department/project against a prior Material Issue;
# other: any other source (e.g. a site returning surplus directly).
STORE_RETURN_SOURCE_TYPES = ("issue", "other")

# good material rejoins usable stock (posts a return_in transaction);
# damaged/rejected material is recorded on the return but does NOT post a
# stock transaction — it was never usable on-hand stock and this module
# doesn't yet track a separate damaged/rejected balance bucket (see
# app.modules.store.services.stock_ledger).
STORE_RETURN_CONDITIONS = ("good", "damaged", "rejected")


class StoreMaterialReturn(Base, TimestampMixin):
    __tablename__ = "store_material_returns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    return_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)

    source_type: Mapped[str] = mapped_column(String(20), nullable=False, default="issue")
    source_issue_id: Mapped[int | None] = mapped_column(ForeignKey("store_material_issues.id"), nullable=True)
    source_description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    return_date: Mapped[date] = mapped_column(Date, nullable=False)
    returned_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["StoreMaterialReturnItem"]] = relationship(
        "StoreMaterialReturnItem", back_populates="material_return", cascade="all, delete-orphan"
    )


class StoreMaterialReturnItem(Base, TimestampMixin):
    __tablename__ = "store_material_return_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("store_material_returns.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    condition: Mapped[str] = mapped_column(String(20), nullable=False, default="good")
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    material_return: Mapped["StoreMaterialReturn"] = relationship("StoreMaterialReturn", back_populates="items")
