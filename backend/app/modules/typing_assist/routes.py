"""Typing assist (read-only): /typing-assist/vocabulary and /typing-assist/similar.

Vocabulary: any signed-in user may call it; each source is added only when the
user may view that module (see service.py), so an empty source set returns empty
lists. Similar: the same permission and data scope as the module's own list.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.typing_assist import service

router = APIRouter(prefix="/typing-assist", tags=["Typing assist"])


@router.get("/vocabulary")
def vocabulary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Words and word pairs from the names this user may already see."""
    return service.get_vocabulary(db, user)


@router.get("/similar")
def similar(
    kind: str = Query(..., description="item | vendor | organization | machine"),
    q: str = Query("", description="What was typed; at least 3 characters"),
    limit: int = Query(5, description="At most 10"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Records whose name looks like `q` (typos, word order, legal-form words)."""
    if kind not in service.KINDS:
        raise HTTPException(
            status_code=422,
            detail=f"'{kind}' isn't a kind typing assist can look up. Use one of: {', '.join(service.KINDS)}.",
        )
    return service.similar_records(db, user, kind, q, limit)
