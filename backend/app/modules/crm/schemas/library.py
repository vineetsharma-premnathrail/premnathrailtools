"""CRM › Knowledge Hub request / response shapes (contract: docs/agent-runs/2026-11-12-sales-library/spec.md §3)."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

LinkType = Literal["product", "project", "organization"]


# ── Folders ──────────────────────────────────────────────────────────────
class LibraryFolderCreate(BaseModel):
    name: str
    parent_id: int | None = None
    description: str | None = None
    product_id: int | None = None
    is_confidential: bool = False
    is_pricing: bool = False
    sort_order: int | None = None


class LibraryFolderUpdate(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    description: str | None = None
    product_id: int | None = None
    is_confidential: bool | None = None
    is_pricing: bool | None = None
    sort_order: int | None = None


class LibraryFolderResponse(BaseModel):
    id: int
    parent_id: int | None = None
    name: str
    description: str | None = None
    product_id: int | None = None
    product_name: str | None = None
    is_confidential: bool = False
    is_pricing: bool = False
    sort_order: int = 0
    document_count: int = 0
    created_by_id: int | None = None


# ── Documents ────────────────────────────────────────────────────────────
class LibraryLinkIn(BaseModel):
    link_type: LinkType
    link_id: int


class LibraryLinkOut(BaseModel):
    link_type: LinkType
    link_id: int
    name: str | None = None


class LibraryVersionOut(BaseModel):
    id: int
    version_no: int
    file_name: str
    file_size: int | None = None
    mime_type: str | None = None
    change_note: str | None = None
    uploaded_by_id: int | None = None
    uploaded_by_name: str | None = None
    created_at: datetime | None = None


class LibraryCurrentVersion(BaseModel):
    version_no: int
    file_name: str | None = None
    file_size: int | None = None
    mime_type: str | None = None


class LibraryDocumentResponse(BaseModel):
    id: int
    folder_id: int
    folder_path: str | None = None
    title: str
    description: str | None = None
    file_kind: str
    tags: list[str] = Field(default_factory=list)
    expiry_date: date | None = None
    current_version_no: int
    # Current version's file, flat (what the list screen shows) and nested.
    file_name: str | None = None
    file_size: int | None = None
    mime_type: str | None = None
    current_version: LibraryCurrentVersion | None = None
    links: list[LibraryLinkOut] = Field(default_factory=list)
    is_favorite: bool = False
    is_expired: bool = False
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    # Only on GET /documents/{id} and after an upload / edit.
    versions: list[LibraryVersionOut] | None = None


class LibraryDocumentPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    expiry_date: date | None = None
    folder_id: int | None = None
    links: list[LibraryLinkIn] | None = None


class LibraryUploadSessionPayload(BaseModel):
    """Opens a direct browser -> SharePoint upload. `document_id` = a new version of that document
    (its folder is then the document's own folder)."""
    folder_id: int | None = None
    file_name: str
    file_size: int
    mime_type: str | None = None
    document_id: int | None = None


class LibraryUploadSessionResponse(BaseModel):
    upload_url: str
    upload_token: str
    chunk_size: int
    file_name: str
    expires_at: str | None = None


class LibraryCompleteUploadPayload(BaseModel):
    upload_token: str
    # The SharePoint item the browser finished uploading (same as CRM document uploads).
    drive_item_id: str
    title: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    expiry_date: date | None = None
    change_note: str | None = None
    links: list[LibraryLinkIn] | None = None


class LibrarySharePayload(BaseModel):
    user_ids: list[int]
    message: str | None = None


# ── Summary, product resources, pickers ──────────────────────────────────
class LibrarySummaryResponse(BaseModel):
    folders: int
    documents: int
    videos: int
    expired: int
    expiring_30d: int
    recent: list[LibraryDocumentResponse]


class LibraryProductResourceGroup(BaseModel):
    folder_id: int
    folder_path: str
    documents: list[LibraryDocumentResponse]


class LibraryPickerItem(BaseModel):
    id: int
    code: str | None = None
    name: str | None = None
