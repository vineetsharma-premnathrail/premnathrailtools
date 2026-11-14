"""Mobile app (Android APK) releases - see services/mobile_app.py."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class MobileAppReleaseUpdate(BaseModel):
    """PATCH body - only the fields sent are changed. Version name / code and
    the file never change: publish a new version instead."""

    notes: str | None = Field(default=None, max_length=5000)
    required: bool | None = None
    is_active: bool | None = None
    # Send null to clear it.
    min_supported_version_code: int | None = None


class MobileAppLatestResponse(BaseModel):
    """What the app and the download page need to decide and download."""

    id: int
    version_name: str
    version_code: int
    notes: str | None = None
    required: bool
    min_supported_version_code: int | None = None
    file_size: int
    sha256: str
    released_at: datetime | None = None
    download_path: str


class MobileAppReleaseResponse(MobileAppLatestResponse):
    """Admin list / create / update reply."""

    is_active: bool
    file_name: str
    uploaded_by_id: int | None = None
    uploaded_by_name: str | None = None
    created_at: datetime | None = None
