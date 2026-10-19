"""Sales attachments (customer PO / LOA, amendment letters, DP-extension
letters …) in SharePoint under Sales-Orders. The Word documents of record
(order acknowledgement) go through the managed-documents framework instead."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import ensure_feature_action, require_app_access
from app.core.permission_registry import can_perform, can_view_tab
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.sales.models.attachment import SalesAttachment, SALES_ATTACHMENT_ENTITIES, SALES_ATTACHMENT_DOC_TYPES
from app.modules.sales.models.order import SalesOrder
from app.modules.sales.access import ensure_amendment, ensure_order
from app.modules.sales.models.amendment import SalesOrderAmendment
from app.modules.sales.models.extension import SalesDeliveryExtension
from app.modules.sales.schemas.order import SalesOrderAttachmentResponse
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint, download_file_content,
)

router = APIRouter(prefix="/sales/attachments", tags=["Sales"], dependencies=[Depends(require_app_access("sales"))])

_STORAGE_NOT_CONFIGURED = (
    "File storage isn't configured on this server (SHAREPOINT_SITE_ID is empty), so sales attachments can't be "
    "uploaded or opened. Ask the portal administrator to set the SharePoint site in the backend environment."
)


def _resolve(db: Session, entity_type: str, entity_id: int, user: User) -> str:
    """Folder reference of the record the files belong to — 404 if it's gone,
    403 if its order is outside the user's data scope."""
    if entity_type not in SALES_ATTACHMENT_ENTITIES:
        raise HTTPException(status_code=400, detail=f"Invalid entity type '{entity_type}'. Valid: {', '.join(SALES_ATTACHMENT_ENTITIES)}.")
    if entity_type == "sales_order":
        so = db.query(SalesOrder).filter(SalesOrder.id == entity_id, SalesOrder.is_deleted == False).first()  # noqa: E712
        if not so:
            raise HTTPException(status_code=404, detail=f"Sales order #{entity_id} not found.")
        ensure_order(db, user, so)
        return (so.so_number or f"Draft-{so.id}").replace("/", "-")
    if entity_type == "sales_amendment":
        a = db.query(SalesOrderAmendment).filter(SalesOrderAmendment.id == entity_id).first()
        if not a:
            raise HTTPException(status_code=404, detail=f"Amendment #{entity_id} not found.")
        ensure_amendment(db, user, a)
        return f"amendment-{a.id}"
    e = db.query(SalesDeliveryExtension).filter(SalesDeliveryExtension.id == entity_id).first()
    if not e:
        raise HTTPException(status_code=404, detail=f"DP extension #{entity_id} not found.")
    so = db.query(SalesOrder).filter(SalesOrder.id == e.so_id, SalesOrder.is_deleted == False).first()  # noqa: E712
    if so is None:
        raise HTTPException(status_code=404, detail=f"DP extension #{entity_id} belongs to a sales order that has been deleted, "
                                                    "so its documents are no longer available.")
    ensure_order(db, user, so)
    return f"dp-extension-{e.id}"


def _require_view(user: User, entity_type: str) -> None:
    """Customer PO / LOA / amendment letters belong to Sales › Orders; DP-extension
    letters to Sales › Delivery. Module access alone isn't enough to read them."""
    tab, label = _tab_for(entity_type)
    if not can_view_tab(user, "sales", tab):
        raise HTTPException(status_code=403, detail=f"You don't have 'view' permission on Sales › {label}, so you can't open its documents. "
                                                    f"Ask an admin to grant it in Users › Permission Matrix.")


def _feature_gate(user: User, entity_type: str, action: str) -> None:
    """Role-level gate on Sales › Sales Orders features: order documents follow
    the Documents sub-tab, amendment letters the Amendments sub-tab
    (view / create = upload / delete; amendments: upload & delete = edit).
    DP-extension letters stay on Sales › Delivery."""
    if entity_type == "sales_order":
        if action == "view":
            ensure_feature_action(user, "sales", "orders", "documents", "view")
        elif action == "create":
            ensure_feature_action(user, "sales", "orders", "documents", "create")
        else:
            ensure_feature_action(user, "sales", "orders", "documents", "delete")
    elif entity_type == "sales_amendment":
        if action == "view":
            ensure_feature_action(user, "sales", "orders", "amendments", "view")
        else:
            ensure_feature_action(user, "sales", "orders", "amendments", "edit")


def _tab_for(entity_type: str) -> tuple[str, str]:
    return ("delivery", "Delivery") if entity_type == "sales_extension" else ("orders", "Orders")


def _require_edit(user: User, entity_type: str, verb: str) -> None:
    """Uploading / deleting needs 'edit' on the same tab that owns the document
    (Delivery for DP-extension letters, Orders for everything else) plus 'view'."""
    _require_view(user, entity_type)
    tab, label = _tab_for(entity_type)
    if not can_perform(user, "sales", tab, "edit"):
        raise HTTPException(status_code=403, detail=f"You don't have 'edit' permission on Sales › {label}, so you can't {verb} its documents. "
                                                    f"Ask an admin to grant it in Users › Permission Matrix.")


@router.get("", response_model=list[SalesOrderAttachmentResponse])
async def list_attachments(entity_type: str, entity_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("sales"))):
    _require_view(user, entity_type)
    _feature_gate(user, entity_type, "view")
    _resolve(db, entity_type, entity_id, user)
    return db.query(SalesAttachment).filter(
        SalesAttachment.entity_type == entity_type, SalesAttachment.entity_id == entity_id, SalesAttachment.is_deleted == False,  # noqa: E712
    ).order_by(SalesAttachment.id.desc()).all()


@router.post("", response_model=list[SalesOrderAttachmentResponse])
async def upload_attachments(
    entity_type: str = Form(...), entity_id: int = Form(...), doc_type: str = Form("other"),
    files: list[UploadFile] = File(...), db: Session = Depends(get_db), user: User = Depends(require_app_access("sales")),
):
    _require_edit(user, entity_type, "upload")
    _feature_gate(user, entity_type, "create")
    if doc_type not in SALES_ATTACHMENT_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid document type '{doc_type}'. Valid: {', '.join(SALES_ATTACHMENT_DOC_TYPES)}.")
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one file to upload.")
    ref = _resolve(db, entity_type, entity_id, user)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    folder = build_sharepoint_folder_path(user.name or user.email or "", "Sales", f"{entity_type}/{ref}", root_folder="Sales-Orders")
    rows = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, f)
        att = SalesAttachment(entity_type=entity_type, entity_id=entity_id, doc_type=doc_type, filename=result["name"],
                              content_type=f.content_type, size=result.get("size"), sharepoint_path=result["path"],
                              sharepoint_url=result.get("webUrl"), created_by_id=user.id, created_by_name=user.name or user.email)
        db.add(att)
        rows.append(att)
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


def _get(db: Session, attachment_id: int) -> SalesAttachment:
    att = db.query(SalesAttachment).filter(SalesAttachment.id == attachment_id, SalesAttachment.is_deleted == False).first()  # noqa: E712
    if not att:
        raise HTTPException(status_code=404, detail=f"Attachment #{attachment_id} not found (it may have been deleted).")
    return att


@router.get("/{attachment_id}/content")
async def attachment_content(attachment_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("sales"))):
    att = _get(db, attachment_id)
    _require_view(user, att.entity_type)
    _feature_gate(user, att.entity_type, "view")
    _resolve(db, att.entity_type, att.entity_id, user)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, att.sharepoint_path or "")
    return Response(content=content, media_type=att.content_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{att.filename}"'})


@router.delete("/{attachment_id}")
async def delete_attachment(attachment_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("sales"))):
    att = _get(db, attachment_id)
    _require_edit(user, att.entity_type, "delete")
    _feature_gate(user, att.entity_type, "delete")
    _resolve(db, att.entity_type, att.entity_id, user)
    if not (user.role == "admin" or att.created_by_id == user.id):
        raise HTTPException(status_code=403, detail=f"Only the uploader ({att.created_by_name or 'unknown'}) or an admin can delete this file.")
    if att.entity_type == "sales_order" and att.doc_type in ("customer_po", "loa"):
        so = db.query(SalesOrder).filter(SalesOrder.id == att.entity_id).first()
        if so and so.status != "draft":
            raise HTTPException(status_code=409, detail=f"The PO / LOA of {so.display_number} is part of the confirmed contract and can't be deleted — "
                                                        f"upload a corrected copy instead.")
    if att.entity_type == "sales_amendment":
        a = db.query(SalesOrderAmendment).filter(SalesOrderAmendment.id == att.entity_id).first()
        if a and a.status == "approved":
            raise HTTPException(status_code=409, detail=f"Amendment {a.amendment_no} is approved, so its letter is the evidence for the change "
                                                        f"to the contract and can't be deleted — upload a corrected copy instead.")
    if att.entity_type == "sales_extension":
        e = db.query(SalesDeliveryExtension).filter(SalesDeliveryExtension.id == att.entity_id).first()
        if e and e.status in ("granted", "refused"):
            raise HTTPException(status_code=409, detail=f"This DP extension is already {e.status}, so the customer's letter is the evidence "
                                                        f"if an LD deduction is disputed and can't be deleted — upload a corrected copy instead.")
    if settings.SHAREPOINT_SITE_ID and att.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, att.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if the SharePoint delete fails
    att.is_deleted = True
    att.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"'{att.filename}' deleted"}
