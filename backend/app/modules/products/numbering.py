"""Product codes: one running number per product type — 01, 02 … 99, 100 …
(owner, 2026-11-12). Rail-road vehicle 01 and Application 01 are different
products, so a code is always shown next to its type.

The last number issued per type is kept in accounts_number_series
("PRODUCTS/<type>"), so a deleted product's number is never handed out again."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.accounts.models.settings import NumberSeries
from app.modules.products.models.product import FinishedProduct
from app.modules.store.service import _lock_number_series


def series_key(product_type: str) -> str:
    return f"PRODUCTS/{product_type}"


def _floor(db: Session, product_type: str) -> int:
    """Highest number used in this type: the counter, or a higher plain-number code already on a product."""
    last = db.query(NumberSeries.last_number).filter(NumberSeries.series_key == series_key(product_type)).scalar() or 0
    codes = db.query(FinishedProduct.code).filter(FinishedProduct.product_type == product_type).all()
    return max([last] + [int(c) for (c,) in codes if c and c.isascii() and c.isdigit()])


def preview_code(db: Session, product_type: str) -> str:
    """The code the next product of this type would get (not reserved)."""
    return f"{_floor(db, product_type) + 1:02d}"


def next_code(db: Session, product_type: str) -> str:
    """Take the next number of this type. Advisory lock + row lock, so two saves never draw the same number."""
    key = series_key(product_type)
    _lock_number_series(db, key)
    series = db.query(NumberSeries).filter(NumberSeries.series_key == key).with_for_update().first()
    if not series:
        series = NumberSeries(series_key=key, last_number=0)
        db.add(series)
    series.last_number = _floor(db, product_type) + 1
    db.flush()
    return f"{series.last_number:02d}"
