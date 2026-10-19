"""Review checklists: which checklist applies to a document/BOM, and
recording the checker's answers. Shared by drawing and BOM checks."""
from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.modules.design.models.library import DesignChecklist, DesignReviewResult, DESIGN_CHECK_RESULTS
from app.modules.main.models.user import User


def active_checklist(db: Session, document_type: str, discipline: str | None) -> DesignChecklist | None:
    """The discipline-specific checklist for this type if there is one,
    else the type's general (no discipline) checklist."""
    rows = db.query(DesignChecklist).options(selectinload(DesignChecklist.items)).filter(
        DesignChecklist.document_type == document_type,
        DesignChecklist.is_active == True,  # noqa: E712
        DesignChecklist.is_deleted == False,  # noqa: E712
    ).order_by(DesignChecklist.id.desc()).all()
    specific = next((c for c in rows if discipline and c.discipline == discipline), None)
    return specific or next((c for c in rows if not c.discipline), None)


def record_answers(
    db: Session, checklist: DesignChecklist | None, answers: list, *, decision: str, reviewer: User, cycle: int,
    ref: str, revision_id: int | None = None, bom_revision_id: int | None = None,
) -> None:
    """Saves the answers. Passing needs every item answered and none
    "not OK" — a failed item means the drawing goes back to its author."""
    if not checklist or not checklist.items:
        return
    by_id = {a.checklist_item_id: a for a in answers}
    unknown = set(by_id) - {i.id for i in checklist.items}
    if unknown:
        raise HTTPException(status_code=400, detail=f"Some checklist answers don't belong to the '{checklist.name}' checklist — reload the page and answer again.")
    for a in answers:
        if a.result not in DESIGN_CHECK_RESULTS:
            raise HTTPException(status_code=400, detail=f"'{a.result}' isn't a valid checklist answer. Use OK, Not OK or N/A.")
    if decision == "pass":
        missing = [i.text for i in checklist.items if i.id not in by_id]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Answer every item of the '{checklist.name}' checklist before passing {ref} — {len(missing)} left, starting with: {missing[0]}",
            )
        failed = [i.text for i in checklist.items if by_id[i.id].result == "not_ok"]
        if failed:
            raise HTTPException(
                status_code=400,
                detail=f"{ref} has {len(failed)} checklist item(s) marked Not OK (e.g. \"{failed[0]}\"). Return it to the author instead of passing it.",
            )
    for item in checklist.items:
        answer = by_id.get(item.id)
        if not answer:
            continue
        db.add(DesignReviewResult(
            revision_id=revision_id, bom_revision_id=bom_revision_id, cycle=cycle, checklist_item_id=item.id,
            item_text=item.text, result=answer.result, remark=(answer.remark or "").strip() or None, reviewer_id=reviewer.id,
        ))
