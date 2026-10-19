"""Which ledger a purchase / sale of an item books to (account determination).

Order: the item's own ledger → its category's ledger → Finance's default
purchase / sales ledger (Ledger Settings). This is SAP's valuation-class idea:
Finance sets one ledger per category ("Purchase — Raw Material",
"Purchase — Consumables", fixed-asset account for Assets), and only the odd
item overrides it. Accounts calls `item_ledger()` to default an invoice line.
"""
from sqlalchemy.orm import Session

from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.services.ledgers import ledger_for
from app.modules.store.models.category import StoreItemCategory
from app.modules.store.models.item import StoreItem

# purpose → (item / category column, Finance ledger role, allowed account types)
LEDGER_PURPOSES: dict[str, tuple[str, str, tuple[str, ...]]] = {
    # Assets are capitalised (balance-sheet asset ledger), everything else is
    # a purchase / expense ledger under periodic inventory (decision D5).
    "purchase": ("purchase_gl_account_id", "purchase_default", ("expense", "asset")),
    "sales": ("sales_gl_account_id", "sales_default", ("revenue",)),
}


def check_item_ledger(db: Session, purpose: str, account_id: int | None) -> int | None:
    """Validate a ledger picked for an item or category. Raises ValueError
    with the reason and the fix."""
    if account_id is None:
        return None
    _col, _role, allowed = LEDGER_PURPOSES[purpose]
    account = db.get(GLAccount, account_id)
    if not account:
        raise ValueError(f"The {purpose} ledger picked no longer exists — reload the page and pick it again.")
    label = f"{account.code} — {account.name}"
    if account.status != "active":
        raise ValueError(f"Ledger {label} is inactive, so nothing can post to it. Pick an active ledger, or ask Finance to re-activate it.")
    if not account.is_posting_account:
        raise ValueError(f"{label} is a group / summary ledger and can't take postings. Pick one of the ledgers under it.")
    if account.account_type not in allowed:
        want = " or ".join("Expense (purchase)" if t == "expense" else "Asset (capital purchase)" if t == "asset" else "Income (sales)" for t in allowed)
        raise ValueError(f"{label} is a {account.account_type} ledger — a {purpose} ledger must be {want}.")
    return account.id


def item_ledger(db: Session, item: StoreItem, purpose: str) -> tuple[GLAccount | None, str]:
    """(ledger, source) for `purpose` ('purchase' / 'sales'). source is
    'item', 'category', 'default' or 'none' (Finance default missing)."""
    col, role, _allowed = LEDGER_PURPOSES[purpose]
    own = getattr(item, col)
    if own:
        account = db.get(GLAccount, own)
        if account:
            return account, "item"
    if item.category:
        cat = (
            db.query(StoreItemCategory)
            .filter(StoreItemCategory.name == item.category, StoreItemCategory.parent_id.is_(None))
            .order_by((StoreItemCategory.item_type == item.item_type).desc())
            .first()
        )
        if cat and getattr(cat, col):
            account = db.get(GLAccount, getattr(cat, col))
            if account:
                return account, "category"
    try:
        return ledger_for(db, role), "default"
    except ValueError:
        return None, "none"


def ledger_label(db: Session, account_id: int | None) -> str | None:
    """'5001 — Purchases' for display, None when unset / missing."""
    if not account_id:
        return None
    account = db.get(GLAccount, account_id)
    return f"{account.code} — {account.name}" if account else None
