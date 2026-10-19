"""Engineering BOM rules — the BOM counterpart of service.py's document
rules. Same signatures (author, checker, approver — four eyes), same
"check_* returns Denied" pattern so routes and the UI's allowed_actions
can never disagree.

Release rule (plan rule 5): a BOM can't be released while any line has no
active Item Master code (still a new-item request, or the item went
inactive) or points at a drawing with no released revision."""
from sqlalchemy.orm import Session, selectinload

from app.modules.design.models.bom import DesignBom, DesignBomLine, DesignBomRevision, DESIGN_BOM_OPEN_STATUSES
from app.modules.design.models.document import DesignDocument
from app.modules.design.service import Denied, REVISION_STATUS_PHRASE, is_admin, may_delete, released_revision
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem


def bom_ref(bom: DesignBom, rev: DesignBomRevision | None = None) -> str:
    return f"{bom.bom_number} {rev.revision_label}" if rev else bom.bom_number


def live_bom_revisions(bom: DesignBom) -> list[DesignBomRevision]:
    return [r for r in bom.revisions if not r.is_deleted]


def open_bom_revision(bom: DesignBom) -> DesignBomRevision | None:
    return next((r for r in live_bom_revisions(bom) if r.status in DESIGN_BOM_OPEN_STATUSES), None)


def released_bom_revision(bom: DesignBom) -> DesignBomRevision | None:
    return next((r for r in live_bom_revisions(bom) if r.status == "released"), None)


def bom_ever_released(bom: DesignBom) -> bool:
    return any(r.status in ("released", "superseded") for r in live_bom_revisions(bom))


def bom_display_status(bom: DesignBom) -> str:
    if bom.status == "obsolete":
        return "obsolete"
    released = released_bom_revision(bom)
    current = open_bom_revision(bom)
    if released and current:
        return "revising"
    if released:
        return "released"
    return current.status if current else "draft"


def _phrase(rev: DesignBomRevision) -> str:
    return REVISION_STATUS_PHRASE.get(rev.status, rev.status)


def _is_manager(user: User, bom: DesignBom) -> bool:
    return is_admin(user) or user.id in (bom.owner_id, bom.created_by_id)


def check_bom_edit(user: User, bom: DesignBom) -> Denied | None:
    if bom.status == "obsolete":
        return Denied(409, f"{bom.bom_number} is obsolete, so its details are frozen.")
    if not _is_manager(user, bom):
        return Denied(403, f"Only the owner of {bom.bom_number}, the person who created it, or an admin can edit its details.")
    return None


def check_bom_manage_draft(user: User, bom: DesignBom, rev: DesignBomRevision) -> Denied | None:
    if bom.status == "obsolete":
        return Denied(409, f"{bom.bom_number} is obsolete — reactivate it before working on {rev.revision_label}.")
    if rev.status != "draft":
        hint = (
            " Recall it to draft first if you need to change something."
            if rev.status in ("in_review", "in_approval")
            else " Start a new revision to change it — a released BOM is what Purchase buys and Production builds, so it's never edited."
        )
        return Denied(409, f"{bom_ref(bom, rev)} is {_phrase(rev)}, so it can't be changed.{hint}")
    if not (_is_manager(user, bom) or user.id == rev.created_by_id):
        return Denied(403, f"Only the author of {bom_ref(bom, rev)}, the BOM owner, or an admin can change this draft.")
    return None


def check_bom_recall(user: User, bom: DesignBom, rev: DesignBomRevision) -> Denied | None:
    if rev.status not in ("in_review", "in_approval"):
        return Denied(409, f"{bom_ref(bom, rev)} is {_phrase(rev)} — only a revision in review or awaiting approval can be recalled.")
    if not (_is_manager(user, bom) or user.id == rev.created_by_id):
        return Denied(403, f"Only the author of {bom_ref(bom, rev)}, the BOM owner, or an admin can recall it.")
    return None


def check_bom_review(user: User, bom: DesignBom, rev: DesignBomRevision) -> Denied | None:
    if rev.status != "in_review":
        return Denied(409, f"{bom_ref(bom, rev)} is {_phrase(rev)}, not in review — there's nothing to check right now.")
    if user.id == rev.created_by_id:
        return Denied(403, f"You wrote {bom_ref(bom, rev)}, so you can't check it yourself.")
    if user.id == rev.approver_id:
        return Denied(403, f"You're the named approver of {bom_ref(bom, rev)}, so you can't also be its checker.")
    if user.id != rev.reviewer_id and not is_admin(user):
        return Denied(403, f"{bom_ref(bom, rev)} is with its named checker — only they or an admin can pass or return it.")
    return None


def check_bom_approve(user: User, bom: DesignBom, rev: DesignBomRevision) -> Denied | None:
    if rev.status != "in_approval":
        return Denied(409, f"{bom_ref(bom, rev)} is {_phrase(rev)}, not awaiting approval — there's nothing to release right now.")
    if user.id == rev.created_by_id:
        return Denied(403, f"You wrote {bom_ref(bom, rev)}, so you can't release it yourself.")
    if user.id == rev.reviewed_by_id:
        return Denied(403, f"You checked {bom_ref(bom, rev)}, so the release has to come from someone else.")
    if user.id != rev.approver_id and not is_admin(user):
        return Denied(403, f"{bom_ref(bom, rev)} is waiting on its named approver — only they or an admin can release or return it.")
    return None


def check_bom_new_revision(user: User, bom: DesignBom) -> Denied | None:
    if bom.status == "obsolete":
        return Denied(409, f"{bom.bom_number} is obsolete — an admin must reactivate it before it can be revised.")
    current = open_bom_revision(bom)
    if current:
        return Denied(409, f"{bom_ref(bom, current)} is already open ({_phrase(current)}). Finish or discard it first.")
    if not released_bom_revision(bom):
        return Denied(409, f"{bom.bom_number} has no released revision yet — a new revision starts from the released one.")
    return None


def check_bom_discard(user: User, bom: DesignBom, rev: DesignBomRevision) -> Denied | None:
    if rev.status != "draft":
        return Denied(409, f"{bom_ref(bom, rev)} is {_phrase(rev)} — only a draft revision can be discarded.")
    if rev.revision_index == 0 or not bom_ever_released(bom):
        return Denied(409, f"{bom_ref(bom, rev)} is the BOM's first revision — delete the BOM instead.")
    if not (_is_manager(user, bom) or user.id == rev.created_by_id):
        return Denied(403, f"Only the author of {bom_ref(bom, rev)}, the BOM owner, or an admin can discard it.")
    return None


def check_bom_obsolete(user: User, bom: DesignBom) -> Denied | None:
    if bom.status == "obsolete":
        return Denied(409, f"{bom.bom_number} is already obsolete.")
    if not bom_ever_released(bom):
        return Denied(409, f"{bom.bom_number} was never released — delete it instead.")
    current = open_bom_revision(bom)
    if current:
        return Denied(409, f"{bom_ref(bom, current)} is still open. Recall and discard it before marking the BOM obsolete.")
    if not (is_admin(user) or user.id == bom.owner_id):
        return Denied(403, f"Only the owner of {bom.bom_number} or an admin can mark it obsolete.")
    return None


def check_bom_delete(user: User, bom: DesignBom) -> Denied | None:
    if bom_ever_released(bom):
        return Denied(409, f"{bom.bom_number} has been released, so it's a controlled record and can't be deleted. Mark it obsolete instead.")
    current = open_bom_revision(bom)
    if current and current.status != "draft":
        return Denied(409, f"{bom_ref(bom, current)} is {_phrase(current)}. Recall it to draft before deleting the BOM.")
    if not _is_manager(user, bom):
        return Denied(403, f"Only the owner of {bom.bom_number}, the person who created it, or an admin can delete it.")
    return None


def allowed_bom_actions(user: User, bom: DesignBom, *, viewer: bool = False) -> list[str]:
    actions: list[str] = ["comment", "raise_ecr", "export"]
    if viewer:
        return actions
    if not check_bom_edit(user, bom):
        actions.append("edit")
    if not check_bom_new_revision(user, bom):
        actions.append("new_revision")
    if not check_bom_obsolete(user, bom):
        actions.append("obsolete")
    if bom.status == "obsolete" and is_admin(user):
        actions.append("reactivate")
    if not check_bom_delete(user, bom) and may_delete(user, bom, "boms"):
        actions.append("delete")
    current = open_bom_revision(bom)
    if current:
        if not check_bom_manage_draft(user, bom, current):
            actions += ["edit_revision", "submit"]
        if not check_bom_discard(user, bom, current) and may_delete(user, current, "boms"):
            actions.append("discard_revision")
        if not check_bom_recall(user, bom, current):
            actions.append("recall")
        if current.status == "in_review" and not check_bom_review(user, bom, current):
            actions.append("review")
        if current.status == "in_approval" and not check_bom_approve(user, bom, current):
            actions.append("approve")
    return actions


# ---------------------------------------------------------------------------
# Release blockers
# ---------------------------------------------------------------------------

def line_blockers(db: Session, lines: list[DesignBomLine]) -> dict[int, str]:
    """line id → why it blocks release. Empty dict = releasable."""
    item_ids = {line.store_item_id for line in lines if line.store_item_id}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    doc_ids = {line.document_id for line in lines if line.document_id}
    docs = {
        d.id: d for d in db.query(DesignDocument).filter(DesignDocument.id.in_(doc_ids)).all()
    } if doc_ids else {}
    out: dict[int, str] = {}
    for line in lines:
        label = f"Line {line.position}"
        if not line.store_item_id:
            out[line.id] = f"{label} ({line.new_item_name or 'new item'}) has no item code yet — Store must create it and the line must be linked to it."
            continue
        item = items.get(line.store_item_id)
        if not item:
            out[line.id] = f"{label}: item #{line.store_item_id} no longer exists in Item Master."
            continue
        if item.status != "active":
            out[line.id] = f"{label}: {item.item_code} is {item.status} in Item Master — pick an active item or ask Store to reactivate it."
            continue
        if line.document_id:
            doc = docs.get(line.document_id)
            if not doc or doc.is_deleted:
                out[line.id] = f"{label}: its drawing was deleted — link the right drawing or clear it."
            elif doc.status == "obsolete":
                out[line.id] = f"{label}: drawing {doc.doc_number} is obsolete — link its replacement."
            elif not released_revision(doc):
                out[line.id] = f"{label}: drawing {doc.doc_number} has no released revision yet — release it first."
    return out


def snapshot_drawing_revisions(db: Session, lines: list[DesignBomLine]) -> None:
    """At release, freeze which drawing revision each line was built to."""
    doc_ids = {line.document_id for line in lines if line.document_id}
    if not doc_ids:
        return
    docs = {
        d.id: d for d in db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(DesignDocument.id.in_(doc_ids)).all()
    }
    for line in lines:
        doc = docs.get(line.document_id)
        released = released_revision(doc) if doc else None
        line.document_revision_label = released.revision_label if released else None
