"""Finance: GL posting idempotency backstops (2026-10-13).

Two approvers clicking Approve on the same document at the same moment could
both see it 'pending' and both post it. The service layer now row-locks the
document (and the approval request) before posting; these partial unique
indexes make a double posting impossible even on a path that forgets to:

  uq_je_one_posting_per_document   one live original journal per business
                                   document (reversals carry
                                   reverses_journal_entry_id and are excluded;
                                   a reversed original no longer counts)
  uq_je_one_reversal_per_entry     a journal has at most one live reversal

"Live" = status draft or posted: a journal is INSERTed as 'draft' and flipped
to 'posted' in the same transaction, so the indexes must hold from the INSERT.
  uq_je_one_year_end_per_fy        one live year-end close per FY end date
  uq_je_one_gst_setoff_per_period  one live GST set-off per month
  uq_je_one_opening                one live opening-balance voucher
  uq_depreciation_run_one_posted_per_period

The only legitimate second original was the closing-stock *cancellation*
entry, which shared its valuation's reference. It is re-tagged
'inventory_valuation_cancel' here (and posted that way from now on).

Any other duplicate is a real double posting: the upgrade stops and lists
the vouchers instead of hiding them. Reverse the duplicate voucher(s), then
re-run the deploy.

Revision ID: b7d3f1a9c2e4
Revises: e2a6c4d8f9b1
Create Date: 2026-10-13
"""
from alembic import op
import sqlalchemy as sa

revision = "b7d3f1a9c2e4"
down_revision = "e2a6c4d8f9b1"
branch_labels = None
depends_on = None

_LIVE = "status IN ('draft', 'posted')"
_JE_ORIGINAL = f"reference_document_id IS NOT NULL AND reverses_journal_entry_id IS NULL AND {_LIVE}"
_JE_REVERSAL = f"reverses_journal_entry_id IS NOT NULL AND {_LIVE}"
# A reversal keeps its original's posting_type, so the process indexes exclude reversals too.
_LIVE_ORIGINAL = f"reverses_journal_entry_id IS NULL AND {_LIVE}"

# (index name, table, columns, partial predicate)
INDEXES = [
    ("uq_je_one_posting_per_document", "journal_entries", ["reference_document_type", "reference_document_id"], _JE_ORIGINAL),
    ("uq_je_one_reversal_per_entry", "journal_entries", ["reverses_journal_entry_id"], _JE_REVERSAL),
    ("uq_je_one_year_end_per_fy", "journal_entries", ["posting_date"], f"posting_type = 'year_end' AND {_LIVE_ORIGINAL}"),
    ("uq_je_one_gst_setoff_per_period", "journal_entries", ["accounting_period"], f"posting_type = 'gst_setoff' AND {_LIVE_ORIGINAL}"),
    ("uq_je_one_opening", "journal_entries", ["posting_type"], f"posting_type = 'opening' AND {_LIVE_ORIGINAL}"),
    ("uq_depreciation_run_one_posted_per_period", "accounts_depreciation_runs", ["accounting_period"], "status = 'posted'"),
]

_RETAG_CANCELLATIONS = """
    UPDATE journal_entries je SET reference_document_type = 'inventory_valuation_cancel'
    WHERE je.reference_document_type = 'inventory_valuation' AND je.reverses_journal_entry_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM inventory_valuations v WHERE v.journal_entry_id = je.id)
"""


def duplicate_report(conn) -> list[str]:
    """One line per group of rows that would break an index — empty when the
    data is clean. Shared with the tests."""
    out = []
    for name, table, cols, where in INDEXES:
        label = "entry_number" if table == "journal_entries" else "id"
        col_list = ", ".join(cols)
        rows = conn.execute(sa.text(
            f"SELECT {col_list}, COUNT(*) AS n, STRING_AGG(CAST({label} AS TEXT), ', ' ORDER BY id) AS which "
            f"FROM {table} WHERE {where} GROUP BY {col_list} HAVING COUNT(*) > 1"
        )).mappings().all()
        for r in rows:
            key = ", ".join(f"{c}={r[c]}" for c in cols)
            out.append(f"{name}: {key} has {r['n']} rows ({label}: {r['which']})")
    return out


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(_RETAG_CANCELLATIONS))
    problems = duplicate_report(conn)
    if problems:
        raise RuntimeError(
            "GL posting idempotency: the books already contain double postings, so the unique indexes can't be "
            "created. Reverse the extra voucher(s) below (Finance > Journals > Reverse, or cancel the duplicate "
            "document), then deploy again:\n  " + "\n  ".join(problems)
        )
    for name, table, cols, where in INDEXES:
        op.create_index(name, table, cols, unique=True, postgresql_where=sa.text(where), sqlite_where=sa.text(where))


def downgrade() -> None:
    for name, table, _cols, _where in reversed(INDEXES):
        op.drop_index(name, table_name=table)
    op.execute("UPDATE journal_entries SET reference_document_type = 'inventory_valuation' "
               "WHERE reference_document_type = 'inventory_valuation_cancel'")
