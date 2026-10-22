"""Finance › supporting documents (voucher proof) on purchase invoices, debit /
credit notes, sales invoices, manual journals and payment vouchers.

Access follows the document's own tab: its 'Supporting documents' feature
(view / create / delete — inherited from the tab until a role customises it)
plus the document's data scope. Proof on a posted document is part of the
audit trail: more files may be added, none removed."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.data_scope import ensure_in_scope
from app.core.permission_registry import is_admin_user
from app.core.permissions import ensure_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.attachment import (
    FinanceAttachment, FINANCE_ATTACHMENT_ENTITIES, FINANCE_ATTACHMENT_DOC_TYPES,
)
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.models.party_note import PartyNote
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.routes._common import require_any_accounts_tab, write_audit, who
from app.modules.accounts.schemas.attachment import FinanceAttachmentResponse
from app.modules.accounts.services.proof import proof_counts
from app.modules.accounts import access  # noqa: F401 — registers the Finance data scopes
from app.utils.sharepoint import (
    build_sharepoint_folder_path, delete_file_from_sharepoint, download_file_content, upload_file_to_sharepoint,
)

_DOC_TABS = ("purchase_invoices", "debit_notes", "sales_invoices", "credit_notes", "journal_vouchers", "payments")

router = APIRouter(prefix="/accounts/attachments", tags=["Accounts"],
                   dependencies=[Depends(require_any_accounts_tab(*_DOC_TABS))])

_STORAGE_NOT_CONFIGURED = (
    "File storage isn't configured on this server (SHAREPOINT_SITE_ID is empty), so supporting documents can't be "
    "uploaded or opened. Ask the portal administrator to set the SharePoint site in the backend environment."
)

# entity_type -> (model, label, number field, statuses while the document is
# still unposted — files may be removed only then).
_ENTITY = {
    "vendor_invoice": (VendorInvoice, "Purchase invoice", "invoice_number", ("pending",)),
    "party_note": (PartyNote, "Note", "note_number", ("pending",)),
    "ar_transaction": (ARTransaction, "Sales invoice", "invoice_number", ("pending",)),
    "journal": (JournalEntry, "Journal", "entry_number", ("draft",)),
    "payment": (PaymentTransaction, "Payment voucher", "payment_number", ("pending_approval",)),
}
_CLOSED = ("cancelled", "rejected", "reversed")


def _check_type(entity_type: str) -> None:
    if entity_type not in FINANCE_ATTACHMENT_ENTITIES:
        raise HTTPException(status_code=400, detail=f"Invalid document type '{entity_type}'. Valid: {', '.join(FINANCE_ATTACHMENT_ENTITIES)}.")


def _tab(entity_type: str, record) -> str:
    if entity_type == "party_note":
        return "debit_notes" if record is not None and record.note_type == "debit_note" else "credit_notes"
    return FINANCE_ATTACHMENT_ENTITIES[entity_type]


def _record(db: Session, entity_type: str, entity_id: int, user: User):
    _check_type(entity_type)
    model, label, _num, _open = _ENTITY[entity_type]
    rec = db.get(model, entity_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"{label} #{entity_id} doesn't exist — it may have been removed. Refresh the list.")
    ensure_in_scope(db, user, rec)
    return rec


def _ref(entity_type: str, rec) -> str:
    _model, _label, num, _open = _ENTITY[entity_type]
    return (getattr(rec, num, None) or f"{entity_type}-{rec.id}").replace("/", "-")


def _get_or_404(db: Session, attachment_id: int) -> FinanceAttachment:
    att = db.query(FinanceAttachment).filter(FinanceAttachment.id == attachment_id, FinanceAttachment.is_deleted == False).first()  # noqa: E712
    if not att:
        raise HTTPException(status_code=404, detail=f"Supporting document #{attachment_id} not found (it may have been deleted). Refresh the page.")
    return att


def _authorise(db: Session, att: FinanceAttachment, user: User, action: str):
    """The record behind a file (None while staged) after checking access."""
    if att.entity_id is None:
        # Staged for a payment voucher that isn't saved yet — the uploader's alone.
        if att.created_by_id != user.id and not is_admin_user(user):
            raise HTTPException(status_code=403, detail="This file is waiting to be attached to someone else's unsaved voucher.")
        ensure_feature_action(user, "accounts", "payments", "proof", "create" if action == "delete" else action)
        return None
    rec = _record(db, att.entity_type, att.entity_id, user)
    ensure_feature_action(user, "accounts", _tab(att.entity_type, rec), "proof", action)
    return rec


async def _store(db: Session, user: User, entity_type: str, entity_id: int | None, ref: str, doc_type: str,
                 files: list[UploadFile]) -> list[FinanceAttachment]:
    if doc_type not in FINANCE_ATTACHMENT_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid document kind '{doc_type}'. Valid: {', '.join(FINANCE_ATTACHMENT_DOC_TYPES.values())}.")
    files = [f for f in files if f and f.filename]
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one file to upload.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    folder = build_sharepoint_folder_path(user.name or user.email or "", "Finance", f"{entity_type}/{ref}", root_folder="Finance-media")
    rows = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, f)
        att = FinanceAttachment(
            entity_type=entity_type, entity_id=entity_id, doc_type=doc_type,
            filename=result["name"], content_type=f.content_type, size=result.get("size"),
            sharepoint_path=result["path"], sharepoint_url=result.get("webUrl"),
            created_by_id=user.id, created_by_name=user.name or user.email,
        )
        db.add(att)
        rows.append(att)
    return rows


@router.get("", response_model=list[FinanceAttachmentResponse])
async def list_attachments(entity_type: str, entity_id: int, db: Session = Depends(get_db),
                           user: User = Depends(require_any_accounts_tab(*_DOC_TABS))):
    rec = _record(db, entity_type, entity_id, user)
    ensure_feature_action(user, "accounts", _tab(entity_type, rec), "proof", "view")
    return db.query(FinanceAttachment).filter(
        FinanceAttachment.entity_type == entity_type, FinanceAttachment.entity_id == entity_id,
        FinanceAttachment.is_deleted == False,  # noqa: E712
    ).order_by(FinanceAttachment.id.desc()).all()


@router.get("/counts")
async def attachment_counts(entity_type: str, ids: str = Query("", description="Comma-separated document ids"),
                            db: Session = Depends(get_db), user: User = Depends(require_any_accounts_tab(*_DOC_TABS))):
    """{document id: number of files} for the 📎 marker on a list."""
    _check_type(entity_type)
    try:
        id_list = [int(x) for x in ids.split(",") if x.strip()][:500]
    except ValueError:
        raise HTTPException(status_code=400, detail="ids must be a comma-separated list of numbers.")
    tab = "debit_notes" if entity_type == "party_note" else FINANCE_ATTACHMENT_ENTITIES[entity_type]
    if entity_type == "party_note":
        from app.core.permission_registry import can_feature
        if not (can_feature(user, "accounts", "debit_notes", "proof", "view") or can_feature(user, "accounts", "credit_notes", "proof", "view")):
            ensure_feature_action(user, "accounts", tab, "proof", "view")
    else:
        ensure_feature_action(user, "accounts", tab, "proof", "view")
    return {str(k): v for k, v in proof_counts(db, entity_type, id_list).items()}


@router.post("", response_model=list[FinanceAttachmentResponse])
async def upload_attachments(
    entity_type: str = Form(...),
    entity_id: int = Form(...),
    doc_type: str = Form("other"),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_any_accounts_tab(*_DOC_TABS)),
):
    rec = _record(db, entity_type, entity_id, user)
    ensure_feature_action(user, "accounts", _tab(entity_type, rec), "proof", "create")
    if rec.status in _CLOSED:
        _model, label, _num, _open = _ENTITY[entity_type]
        raise HTTPException(status_code=400, detail=f"{label} {_ref(entity_type, rec)} is {rec.status}, so no more files can be added to it.")
    rows = await _store(db, user, entity_type, entity_id, _ref(entity_type, rec), doc_type, files)
    write_audit(db, entity_type, entity_id, "proof_added", user,
                f"{who(user)} attached {', '.join(r.filename for r in rows)} ({FINANCE_ATTACHMENT_DOC_TYPES[doc_type]}).")
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


@router.post("/staged", response_model=list[FinanceAttachmentResponse])
async def stage_payment_attachments(
    doc_type: str = Form("other"),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_any_accounts_tab(*_DOC_TABS)),
):
    """Upload proof for a payment voucher before it is saved (a voucher posts
    the moment it is saved). Pass the returned ids as attachment_ids when
    creating the voucher."""
    ensure_feature_action(user, "accounts", "payments", "proof", "create")
    rows = await _store(db, user, "payment", None, "unsaved", doc_type, files)
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


@router.get("/{attachment_id}/content")
async def get_attachment_content(attachment_id: int, db: Session = Depends(get_db),
                                 user: User = Depends(require_any_accounts_tab(*_DOC_TABS))):
    att = _get_or_404(db, attachment_id)
    _authorise(db, att, user, "view")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, att.sharepoint_path or "")
    return Response(content=content, media_type=att.content_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{att.filename}"'})


@router.delete("/{attachment_id}")
async def delete_attachment(attachment_id: int, db: Session = Depends(get_db),
                            user: User = Depends(require_any_accounts_tab(*_DOC_TABS))):
    att = _get_or_404(db, attachment_id)
    rec = _authorise(db, att, user, "delete")
    if not (is_admin_user(user) or att.created_by_id == user.id):
        raise HTTPException(status_code=403, detail=f"Only the uploader ({att.created_by_name or 'unknown'}) or an admin can delete this file.")
    if rec is not None:
        _model, label, _num, open_statuses = _ENTITY[att.entity_type]
        if rec.status not in open_statuses:
            raise HTTPException(status_code=400, detail=(
                f"{label} {_ref(att.entity_type, rec)} is {rec.status.replace('_', ' ')} — its supporting documents are part of the "
                "audit trail and can't be removed. Upload the corrected file as well, with a note in its name."))
    if settings.SHAREPOINT_SITE_ID and att.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, att.sharepoint_path)
        except Exception:
            pass  # the DB removal proceeds even if the SharePoint delete fails
    att.is_deleted = True
    att.deleted_at = datetime.now(timezone.utc)
    if rec is not None:
        write_audit(db, att.entity_type, att.entity_id, "proof_removed", user, f"{who(user)} removed supporting document {att.filename}.")
    db.commit()
    return {"message": f"'{att.filename}' deleted"}
