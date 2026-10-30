"""Technical Offers (see models/technical_offer.py): numbering, the uploaded
file of record and who may do what.

Since 2026-10-30 an offer is UPLOADED (Word .docx or PDF), not written in the
portal:

* R&D offer (origin "rnd"): the Technical Offer team (or the R&D head) uploads
  it on an accepted requirement; it waits for the R&D head's release
  (status "submitted" = Pending release). The head can return it with a reason
  (status back to "draft" with returned_reason); the uploader then uploads a
  corrected file, which is the next revision (TO-…-R1).
* BD offer (origin "bd"): BD uploads its own offer on an inquiry / tender —
  no R&D requirement is needed and it is quotable at once (status "released"),
  numbered BTO-…; it cannot be deleted once a quotation uses it.

The file is a CrmDocument (related_sub_module "technical_offer",
doc_category "Technical Offer"). Offers written in Word before this release keep
their managed Word document (served read-only); migrated drafts are completed by
an upload.
"""
from __future__ import annotations

import io
import logging
import zipfile
from dataclasses import dataclass

from fastapi import HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.main.models.user import User
from app.modules.main.services import managed_documents
from app.modules.rnd.models.technical_offer import RndTechnicalOffer
from app.modules.rnd.services import requirement_access as ra
from app.utils.sharepoint import build_sharepoint_folder_path, download_file_content, upload_bytes_to_sharepoint

logger = logging.getLogger(__name__)

ENTITY = "rnd_technical_offer"          # legacy managed Word document (read only)
OFFER_SUB_MODULE = "technical_offer"    # CrmDocument.related_sub_module of an uploaded offer
DOC_CATEGORY = "Technical Offer"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
ALLOWED_TYPES = {".docx": DOCX_MIME, ".pdf": "application/pdf"}
MAX_BYTES = 25 * 1024 * 1024
BD_PREFIX = "BTO"
RND_PREFIX = "TO"


def record_for(db: Session, source: str, record_id: int):
    model = Inquiry if source == "inquiry" else Tender
    return db.query(model).filter(model.id == record_id, model.is_deleted == False).first()  # noqa: E712


def number_base(source: str, record, prefix: str = RND_PREFIX) -> str:
    """INQ-2026-0042 → TO-INQ-2026-0042 (BD uploads: BTO-INQ-2026-0042). The source
    prefix of the CRM number keeps inquiry and tender series apart."""
    return f"{prefix}-{record.universal_id or ('INQ' if source == 'inquiry' else 'TND') + f'-{record.id}'}"


def number_for(base: str, revision: int) -> str:
    return base if revision == 0 else f"{base}-R{revision}"


def status_label(offer: RndTechnicalOffer) -> str:
    if offer.status == "submitted":
        return "Pending release"
    if offer.status == "draft":
        return "Returned" if offer.returned_reason else "Draft — upload the file"
    return {"released": "Released", "superseded": "Superseded"}.get(offer.status, offer.status)


# ── who may do what ───────────────────────────────────────────────────────

def ensure_creator(db: Session, user: User) -> None:
    """Uploading R&D's Technical Offer is R&D's formal answer: R&D heads, and the
    people with R&D › Requirements › Technical Offer team › Create."""
    if not ra.is_rnd_side(user):
        raise HTTPException(status_code=403, detail="Only R&D uploads R&D's Technical Offer (BD uploads its own from the inquiry / tender). "
                                                    "Design / Electrical / Hydraulic & Pneumatic give their input through tasks and documents.")
    if not ra.can_create_technical_offer(db, user):
        raise HTTPException(status_code=403, detail=f"You can't upload Technical Offers. Ask an admin to tick R&D › Requirements › "
                                                    f"'Technical Offer team (every requirement)' › Create for you (or your role) in Organization › "
                                                    f"Role & Permissions. R&D head: {ra._head_names(db)}.")


def ensure_can_prepare(db: Session, user: User, source: str, record_id: int) -> dict:
    ensure_creator(db, user)
    return ra.ensure(db, user, source, record_id, "view")


# ── the uploaded file ─────────────────────────────────────────────────────

@dataclass
class OfferFile:
    data: bytes
    filename: str
    extension: str

    @property
    def mime(self) -> str:
        return ALLOWED_TYPES[self.extension]


def _extension(filename: str | None) -> str:
    name = (filename or "").strip().lower()
    return next((ext for ext in ALLOWED_TYPES if name.endswith(ext)), "")


def _sniff(data: bytes, ext: str) -> bool:
    """The bytes are what the extension says: a PDF starts with %PDF, a .docx is a
    zip holding word/document.xml."""
    if ext == ".pdf":
        return data[:5] == b"%PDF-"
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return "word/document.xml" in z.namelist()
    except (zipfile.BadZipFile, ValueError):
        return False


async def read_upload(file: UploadFile | None) -> OfferFile:
    """Validate an uploaded offer: Word (.docx) or PDF, not empty, within the size limit."""
    only = "Only Word (.docx) or PDF files can be uploaded as a Technical Offer."
    if file is None or not (file.filename or "").strip():
        raise HTTPException(status_code=422, detail=f"Choose the offer file to upload. {only}")
    ext = _extension(file.filename)
    if not ext:
        raise HTTPException(status_code=422, detail=only)
    data = await file.read(MAX_BYTES + 1)
    if not data:
        raise HTTPException(status_code=422, detail="The file is empty.")
    if len(data) > MAX_BYTES:
        size = len(data) / (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"The file is {size:.0f} MB or more; the limit is {MAX_BYTES // (1024 * 1024)} MB. "
                                                    "Reduce it (compress images) and upload again.")
    if not _sniff(data, ext):
        raise HTTPException(status_code=422, detail=f"This file isn't a real {ext.lstrip('.').upper()} document (its content doesn't match its name). "
                                                    f"{only}")
    return OfferFile(data=data, filename=file.filename.strip(), extension=ext)


async def store_file(db: Session, *, source: str, record, offer: RndTechnicalOffer, file: OfferFile, user: User) -> CrmDocument:
    """Put the file in SharePoint and link it to the offer (CrmDocument, folder "rnd")."""
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) isn't configured on the server, so the offer can't be saved. Ask IT to set SHAREPOINT_SITE_ID.")
    org = db.query(Organization).filter(Organization.id == record.org_id).first()
    by = user.name or user.email or ""
    folder = build_sharepoint_folder_path(by, org.name if org else "General", f"crm/{source}/{record.universal_id or record.id}/technical-offers", root_folder="CRM-media")
    stored_name = f"{offer.offer_number}{file.extension}"
    result = await upload_bytes_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, stored_name, file.mime, file.data)
    doc = CrmDocument(
        related_module=source, related_id=record.id, related_sub_module=OFFER_SUB_MODULE, related_sub_id=offer.id,
        universal_id=record.universal_id, folder_type="rnd", doc_category=DOC_CATEGORY,
        file_name=result["name"], file_path=result["path"], sharepoint_path=result["path"],
        sharepoint_url=result.get("webUrl"), file_size=result.get("size") or len(file.data), mime_type=file.mime,
        description=f"Technical Offer {offer.offer_number} ({file.filename})",
        uploaded_by_name=by, org_id=record.org_id, created_by_id=user.id,
    )
    db.add(doc)
    db.flush()
    offer.document_id = doc.id
    return doc


def flush_offer(db: Session) -> None:
    """Flush a new offer row; a clash on the number (two uploads at once) is a 409 that says what to do."""
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Two uploads got the same number — upload again.") from None


def next_revision(db: Session, source: str, record_id: int, origin: str) -> tuple[RndTechnicalOffer | None, int]:
    """(latest offer of this origin, revision number the next upload takes)."""
    rows = db.query(RndTechnicalOffer).filter(
        RndTechnicalOffer.source == source, RndTechnicalOffer.record_id == record_id, RndTechnicalOffer.origin == origin,
    ).order_by(RndTechnicalOffer.revision.desc(), RndTechnicalOffer.id.desc()).all()
    latest = rows[0] if rows else None
    return latest, (latest.revision + 1 if latest else 0)


async def offer_file(db: Session, offer: RndTechnicalOffer) -> tuple[bytes, str, str]:
    """(bytes, file name, mime type) of an offer — its uploaded file, or for an offer written in
    Word before uploads existed, its managed Word document."""
    if offer.document_id:
        doc = db.get(CrmDocument, offer.document_id)
        if doc and not doc.is_deleted and doc.sharepoint_path:
            if not settings.SHAREPOINT_SITE_ID:
                raise HTTPException(status_code=503, detail="File storage (SharePoint) isn't configured on the server. Ask IT to set SHAREPOINT_SITE_ID.")
            content, _ = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path)
            ext = _extension(doc.file_name) or ".pdf"
            return content, f"{offer.offer_number}{ext}", doc.mime_type or ALLOWED_TYPES[ext]
    legacy = managed_documents.get_active(db, ENTITY, offer.id)
    if legacy:
        return await managed_documents.current_docx(legacy), f"{offer.offer_number}.docx", DOCX_MIME
    raise HTTPException(status_code=404, detail=f"Technical Offer {offer.offer_number} has no file on record. "
                                                "Ask the person who uploaded it to upload the file again.")


def has_file(db: Session, offer: RndTechnicalOffer) -> bool:
    return bool(offer.document_id) or managed_documents.get_active(db, ENTITY, offer.id) is not None
