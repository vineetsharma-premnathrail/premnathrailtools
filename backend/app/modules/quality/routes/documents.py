from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.quality.models.quality_document import QualityDocument, QUALITY_DOCUMENT_TYPES
from app.modules.quality.schemas.quality_document import QualityDocumentResponse
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    download_file_content,
)

router = APIRouter(
    prefix="/quality/documents", tags=["Quality"],
    dependencies=[Depends(require_app_access("quality"))],
)


@router.get("", response_model=list[QualityDocumentResponse])
async def list_documents(
    doc_type: str | None = None,
    linked_standard_id: int | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(QualityDocument).filter(QualityDocument.is_deleted == False)  # noqa: E712
    if doc_type:
        query = query.filter(QualityDocument.doc_type == doc_type)
    if linked_standard_id:
        query = query.filter(QualityDocument.linked_standard_id == linked_standard_id)
    return query.order_by(QualityDocument.id.desc()).all()


@router.post("", response_model=list[QualityDocumentResponse])
async def upload_documents(
    doc_type: str = Form(...),
    title: str = Form(...),
    version: str | None = Form(None),
    linked_standard_id: int | None = Form(None),
    description: str | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    if doc_type not in QUALITY_DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid doc_type '{doc_type}'")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    folder_path = build_sharepoint_folder_path(
        user.name or user.email or "", "Quality", f"quality/{doc_type}",
        root_folder="Quality-media",
    )

    documents = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        doc = QualityDocument(
            doc_type=doc_type,
            title=title,
            version=version,
            linked_standard_id=linked_standard_id,
            file_name=result["name"],
            file_path=result["path"],
            sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"),
            file_size=result["size"],
            mime_type=f.content_type,
            description=description,
            uploaded_by_id=user.id,
            uploaded_by_name=user.name or user.email,
        )
        db.add(doc)
        documents.append(doc)

    if documents:
        db.flush()
        for d in documents:
            db.refresh(d)
    db.commit()
    return documents


@router.get("/{document_id}/content")
async def get_document_content(
    document_id: int,
    db: Session = Depends(get_db),
):
    """Raw bytes for in-app viewing (img/pdf tags, or a same-origin
    download), fetched via the app-only Graph token — never the raw
    SharePoint webUrl, same pattern as crm/routes/documents.py."""
    doc = db.query(QualityDocument).filter(
        QualityDocument.id == document_id, QualityDocument.is_deleted == False  # noqa: E712
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    return Response(
        content=content,
        media_type=doc.mime_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.file_name}"'},
    )


@router.delete("/{document_id}")
async def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    doc = db.query(QualityDocument).filter(
        QualityDocument.id == document_id, QualityDocument.is_deleted == False  # noqa: E712
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not (user.role == "admin" or doc.uploaded_by_id == user.id):
        raise HTTPException(status_code=403, detail="Only the uploader or an admin can delete this document.")

    if settings.SHAREPOINT_SITE_ID and doc.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    doc.is_deleted = True
    doc.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Document deleted"}
