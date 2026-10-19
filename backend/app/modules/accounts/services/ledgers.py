"""Automatic account determination — which ledger a system posting uses."""
from sqlalchemy.orm import Session

from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.settings import AccountDetermination, LEDGER_ROLES


def ledger_for(db: Session, role: str) -> GLAccount:
    """The ledger configured for `role`, else the seeded default code.
    Raises ValueError naming the role and where to fix it."""
    if role not in LEDGER_ROLES:
        raise ValueError(f"Unknown ledger role '{role}'.")
    default_code, label = LEDGER_ROLES[role]
    row = db.query(AccountDetermination).filter(AccountDetermination.role == role).first()
    account = None
    if row and row.gl_account_id:
        account = db.query(GLAccount).filter(GLAccount.id == row.gl_account_id).first()
    if not account:
        account = db.query(GLAccount).filter(GLAccount.code == default_code).first()
    if not account:
        raise ValueError(
            f"No ledger is set for '{label}' and the default code {default_code} doesn't exist. "
            f"Pick one under Finance > Masters > Ledger Settings."
        )
    if account.status != "active":
        raise ValueError(
            f"The ledger set for '{label}' ({account.code} — {account.name}) is inactive. "
            f"Re-activate it or pick another under Finance > Masters > Ledger Settings."
        )
    return account


def ledger_id_for(db: Session, role: str) -> int:
    return ledger_for(db, role).id
