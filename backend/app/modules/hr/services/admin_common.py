"""Shared helpers for the HR administration services (assets, visitors,
travel, expense claims): batch name lookups for response DTOs and a few
validation helpers whose error messages say what is wrong and how to fix it.
"""
from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch


def users_by_id(db: Session, ids: Iterable[int | None]) -> dict[int, User]:
    """One query for every user id referenced by a page of records."""
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {u.id: u for u in db.query(User).filter(User.id.in_(wanted)).all()}


def branches_by_id(db: Session, ids: Iterable[int | None]) -> dict[int, Branch]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {b.id: b for b in db.query(Branch).filter(Branch.id.in_(wanted)).all()}


def display_name(user: User | None) -> str | None:
    if not user:
        return None
    return user.name or user.email


def require_active_user(db: Session, user_id: int, role: str = "employee") -> User:
    """Fetch a user that a record is being pointed at (holder, host...)."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(
            status_code=404,
            detail=f"The selected {role} (user #{user_id}) does not exist. Pick someone from the list again.",
        )
    if not target.is_active:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{display_name(target)} is marked inactive, so they cannot be chosen as the {role}. "
                "Pick an active employee, or ask an admin to reactivate the account."
            ),
        )
    return target


def require_branch(db: Session, branch_id: int | None) -> None:
    if branch_id is None:
        return
    if not db.query(Branch.id).filter(Branch.id == branch_id).first():
        raise HTTPException(
            status_code=404,
            detail=f"Plant #{branch_id} does not exist. Pick a plant from the list, or leave it blank.",
        )


def require_choice(value: str | None, allowed: tuple[str, ...], field: str) -> None:
    if value is None:
        return
    if value not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"'{value}' is not a valid {field}. Use one of: {', '.join(allowed)}.",
        )


def require_sharepoint(site_id: str | None) -> str:
    if not site_id:
        raise HTTPException(
            status_code=503,
            detail=(
                "File storage (SharePoint) is not configured on this server, so files cannot be uploaded or opened. "
                "Ask the portal admin to set SHAREPOINT_SITE_ID in the backend settings."
            ),
        )
    return site_id
