from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, false, func, true
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin


class MobileAppRelease(Base, TimestampMixin):
    """One published version of the private Android app (APK).

    Owner decision 2026-11-12 (docs/agent-runs/2026-11-12-mobile-app-updates):
    portal admins publish versions from Organization › Mobile App; every
    signed-in user / the app fetches the latest active one and downloads it.
    The APK bytes live in SharePoint (`sharepoint_path`); only the pointer,
    size and SHA-256 (computed on the server at upload) live here."""

    __tablename__ = "mobile_app_releases"
    __table_args__ = (
        Index("uq_mobile_app_releases_version_code", "version_code", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_name: Mapped[str] = mapped_column(String(50), nullable=False)
    # Android versionCode: strictly increasing, the app compares this number.
    version_code: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "Update required": the app blocks with "Please update to continue".
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    # Installed versions below this code must update before use.
    min_supported_version_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    sharepoint_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    sharepoint_item_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    released_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
