"""Shared test helper: seed stock straight through the ledger.

Free-form manual stock posting (POST /store/stock/transactions and
/store/stock/entries) was removed on 2026-10-12 (SAP standard — every goods
movement has its own document). Tests that only need stock to exist as
setup post an opening-stock row through the ledger service, the same row
the admin-only Opening Stock Import writes."""
from app.modules.store.services.stock_ledger import post_stock_transaction


def seed_opening_stock(db, item_id, location_id, qty, *, created_by_id=None, unit_cost=None, batch_number=None,
                       reference_number="OPENING-TEST", remarks="test seed", transaction_date=None, commit=True):
    txn = post_stock_transaction(
        db, item_id=item_id, location_id=location_id, transaction_type="manual_in", entry_type="opening_stock",
        quantity=qty, batch_number=batch_number, reference_type="opening_stock", reference_number=reference_number,
        transaction_date=transaction_date, remarks=remarks, created_by_id=created_by_id,
        unit_cost=unit_cost, cost_source="opening" if unit_cost is not None else None,
    )
    if commit:
        db.commit()
    return txn


def client_db():
    """The session the test client's get_db override hands out (conftest)."""
    from app.db.session import get_db
    from app.main import app
    return app.dependency_overrides[get_db]()
