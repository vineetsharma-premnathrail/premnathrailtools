from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class QualityLotPhoto(Base, TimestampMixin):
    """A photo taken during inspection, stored in SharePoint (same as other
    attachments) and served back through the app. result_id ties it to one
    characteristic's result; NULL = a general photo of the lot. Photos can
    be added / removed only while the lot is open — after the usage
    decision they are part of the record."""

    __tablename__ = "quality_lot_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lot_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_inspection_lots.id"), index=True, nullable=False)
    result_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_lot_results.id"), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    caption: Mapped[str | None] = mapped_column(String(255), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
