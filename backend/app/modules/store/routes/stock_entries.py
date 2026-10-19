"""Manual stock entry documents (SE-…) — read-only history since 2026-10-12.

Record Stock Entry was removed (SAP standard: every goods movement has its own
document — see stock.MANUAL_ENTRY_REMOVED). Entries posted before stay
viewable with their ledger lines, and late documents (e.g. the supplier's
invoice) can still be attached to them."""
import os
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.permissions import require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.access import ensure_any_store_action
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_entry import StoreStockEntry, StoreStockEntryAttachment
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.routes.doc_types import get_doc_type
from app.modules.store.routes.stock import MANUAL_ENTRY_REMOVED
from app.modules.store.services.plant_access import ensure_location_allowed
from app.modules.store.services.stock_values import mask_for

router = APIRouter(prefix="/store/stock/entries", tags=["Store"])

MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_FILES = 10
_ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"}


class StockEntryLine(BaseModel):
    item_id: int
    quantity: float
    batch_number: str | None = Field(None, max_length=100)
    unit_cost: float | None = None  # stock-in only: rate per unit (values the receipt)
    remarks: str | None = None


class StockEntryCreate(BaseModel):
    entry_type: str
    location_id: int
    entry_date: date | None = None
    vendor_name: str | None = Field(None, max_length=255)
    invoice_number: str | None = Field(None, max_length=100)
    remarks: str | None = None
    lines: list[StockEntryLine]


def _check_files(files: list[UploadFile]) -> list[tuple[UploadFile, int]]:
    files = [f for f in files or [] if f and f.filename]
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"{len(files)} files attached — attach at most {MAX_FILES} per entry (combine scans into one PDF).")
    out = []
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in _ALLOWED_EXT:
            raise HTTPException(status_code=400, detail=f"'{f.filename}' can't be attached — use PDF, an image (JPG/PNG/WEBP), Word or Excel.")
        f.file.seek(0, os.SEEK_END)
        size = f.file.tell()
        f.file.seek(0)
        if size > MAX_FILE_BYTES:
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is {size / 1024 / 1024:.1f} MB — keep each file under 15 MB (scan at lower resolution and try again).")
        out.append((f, size))
    if out and not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="Document storage (SharePoint) isn't configured on the server, so files can't be attached — "
                                                    "post the entry without attachments, or ask the admin to set SHAREPOINT_SITE_ID.")
    return out


async def _store_files(db: Session, entry: StoreStockEntry, files: list[tuple[UploadFile, int]], user: User) -> list[str]:
    from app.utils.sharepoint import sanitize_folder_name, upload_file_to_sharepoint
    folder = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/Store/Stock-Entries/{sanitize_folder_name(entry.entry_number)}"
    paths = []
    for f, size in files:
        uploaded = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, f)
        paths.append(uploaded["path"])
        db.add(StoreStockEntryAttachment(entry_id=entry.id, file_name=f.filename, file_path=uploaded["path"],
                                         content_type=f.content_type, file_size=size, uploaded_by_id=user.id))
    return paths


async def _discard_files(paths: list[str]) -> None:
    from app.utils.sharepoint import delete_file_from_sharepoint
    for p in paths:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, p)
        except Exception:  # noqa: BLE001 — a stray file is harmless; the entry wasn't saved
            pass


def _detail(db: Session, entry: StoreStockEntry) -> dict:
    loc = db.query(StoreLocation).filter(StoreLocation.id == entry.location_id).first()
    creator = db.query(User).filter(User.id == entry.created_by_id).first() if entry.created_by_id else None
    txns = db.query(StoreStockTransaction).filter(
        StoreStockTransaction.reference_type == "stock_entry", StoreStockTransaction.reference_number == entry.entry_number
    ).order_by(StoreStockTransaction.id).all()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({t.item_id for t in txns})).all()} if txns else {}
    try:
        type_label = get_doc_type(db, "stock_entry", entry.entry_type, field="stock entry type").label
    except HTTPException:
        type_label = entry.entry_type
    return {
        "id": entry.id, "entry_number": entry.entry_number, "entry_type": entry.entry_type, "entry_type_label": type_label,
        "location_id": entry.location_id, "location_name": loc.name if loc else None, "entry_date": entry.entry_date,
        "vendor_name": entry.vendor_name, "invoice_number": entry.invoice_number, "remarks": entry.remarks,
        "created_by_name": (creator.name or creator.email) if creator else None, "created_at": entry.created_at,
        "lines": [{
            "id": t.id, "item_id": t.item_id, "item_code": items[t.item_id].item_code if t.item_id in items else None,
            "item_name": items[t.item_id].item_name if t.item_id in items else None, "uom": items[t.item_id].uom if t.item_id in items else None,
            "transaction_type": t.transaction_type, "quantity": t.quantity, "batch_number": t.batch_number,
            "unit_cost": t.unit_cost, "value": t.value, "remarks": t.remarks,
        } for t in txns],
        "attachments": [{"id": a.id, "file_name": a.file_name, "content_type": a.content_type, "file_size": a.file_size,
                         "created_at": a.created_at} for a in entry.attachments],
    }


# Store › Items › Stock value & rates (sensitive) — blanked without it.
_ENTRY_VALUE_KEYS = frozenset({"unit_cost", "value"})


def _ensure_can_view(user: User) -> None:
    """Opening an entry shows its stock movements — Store › Stock, Movements or Adjustments 'View'."""
    ensure_any_store_action(user, ("stock", "view"), ("movements", "view"), ("adjustments", "view"))


def _get(db: Session, entry_id: int, user: User) -> StoreStockEntry:
    entry =db.query(StoreStockEntry).options(selectinload(StoreStockEntry.attachments)).filter(StoreStockEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Stock entry #{entry_id} not found — it may have been removed. Reload the page.")
    ensure_location_allowed(db, user, entry.location_id)
    return entry


@router.get("/by-number/{entry_number}")
async def get_stock_entry_by_number(entry_number: str, db: Session = Depends(get_db),
                                    user: User = Depends(require_app_access("store"))):
    """Old entries stay viewable (Movements links here by SE number)."""
    _ensure_can_view(user)
    entry = db.query(StoreStockEntry).filter(StoreStockEntry.entry_number == entry_number).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Stock entry {entry_number} not found — check the number on the movement.")
    return mask_for(user, _detail(db, _get(db, entry.id, user)), _ENTRY_VALUE_KEYS)


@router.get("/{entry_id}")
async def get_stock_entry(entry_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("store"))):
    _ensure_can_view(user)
    return mask_for(user, _detail(db, _get(db, entry_id, user)), _ENTRY_VALUE_KEYS)


@router.post("", status_code=410)
async def create_stock_entry(_user: User = Depends(require_tab_action("store", "adjustments", "create"))):
    """Record Stock Entry is removed (2026-10-12) — see stock.MANUAL_ENTRY_REMOVED.
    Entries posted before stay viewable, and documents can still be attached."""
    raise HTTPException(status_code=410, detail=MANUAL_ENTRY_REMOVED)


@router.post("/{entry_id}/attachments")
async def add_stock_entry_attachments(
    entry_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "adjustments", "create")),
):
    """Add a document that came later (e.g. the supplier's invoice). Files
    are never removed — the entry and its evidence are a record."""
    entry = _get(db, entry_id, user)
    if len(entry.attachments) + len([f for f in files if f.filename]) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"{entry.entry_number} already has {len(entry.attachments)} file(s) — at most {MAX_FILES} per entry.")
    checked = _check_files(files)
    if not checked:
        raise HTTPException(status_code=400, detail="Choose at least one file to attach.")
    paths: list[str] = []
    try:
        paths = await _store_files(db, entry, checked, user)
        db.commit()
    except Exception:
        db.rollback()
        await _discard_files(paths)
        raise
    return mask_for(user, _detail(db, _get(db, entry.id, user)), _ENTRY_VALUE_KEYS)


@router.get("/{entry_id}/attachments/{attachment_id}")
async def download_stock_entry_attachment(entry_id: int, attachment_id: int, db: Session = Depends(get_db),
                                          user: User = Depends(require_app_access("store"))):
    from app.utils.sharepoint import download_file_content
    _ensure_can_view(user)
    _get(db, entry_id, user)
    att = db.query(StoreStockEntryAttachment).filter(StoreStockEntryAttachment.id == attachment_id,
                                                     StoreStockEntryAttachment.entry_id == entry_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found — reload the entry.")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, att.file_path)
    safe = att.file_name.replace('"', "")
    return Response(content=content, media_type=att.content_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{safe}"'})
