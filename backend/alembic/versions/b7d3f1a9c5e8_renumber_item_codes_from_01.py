"""Item Master codes start at 01 (owner, 2026-11-05).

Production's item list started at 935: items 01-934 had been created and deleted
earlier, and the running counter (accounts_number_series STORE/ITEM) never hands a
number out twice, so the import got 935, 936 ... This renumbers the plain-number
item codes to 01, 02, 03 ... in their current order and sets the counter to the last
one, so the next new item continues the series.

Safe by design — it changes NOTHING when:
- the numeric codes already start at 1 (01 exists), e.g. a dev database; or
- any of those items is already on a purchase / store document (PR, RFQ, quotation,
  PO, GRN, vendor invoice, issue, return, transfer, adjustment, count, job work,
  reservation, sales order): those documents and their printed copies carry the old
  code, so renumbering would make paper and portal disagree. The skip is logged.
Links stay intact either way: every table points at store_items.id, never the code.
Codes with letters (old "CN-MEC-0001" style) are not touched.

Data-only; downgrade does nothing (the old numbers are listed in the audit log).

Revision ID: b7d3f1a9c5e8
Revises: e9c4b2a7d1f6
"""
import logging

from alembic import op
import sqlalchemy as sa

revision = "b7d3f1a9c5e8"
down_revision = "e9c4b2a7d1f6"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

SERIES = "STORE/ITEM"
# Tables that hold documents (printed / sent with the item code). Master data that only
# links by id (plant data, prices, valuation, opening stock balance, vendor catalog,
# products, quality plans ...) does not stop the renumbering.
DOCUMENT_TABLES = {
    "rfq_items", "vendor_invoice_lines", "sales_order_lines",
    "store_material_issue_items", "store_material_issues", "store_material_return_items",
    "store_stock_transfer_items", "store_stock_adjustment_items", "store_physical_count_items",
    "store_pre_po_receipt_items", "store_stock_reservations",
    "store_job_work_receipt_components", "store_job_work_receipt_outputs", "store_job_work_receipts",
}


def upgrade() -> None:
    log.info(renumber(op.get_bind()))


def renumber(bind) -> str:
    """Does the work on a connection; returns what happened (also used by a dry run)."""
    rows = bind.execute(sa.text(
        "SELECT id, item_code FROM store_items WHERE item_code ~ '^[0-9]+$' "
        "ORDER BY CAST(item_code AS BIGINT), id")).fetchall()
    if not rows:
        return "Item codes: no numeric item codes — nothing to renumber."
    if int(rows[0][1]) == 1:
        return "Item codes: numeric codes already start at 01 — nothing to renumber."

    ids = [r[0] for r in rows]
    refs = bind.execute(sa.text("""
        SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'store_items' AND ccu.column_name = 'id'
    """)).fetchall()
    for table, column in refs:
        if not (table.startswith("p2p_") or table in DOCUMENT_TABLES):
            continue
        used = bind.execute(sa.text(f'SELECT 1 FROM "{table}" WHERE "{column}" = ANY(:ids) LIMIT 1'), {"ids": ids}).first()
        if used:
            msg = (f"Item codes NOT renumbered: items are already used on documents ({table}). "
                   "Old printed documents would no longer match — left as they are.")
            log.warning(msg)
            return msg

    # Two passes so a new code never collides with an old one still in place.
    for item_id in ids:
        bind.execute(sa.text("UPDATE store_items SET item_code = :c WHERE id = :i"), {"c": f"TMP-RENUM-{item_id}", "i": item_id})
    for n, (item_id, _old) in enumerate(rows, start=1):
        bind.execute(sa.text("UPDATE store_items SET item_code = :c WHERE id = :i"), {"c": f"{n:02d}", "i": item_id})

    last = len(rows)
    updated = bind.execute(sa.text("UPDATE accounts_number_series SET last_number = :n WHERE series_key = :k"),
                           {"n": last, "k": SERIES}).rowcount
    if not updated:
        bind.execute(sa.text("INSERT INTO accounts_number_series (series_key, last_number) VALUES (:k, :n)"),
                     {"k": SERIES, "n": last})

    summary = (f"Item Master codes renumbered from 01 (owner, 2026-11-05): {last} items, "
               f"{rows[0][1]}→01 … {rows[-1][1]}→{last:02d}; next new item gets {last + 1:02d}.")
    bind.execute(sa.text(
        "INSERT INTO audit_logs (entity_type, entity_id, action, module_key, summary, performed_at) "
        "VALUES ('store_item', 0, 'renumbered', 'store', :s, now())"), {"s": summary[:1000]})
    return summary


def downgrade() -> None:
    # Data-only renumbering; the old → new list is in the audit log. Nothing to undo automatically.
    pass
