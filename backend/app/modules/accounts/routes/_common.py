"""Small helpers shared by the Accounts routers."""
from contextlib import contextmanager
from datetime import date
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.core.permission_registry import can_view_tab
from app.core.permissions import ensure_tab_action
from app.modules.main.models.audit_log import AuditLog
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.schemas.tax_line import TaxLineResponse


def write_audit(db: Session, entity_type: str, entity_id: int | None, action: str, user: User, summary: str | None = None) -> None:
    db.add(AuditLog(entity_type=entity_type, entity_id=entity_id, action=action, performed_by_id=user.id, summary=summary))


def who(user: User) -> str:
    return user.name or user.email


@contextmanager
def service_errors(db: Session):
    """Maps service exceptions to HTTP: ValueError -> 400 (the message is the
    real reason + fix), PermissionError -> 403 (maker-checker etc.)."""
    try:
        yield
    except PermissionError as e:
        db.rollback()
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


def require_finance_manager(user: User, action: str) -> None:
    if not (user.is_finance_manager or user.role == "admin"):
        raise HTTPException(status_code=403, detail=f"Only a Finance Manager (or admin) can {action}. Ask an admin to tick 'Finance Manager' on your user.")


def user_names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(ids)).all()}


def gl_labels(db: Session, ids) -> dict[int, GLAccount]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(ids)).all()}


def parse_date(value: str | None, name: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"'{value}' isn't a valid {name} — use YYYY-MM-DD.")


def tax_lines_response(db: Session, lines) -> list[TaxLineResponse]:
    gls = gl_labels(db, {l.gl_account_id for l in lines})
    out = []
    for l in sorted(lines, key=lambda x: x.line_number):
        gl = gls.get(l.gl_account_id)
        out.append(TaxLineResponse.model_validate(l).model_copy(update={
            "gl_account_code": gl.code if gl else None, "gl_account_name": gl.name if gl else None}))
    return out


def require_any_accounts_tab(*tabs: str):
    """Dependency: lets through a user who can view ANY of these Finance tabs —
    for one endpoint that several tabs read (e.g. the ledger statement is shown
    on Journals, Bank & Cash and Reports). The 403 names the first tab."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        if not any(can_view_tab(user, "accounts", t) for t in tabs):
            ensure_tab_action(user, "accounts", tabs[0], "view")
        return user

    return _dependency
