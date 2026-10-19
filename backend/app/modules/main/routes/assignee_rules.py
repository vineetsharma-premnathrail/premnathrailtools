"""Assign-to rules (core/assignee_rules.py): what the current user may pick
in one "Assign to" field — for pickers fed by a generic user list, which the
frontend narrows with this (useAssigneeFilter). The server still checks on save."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.assignee_rules import allowed_payload
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user

router = APIRouter(prefix="/assignee-rules", tags=["Role & Permissions"])


@router.get("/allowed")
async def allowed(key: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return allowed_payload(db, user, key)
