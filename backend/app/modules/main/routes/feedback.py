from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.feedback import Feedback
from app.modules.main.routes.auth import get_current_user
from app.modules.main.routes.users import require_admin
from app.modules.main.schemas.feedback import FeedbackCreate, FeedbackResponse

router = APIRouter(prefix="/feedback", tags=["Feedback"])


def _to_response(feedback: Feedback, author: User | None) -> FeedbackResponse:
    return FeedbackResponse(
        id=feedback.id,
        user_id=feedback.user_id,
        user_name=author.name if author else "Unknown user",
        user_email=author.email if author else "",
        message=feedback.message,
        is_read=feedback.is_read,
        created_at=feedback.created_at,
    )


@router.post("", response_model=FeedbackResponse, status_code=201)
async def submit_feedback(
    payload: FeedbackCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    feedback = Feedback(user_id=user.id, message=payload.message)
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return _to_response(feedback, user)


@router.get("/unread-count")
async def get_unread_count(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    count = db.query(Feedback).filter(Feedback.is_read == False).count()  # noqa: E712
    return {"count": count}


@router.get("", response_model=list[FeedbackResponse])
async def list_feedback(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    # Unread first (newest-unread first), then read entries newest-first —
    # this keeps every unread row within the limit below, so the
    # unread-count badge can never exceed what's visible here.
    entries = (
        db.query(Feedback)
        .order_by(Feedback.is_read.asc(), Feedback.created_at.desc())
        .limit(100)
        .all()
    )
    authors = {u.id: u for u in db.query(User).filter(User.id.in_({e.user_id for e in entries})).all()}
    return [_to_response(e, authors.get(e.user_id)) for e in entries]


@router.patch("/{feedback_id}/read", response_model=FeedbackResponse)
async def mark_as_read(
    feedback_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if not feedback.is_read:
        feedback.is_read = True
        feedback.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(feedback)
    author = db.query(User).filter(User.id == feedback.user_id).first()
    return _to_response(feedback, author)
