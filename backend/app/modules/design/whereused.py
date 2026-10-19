"""Where-used: every BOM (and through it, every project) that uses an Item
Master code or a drawing. Needed before any change — the ECR impact check
starts here. Only the released and in-work BOM revisions count;
superseded ones are history, not usage."""
from sqlalchemy.orm import Session

from app.modules.design.models.bom import DesignBom, DesignBomLine, DesignBomRevision
from app.modules.design.models.document import DesignDocument
from app.modules.design.schemas.document import DesignWhereUsedRow
from app.modules.erp.models.project import Project
from app.modules.projects.models.project import PmProject
from app.modules.store.models.item import StoreItem

_CURRENT = ("draft", "in_review", "in_approval", "released")


def _rows(db: Session, line_filter) -> list[DesignWhereUsedRow]:
    hits = db.query(DesignBomLine, DesignBomRevision, DesignBom).join(
        DesignBomRevision, DesignBomRevision.id == DesignBomLine.revision_id
    ).join(DesignBom, DesignBom.id == DesignBomRevision.bom_id).filter(
        line_filter,
        DesignBomRevision.is_deleted == False,  # noqa: E712
        DesignBomRevision.status.in_(_CURRENT),
        DesignBom.is_deleted == False,  # noqa: E712
    ).order_by(DesignBom.bom_number, DesignBomRevision.revision_index).all()
    if not hits:
        return []
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({b.product_item_id for _, _, b in hits})).all()}
    pm_ids = {b.pm_project_id for _, _, b in hits} - {None}
    pms = {p.id: p for p in db.query(PmProject).filter(PmProject.id.in_(pm_ids)).all()} if pm_ids else {}
    erp_ids = {b.erp_project_id for _, _, b in hits} - {None}
    machines = {p.id: p for p in db.query(Project).filter(Project.id.in_(erp_ids)).all()} if erp_ids else {}
    out = []
    for line, rev, bom in hits:
        item = items.get(bom.product_item_id)
        pm = pms.get(bom.pm_project_id)
        machine = machines.get(bom.erp_project_id)
        out.append(DesignWhereUsedRow(
            bom_id=bom.id, bom_number=bom.bom_number, bom_title=bom.title, revision_id=rev.id,
            revision_label=rev.revision_label, revision_status=rev.status, quantity=line.quantity,
            product_item_label=f"{item.item_code} — {item.item_name}" if item else None,
            pm_project_label=f"{pm.project_code} — {pm.name}" if pm else None,
            erp_project_label=machine.serial_number if machine else None,
        ))
    return out


def where_used_document(db: Session, document_id: int) -> list[DesignWhereUsedRow]:
    return _rows(db, DesignBomLine.document_id == document_id)


def where_used_item(db: Session, store_item_id: int) -> list[DesignWhereUsedRow]:
    return _rows(db, DesignBomLine.store_item_id == store_item_id)


def drawings_for_item(db: Session, store_item_id: int) -> list[DesignDocument]:
    return db.query(DesignDocument).filter(
        DesignDocument.store_item_id == store_item_id, DesignDocument.is_deleted == False  # noqa: E712
    ).order_by(DesignDocument.doc_number).all()
