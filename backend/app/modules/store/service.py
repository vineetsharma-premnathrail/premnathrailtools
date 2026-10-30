"""Plain-function helpers for the Store module — document number
generation, kept separate from routes so it's easy to unit test. Mirrors
app.modules.p2p.service's locking strategy."""
import re
from datetime import date
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.store.models.material_issue import StoreMaterialIssue
from app.modules.store.models.material_return import StoreMaterialReturn
from app.modules.store.models.stock_transfer import StoreStockTransfer
from app.modules.store.models.stock_adjustment import StoreStockAdjustment
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.models.stock_entry import StoreStockEntry


def _lock_number_series(db: Session, prefix: str) -> None:
    if db.get_bind().dialect.name == "postgresql":  # SQLite (tests) has no advisory locks
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def generate_material_issue_number(db: Session) -> str:
    """MI-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"MI-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreMaterialIssue.issue_number)).filter(
        StoreMaterialIssue.issue_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_stock_transfer_number(db: Session) -> str:
    """ST-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"ST-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreStockTransfer.transfer_number)).filter(
        StoreStockTransfer.transfer_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_stock_adjustment_number(db: Session) -> str:
    """SA-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"SA-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreStockAdjustment.adjustment_number)).filter(
        StoreStockAdjustment.adjustment_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_physical_count_number(db: Session) -> str:
    """PC-[YEAR]-[NUMBER] (physical stock count), sequence scoped per year."""
    from app.modules.store.models.physical_count import StorePhysicalCount

    year = date.today().year
    prefix = f"PC-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StorePhysicalCount.count_number)).filter(StorePhysicalCount.count_number.like(f"{prefix}%")).scalar()
    return f"{prefix}{(int(last.rsplit('-', 1)[-1]) + 1) if last else 1:04d}"


def generate_stock_reservation_number(db: Session) -> str:
    """RES-[YEAR]-[NUMBER], sequence scoped per year. (Not "SR-" — that
    prefix is already used for Service Requests in the ERP module; a
    different table means no functional collision, but a different prefix
    avoids two unrelated docs both showing as "SR-2026-0001" to a user.)"""
    year = date.today().year
    prefix = f"RES-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreStockReservation.reservation_number)).filter(
        StoreStockReservation.reservation_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_material_return_number(db: Session) -> str:
    """MR-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"MR-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreMaterialReturn.return_number)).filter(
        StoreMaterialReturn.return_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


# Item codes are always <TYPE 2>-<CATEGORY 3>-<NNNN> (owner, 2026-10-28), so type
# prefixes are exactly 2 characters and category codes exactly 3.
ITEM_TYPE_PREFIX_LEN = 2
CATEGORY_CODE_LEN = 3


def fixed_length_code(name: str, length: int, taken) -> str:
    """A code of exactly `length` letters/digits made from `name`, not in use
    (`taken(code)` → bool): initials first, then the first letters, then the
    first letter with later letters (ELE, ELC, ELT…), then letter + digits."""
    from itertools import combinations, product
    words = re.findall(r"[A-Z0-9]+", (name or "").upper()) or ["X"]
    joined = "".join(words)
    initials = "".join(w[0] for w in words)
    tried: set[str] = set()

    def candidates():
        if len(words) > 1:
            yield (initials + joined[1:])[:length] if len(initials) < length else initials[:length]
        yield joined[:length]
        for rest in combinations(joined[1:], length - 1):
            yield joined[0] + "".join(rest)
        for digits in product("0123456789", repeat=length - 1):
            yield joined[0] + "".join(digits)
        for chars in product("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", repeat=length):
            yield "".join(chars)

    for code in candidates():
        code = code.ljust(length, "X")
        if code not in tried:
            tried.add(code)
            if not taken(code):
                return code
    raise ValueError(f"No free {length}-character code left for '{name}'.")


# Item codes are one global running number — 01, 02 … 99, 100, 101 … — with
# no type/category part (owner, 2026-10-30). The last number issued is kept in
# accounts_number_series, so a deleted item's number is never handed out again.
ITEM_CODE_SERIES = "STORE/ITEM"


def _item_code_floor(db: Session) -> int:
    """Highest number already used: the series counter, or a plain numeric code
    that is higher (typed by hand or imported before the counter existed)."""
    from app.modules.accounts.models.settings import NumberSeries
    from app.modules.store.models.item import StoreItem

    last = db.query(NumberSeries.last_number).filter(NumberSeries.series_key == ITEM_CODE_SERIES).scalar() or 0
    codes = db.query(StoreItem.item_code).filter(~StoreItem.item_code.like("%-%")).all()
    return max([last] + [int(c) for (c,) in codes if c and c.isdigit()])


def preview_item_code(db: Session) -> str:
    """The code the next item would get (not reserved)."""
    return f"{_item_code_floor(db) + 1:02d}"


def generate_item_code(db: Session) -> str:
    """Next global item number, at least 2 digits (01 … 99, 100 …). Serialized
    with an advisory lock + row lock so two saves never draw the same number."""
    from app.modules.accounts.models.settings import NumberSeries

    _lock_number_series(db, ITEM_CODE_SERIES)
    series = db.query(NumberSeries).filter(NumberSeries.series_key == ITEM_CODE_SERIES).with_for_update().first()
    if not series:
        series = NumberSeries(series_key=ITEM_CODE_SERIES, last_number=0)
        db.add(series)
    series.last_number = _item_code_floor(db) + 1
    db.flush()
    return f"{series.last_number:02d}"


def generate_stock_entry_number(db: Session) -> str:
    """SE-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"SE-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreStockEntry.entry_number)).filter(StoreStockEntry.entry_number.like(f"{prefix}%")).scalar()
    return f"{prefix}{int(last.rsplit('-', 1)[-1]) + 1:04d}" if last else f"{prefix}0001"
