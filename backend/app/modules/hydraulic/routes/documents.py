from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.component import HydComponent
from app.modules.hydraulic.models.document import HydDocument, HYD_DOCUMENT_ENTITIES, HYD_DOCUMENT_TYPES
from app.modules.hydraulic.models.maintenance import HydServiceRecord
from app.modules.hydraulic.models.system import HydSystem
from app.modules.hydraulic.models.testing import HydTest
from app.modules.hydraulic.schemas.insights import HydDocumentResponse
from app.modules.main.models.user import User
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint, download_file_content,
)

# Documents show up inside system / circuit / test / service pages, so this
# is gated on the app only — not on a subtab — same reasoning as
# rnd/routes/documents.py.
router = APIRouter(
    prefix="/hydraulic/documents", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)

_STORAGE_NOT_CONFIGURED = (
    "File storage isn't configured on this server (SHAREPOINT_SITE_ID is empty), so Hydraulic & Pneumatic documents "
    "can't be uploaded or opened. Ask the portal administrator to set the SharePoint site in the backend environment."
)

# entity_type → (model, number column, label)
_PARENTS = {
    "system": (HydSystem, "system_number", "System"),
    "component": (HydComponent, "code", "Component"),
    "circuit": (HydCircuit, "circuit_number", "Circuit"),
    "test": (HydTest, "test_number", "Test"),
    "service_record": (HydServiceRecord, "record_number", "Service record"),
}


def _parent_ref(db: Session, entity_type: str, entity_id: int) -> str:
    if entity_type not in HYD_DOCUMENT_ENTITIES:
        raise HTTPException(status_code=400, detail=f"Documents can't be attached to '{entity_type}'. Use one of: {', '.join(HYD_DOCUMENT_ENTITIES)}.")
    model, number_col, label = _PARENTS[entity_type]
    parent = db.query(model).filter(model.id == entity_id, model.is_deleted == False).first()  # noqa: E712
    if not parent:
        raise HTTPException(status_code=404, detail=f"{label} #{entity_id} not found (it may have been deleted).")
    if entity_type == "circuit" and parent.status != "draft":
        raise HTTPException(status_code=409, detail=f"{parent.circuit_number} Rev {parent.revision} is {parent.status.replace('_', ' ')} — drawings can only be added to a draft revision. Raise a new revision to change the drawing.")
    ref = getattr(parent, number_col)
    return f"{ref}-Rev{parent.revision}" if entity_type == "circuit" else ref


def _get_or_404(db: Session, document_id: int) -> HydDocument:
    doc = db.query(HydDocument).filter(HydDocument.id == document_id, HydDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} not found (it may have been deleted).")
    return doc


@router.get("", response_model=list[HydDocumentResponse])
async def list_documents(entity_type: str, entity_id: int, db: Session = Depends(get_db)):
    return db.query(HydDocument).filter(
        HydDocument.entity_type == entity_type, HydDocument.entity_id == entity_id, HydDocument.is_deleted == False,  # noqa: E712
    ).order_by(HydDocument.id.desc()).all()


@router.post("", response_model=list[HydDocumentResponse])
async def upload_documents(
    entity_type: str = Form(...),
    entity_id: int = Form(...),
    doc_type: str = Form("other"),
    title: str = Form(...),
    description: str | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("hydraulic")),
):
    if doc_type not in HYD_DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid document type '{doc_type}'. Valid types: {', '.join(HYD_DOCUMENT_TYPES)}.")
    if not title.strip():
        raise HTTPException(status_code=400, detail="Document title is required.")
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one file to upload.")
    ref = _parent_ref(db, entity_type, entity_id)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)

    folder_path = build_sharepoint_folder_path(user.name or user.email or "", "Hydraulic", ref, root_folder="Hydraulic-media")
    documents = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        doc = HydDocument(
            entity_type=entity_type, entity_id=entity_id, doc_type=doc_type, title=title.strip(), description=description,
            file_name=result["name"], sharepoint_path=result["path"], sharepoint_url=result.get("webUrl"),
            file_size=result.get("size"), mime_type=f.content_type, uploaded_by_id=user.id, uploaded_by_name=user.name or user.email,
        )
        db.add(doc)
        documents.append(doc)
    db.commit()
    for d in documents:
        db.refresh(d)
    return documents


@router.get("/{document_id}/content")
async def get_document_content(document_id: int, db: Session = Depends(get_db)):
    doc = _get_or_404(db, document_id)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    return Response(
        content=content, media_type=doc.mime_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.file_name}"'},
    )


@router.delete("/{document_id}")
async def delete_document(document_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("hydraulic"))):
    doc = _get_or_404(db, document_id)
    if not (user.role == "admin" or doc.uploaded_by_id == user.id):
        raise HTTPException(status_code=403, detail=f"Only the uploader ({doc.uploaded_by_name or 'unknown'}) or an admin can delete this document.")
    if doc.entity_type == "circuit":
        circuit = db.query(HydCircuit).filter(HydCircuit.id == doc.entity_id).first()
        if circuit and circuit.status != "draft":
            raise HTTPException(status_code=409, detail=f"{circuit.circuit_number} Rev {circuit.revision} is {circuit.status.replace('_', ' ')} — its drawings are controlled and can't be removed.")
    if settings.SHAREPOINT_SITE_ID and doc.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if the SharePoint delete fails
    doc.is_deleted = True
    doc.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"'{doc.title}' deleted"}
