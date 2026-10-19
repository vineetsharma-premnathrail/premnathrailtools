"""GL posting under real concurrency — two Postgres transactions racing for
the same document. SQLite has no row locks, so this module runs against a
throwaway database on the developer's Postgres (DATABASE_URL's server) and
is skipped when that server isn't reachable.

Each race: the first transaction does its work and holds its locks for
HOLD seconds before committing; the second starts only after the first's
work is done, so it must wait — the tests assert it did — and then see the
first one's committed result instead of posting again."""
import importlib.util
import threading
import time
import uuid
from datetime import date
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.modules.accounts import access, service
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.models.settings import NumberSeries
from app.modules.accounts.routes.journal_entries import _approval_args
from app.modules.accounts.services import assets, inventory
from app.modules.accounts.services.balances import party_balance
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services import approval_engine as engine
from app.tests.test_cov_controls_finance import _bill, books  # noqa: F401 — `books` is a fixture

HOLD = 1.0
VERSIONS = Path(__file__).resolve().parents[2] / "alembic" / "versions"


def _server_url():
    try:
        url = make_url(settings.database_url)
    except Exception:
        return None
    if not url.drivername.startswith("postgresql"):
        return None
    try:
        probe = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT", connect_args={"connect_timeout": 3})
        with probe.connect():
            pass
        probe.dispose()
    except Exception:
        return None
    return url


SERVER = _server_url()
pytestmark = pytest.mark.skipif(SERVER is None, reason="needs a reachable Postgres server (DATABASE_URL) for row locks")


@pytest.fixture
def pg_engine():
    name = f"prt_gl_race_{uuid.uuid4().hex[:10]}"
    admin = create_engine(SERVER.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    eng = create_engine(SERVER.set(database=name), pool_size=5)
    try:
        Base.metadata.create_all(eng)
        yield eng
    finally:
        eng.dispose()
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture
def db(pg_engine):
    """Overrides conftest's SQLite `db` for this module — `books` builds on it."""
    session = sessionmaker(bind=pg_engine, autoflush=False)()
    yield session
    session.close()


def _race(eng, first, second):
    """Run first(session) and hold its transaction HOLD s, then commit; start
    second(session) once first's work is done. Returns (first_result,
    second_result, seconds_second_waited); an exception is the result."""
    Session = sessionmaker(bind=eng, autoflush=False)
    done = threading.Event()
    out = {}

    def run_first():
        s = Session()
        try:
            out["first"] = first(s)
            done.set()
            time.sleep(HOLD)
            s.commit()
        except Exception as e:  # noqa: BLE001 — the result under test
            out["first"] = e
            s.rollback()
            done.set()
        finally:
            s.close()

    def run_second():
        done.wait(15)
        s = Session()
        t0 = time.monotonic()
        try:
            out["second"] = second(s)
            s.commit()
        except Exception as e:  # noqa: BLE001
            out["second"] = e
            s.rollback()
        finally:
            out["waited"] = time.monotonic() - t0
            s.close()

    threads = [threading.Thread(target=run_first), threading.Thread(target=run_second)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    return out["first"], out["second"], out["waited"]


def _fresh(eng):
    return sessionmaker(bind=eng, autoflush=False)()


def _jv_lines(gl, amount=100):
    return [{"gl_account_id": gl["5200"].id, "debit_amount": amount}, {"gl_account_id": gl["1121"].id, "credit_amount": amount}]


# ── document row lock ───────────────────────────────────────────────────

def test_two_simultaneous_posts_of_one_invoice_post_it_once(pg_engine, books):
    inv = _bill(books, "PS/200", amount=10000)
    inv_id, checker_id, vendor_id = inv.id, books["checker"].id, books["vendor"].id
    post = lambda s: service.post_vendor_invoice(s, vendor_invoice_id=inv_id, created_by_id=checker_id).id  # noqa: E731

    first, second, waited = _race(pg_engine, post, post)

    assert isinstance(first, int), first
    assert isinstance(second, ValueError) and "current status: 'posted'" in str(second), second
    assert waited >= HOLD * 0.8, f"second post didn't wait for the first's lock ({waited:.2f}s)"
    s = _fresh(pg_engine)
    assert s.query(JournalEntry).filter_by(reference_document_type="vendor_invoice", reference_document_id=inv_id).count() == 1
    assert party_balance(s, as_of=date(2026, 12, 31), vendor_id=vendor_id) == -11800.0  # owed once, not twice
    assert s.query(NumberSeries).filter(NumberSeries.series_key.like("PI/%")).one().last_number == 1  # loser burnt no number
    s.close()


def test_two_simultaneous_reversals_reverse_once(pg_engine, books):
    db, gl = books["db"], books["gl"]
    orig = service.post_journal_entry(db, posting_date=date(2026, 7, 1), created_by_id=books["maker"].id, lines=_jv_lines(gl))
    db.commit()
    orig_id, checker_id = orig.id, books["checker"].id
    rev = lambda s: service.reverse_journal_entry(s, journal_entry_id=orig_id, reason="Duplicate",  # noqa: E731
                                                  reversed_by_id=checker_id).id

    first, second, waited = _race(pg_engine, rev, rev)

    assert isinstance(first, int), first
    assert isinstance(second, ValueError) and "Only a posted journal entry can be reversed" in str(second), second
    assert waited >= HOLD * 0.8
    s = _fresh(pg_engine)
    assert s.query(JournalEntry).filter_by(reverses_journal_entry_id=orig_id).count() == 1
    s.close()


# ── approval request row lock ───────────────────────────────────────────

def test_two_approvers_clicking_together_post_the_journal_once(pg_engine, books):
    """'Any one approver' stage, two approvers, same instant: the second
    decision waits for the first and is told it's already decided."""
    db = books["db"]
    checker2 = User(email="cov.checker2@premnathrail.com", name="cov.checker2", role="user", is_active=True,
                    assigned_apps=["accounts"], is_finance_manager=True)
    db.add(checker2)
    db.commit()
    draft = service.create_draft_journal(db, posting_date=date(2026, 7, 15), posting_type="adjustment",
                                         lines=_jv_lines(books["gl"], 5000), created_by_id=books["maker"].id)
    req = access.submit_document(db, access.KEY_JOURNAL, requester=books["maker"], **_approval_args(draft))
    db.commit()
    req_id, je_id, c1, c2 = req.id, draft.id, books["checker"].id, checker2.id

    first, second, waited = _race(
        pg_engine,
        lambda s: engine.decide(s, req_id, s.get(User, c1), "approve").status,
        lambda s: engine.decide(s, req_id, s.get(User, c2), "approve").status,
    )

    assert first == "approved", first
    assert isinstance(second, HTTPException) and second.status_code == 409, second
    assert waited >= HOLD * 0.8
    s = _fresh(pg_engine)
    je = s.get(JournalEntry, je_id)
    assert je.status == "posted" and je.posted_by_id == c1
    assert s.query(JournalEntry).filter(JournalEntry.entry_number.like("JV/%")).count() == 2  # capital + this one
    steps = s.get(ApprovalRequest, req_id).steps
    assert [st.decided_by_id for st in steps if st.status == "approved"] == [c1]
    s.close()


def test_maker_still_cannot_approve_own_journal(pg_engine, books):
    db = books["db"]
    draft = service.create_draft_journal(db, posting_date=date(2026, 7, 15), posting_type="adjustment",
                                         lines=_jv_lines(books["gl"]), created_by_id=books["maker"].id)
    db.commit()
    with pytest.raises(PermissionError, match="another finance user"):
        service.post_draft_journal(db, journal_entry_id=draft.id, posted_by_id=books["maker"].id)
    db.rollback()


# ── database backstop (no lock on this path) ────────────────────────────

def test_index_stops_a_double_posting_even_without_a_lock(pg_engine, books):
    gl, maker_id = books["gl"], books["maker"].id
    lines = _jv_lines(gl)
    post = lambda s: service.post_journal_entry(  # noqa: E731
        s, posting_date=date(2026, 7, 1), lines=lines, posting_type="invoice", created_by_id=maker_id,
        reference_document_type="vendor_invoice", reference_document_id=777).id

    first, second, waited = _race(pg_engine, post, post)

    assert isinstance(first, int), first
    assert isinstance(second, ValueError) and "already been posted" in str(second), second
    assert waited >= HOLD * 0.8, "the unique index should make the second INSERT wait for the first transaction"
    s = _fresh(pg_engine)
    assert s.query(JournalEntry).filter_by(reference_document_type="vendor_invoice", reference_document_id=777).count() == 1
    s.close()


def test_two_simultaneous_depreciation_runs_charge_once(pg_engine, books):
    db, gl = books["db"], books["gl"]
    assets.create_asset(db, created_by_id=books["maker"].id, data={
        "asset_code": "PM-001", "name": "CNC lathe", "asset_gl_account_id": gl["1010"].id, "purchase_date": date(2026, 4, 1),
        "put_to_use_date": date(2026, 4, 16), "cost": 365000, "residual_value": 0, "depreciation_method": "slm",
        "useful_life_months": 120})
    db.commit()
    checker_id = books["checker"].id
    run = lambda s: assets.run_depreciation(s, accounting_period="2026-04", created_by_id=checker_id).id  # noqa: E731

    first, second, waited = _race(pg_engine, run, run)

    assert isinstance(first, int), first
    assert isinstance(second, ValueError) and "Depreciation for 2026-04" in str(second), second
    s = _fresh(pg_engine)
    assert s.query(JournalEntry).filter_by(posting_type="depreciation").count() == 1
    s.close()


# ── the migration on data that already has duplicates ──────────────────

def _load_migration():
    spec = importlib.util.spec_from_file_location("gl_idem", VERSIONS / "b7d3f1a9c2e4_gl_posting_idempotency.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run_upgrade(eng, mig):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    with eng.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mig.upgrade()


def test_migration_retags_cancellations_and_refuses_real_duplicates(pg_engine, books):
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.models.stock_balance import StoreStockBalance
    mig = _load_migration()
    db, gl = books["db"], books["gl"]
    with pg_engine.begin() as conn:  # the database as it was before this migration
        for name, *_ in mig.INDEXES:
            conn.execute(text(f"DROP INDEX {name}"))

    # Legacy closing-stock cancellation: shared its valuation's reference.
    item = StoreItem(item_code="RM-0001", item_name="Steel bar", uom="KG", moving_average_cost=80, category="Raw")
    loc = StoreLocation(name="Main", code="MAIN")
    db.add_all([item, loc])
    db.flush()
    db.add(StoreStockBalance(item_id=item.id, location_id=loc.id, on_hand_qty=100))
    # Closing stock is rebuilt from the ledger as at period end (MB5B) — seed the receipt row too.
    from app.modules.store.models.stock_transaction import StoreStockTransaction
    db.add(StoreStockTransaction(item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=100,
                                 transaction_date=date(2026, 9, 1)))
    db.commit()
    val = inventory.create_valuation(db, accounting_period="2026-09", created_by_id=books["maker"].id)
    inventory.post_valuation(db, valuation_id=val.id, posted_by_id=books["checker"].id)
    inventory.cancel_valuation(db, valuation_id=val.id, user_id=books["checker"].id, reason="Wrong rates")
    db.commit()
    db.execute(text("UPDATE journal_entries SET reference_document_type = 'inventory_valuation' "
                    "WHERE reference_document_type = 'inventory_valuation_cancel'"))
    # A real double posting of one bill.
    dup = [service.post_journal_entry(db, posting_date=date(2026, 7, 1), lines=_jv_lines(gl), posting_type="invoice",
                                      created_by_id=books["maker"].id, reference_document_type="vendor_invoice",
                                      reference_document_id=55) for _ in range(2)]
    db.commit()

    with pytest.raises(RuntimeError) as err:
        _run_upgrade(pg_engine, mig)
    msg = str(err.value)
    assert "uq_je_one_posting_per_document" in msg and dup[0].entry_number in msg and dup[1].entry_number in msg
    assert "inventory_valuation" not in msg  # the cancellation is not reported as a duplicate

    # The remedy the message gives: reverse the extra voucher, deploy again.
    service.reverse_journal_entry(db, journal_entry_id=dup[1].id, reason="Double posting", reversed_by_id=books["checker"].id)
    db.commit()
    _run_upgrade(pg_engine, mig)

    s = _fresh(pg_engine)
    names = set(s.execute(text("SELECT indexname FROM pg_indexes WHERE indexname LIKE 'uq_je_%' "
                               "OR indexname LIKE 'uq_depreciation_run_%'")).scalars())
    assert names == {n for n, *_ in mig.INDEXES}
    tags = s.execute(text("SELECT reference_document_type FROM journal_entries WHERE reference_document_id = :v "
                          "AND reference_document_type LIKE 'inventory_valuation%' AND reverses_journal_entry_id IS NULL "
                          "ORDER BY id"), {"v": val.id}).scalars().all()
    assert tags == ["inventory_valuation", inventory.CANCEL_REFERENCE]
    s.close()
