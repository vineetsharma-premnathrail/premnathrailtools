"""CRM documents linked to a sales order (owner, 2026-10-27).

When an order is raised from an inquiry or tender, the user picks which of that
record's CRM documents (customer files, internal files, the Technical Offer
Request, R&D discussion files) belong with the order. Only links are stored
(sales_order_crm_documents); the files stay in CRM / SharePoint, nothing is copied."""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.crm.models.document import CrmDocument
from app.modules.main.models.user import User
from app.modules.sales.models.crm_document_link import SalesOrderCrmDocument
from app.modules.sales.models.order import SalesOrder

FOLDER_LABELS = {"client": "Client", "internal": "Internal", "technical_offer": "Technical offer / R&D"}


def _source(inquiry_id: int | None, tender_id: int | None) -> tuple[str, int] | None:
    if inquiry_id:
        return "inquiry", inquiry_id
    if tender_id:
        return "tender", tender_id
    return None


def source_documents(db: Session, inquiry_id: int | None, tender_id: int | None) -> list[CrmDocument]:
    """Every live CRM document of the inquiry / tender, newest first."""
    src = _source(inquiry_id, tender_id)
    if not src:
        return []
    module, rid = src
    return (db.query(CrmDocument)
            .filter(CrmDocument.related_module == module, CrmDocument.related_id == rid, CrmDocument.is_deleted == False)  # noqa: E712
            .order_by(CrmDocument.id.desc()).all())


def document_row(doc: CrmDocument, link: SalesOrderCrmDocument | None = None) -> dict:
    return {
        "id": doc.id, "file_name": doc.file_name, "folder": FOLDER_LABELS.get(doc.folder_type, doc.folder_type),
        "category": doc.doc_category, "description": doc.description, "file_size": doc.file_size,
        "mime_type": doc.mime_type, "uploaded_by_name": doc.uploaded_by_name, "uploaded_at": doc.created_at,
        "linked_at": link.linked_at if link else None,
    }


def set_links(db: Session, so: SalesOrder, document_ids: list[int], user: User) -> None:
    """Replace the order's linked CRM documents with `document_ids`; each must be a
    live document of the order's own source inquiry / tender."""
    ids = list(dict.fromkeys(int(i) for i in document_ids))
    if ids and not _source(so.source_inquiry_id, so.source_tender_id):
        raise HTTPException(status_code=422, detail=(
            f"{so.display_number} isn't linked to an inquiry or tender, so it has no CRM documents to link. "
            "Upload the files on the order's Documents tab instead."))
    allowed = {d.id for d in source_documents(db, so.source_inquiry_id, so.source_tender_id)}
    wrong = [i for i in ids if i not in allowed]
    if wrong:
        raise HTTPException(status_code=422, detail=(
            f"{len(wrong)} of the picked documents don't belong to this order's "
            f"{'inquiry' if so.source_inquiry_id else 'tender'} or were deleted in CRM. Reload the list and pick again."))
    existing = {ln.crm_document_id: ln for ln in
                db.query(SalesOrderCrmDocument).filter(SalesOrderCrmDocument.sales_order_id == so.id).all()}
    for doc_id, ln in existing.items():
        if doc_id not in ids:
            db.delete(ln)
    for doc_id in ids:
        if doc_id not in existing:
            db.add(SalesOrderCrmDocument(sales_order_id=so.id, crm_document_id=doc_id, linked_by_id=user.id))


def linked_documents(db: Session, so: SalesOrder) -> list[dict]:
    rows = (db.query(SalesOrderCrmDocument, CrmDocument)
            .join(CrmDocument, CrmDocument.id == SalesOrderCrmDocument.crm_document_id)
            .filter(SalesOrderCrmDocument.sales_order_id == so.id, CrmDocument.is_deleted == False)  # noqa: E712
            .order_by(CrmDocument.id.desc()).all())
    return [document_row(doc, link) for link, doc in rows]
