"""P2P multi-buyer split: RFQ per buyer with its own line set, qty-split awards, short-close, several POs per RFQ.

Schema (reversible)
  * rfqs.buyer_id (FK users, SET NULL) + indexes ix_rfqs_buyer_id, ix_rfqs_p2p_request_id_buyer_id.
  * rfq_items (new): the PR lines each RFQ asks quotes for; unique (rfq_id, pr_item_id); soft
    withdraw via withdrawn_at / withdrawn_reason.
  * p2p_vendor_quotation_items.awarded_qty (nullable): qty awarded to a vendor on a line.
  * p2p_request_items.short_closed_qty (NOT NULL, server default 0), short_closed_reason,
    short_closed_by_id (FK users, SET NULL), short_closed_at.
  * p2p_purchase_orders.rfq_id (FK rfqs, SET NULL) + ix_p2p_purchase_orders_rfq_id.
  * uq_p2p_po_live_external_ref: unique on upper(external_ref) for live POs (status <> 'cancelled').
    Created ONLY when no duplicate exists; otherwise a notice is logged and the index is skipped,
    so the deploy never fails on old data.

Data (set-based, idempotent; each step logs its row count; not reversed by downgrade except the
new tables / columns disappearing)
  1 rfqs.buyer_id = COALESCE(PR assigned buyer, RFQ creator) where empty.
  2 rfq_items: every RFQ gets its PR's buy lines (not stock-issued, qty - issued > 0, quantity =
    that remainder) plus any line it already has a quotation for. ON CONFLICT DO NOTHING.
  3 awarded_qty = quote line quantity (fallback: line buy qty) where is_awarded.
  4 p2p_purchase_orders.rfq_id from its quotation's RFQ, else the PR's only RFQ.
  5 p2p_request_items.buyer_id = PR assigned buyer where empty and the PR is past approval.

No table is dropped and no column is dropped on upgrade. The new NOT NULL column has a server
default. On an empty / fresh database every data step finds nothing and does nothing (the
baseline create_all() already made the final shape, so each schema step checks first).

Revision ID: e7a1c3d5b9f2
Revises: d0f4d65f9d55
Create Date: 2026-10-31
"""
import logging

from alembic import op
import sqlalchemy as sa

revision = "e7a1c3d5b9f2"
down_revision = "d0f4d65f9d55"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

TALLY_INDEX = "uq_p2p_po_live_external_ref"


# ---------------------------------------------------------------- helpers
def _insp():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return _insp().has_table(table)


def _columns(table: str) -> dict:
    return {c["name"]: c for c in _insp().get_columns(table)}


def _index_names(table: str) -> set:
    return {i["name"] for i in _insp().get_indexes(table)}


def _add_column(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column)


def _drop_column(table: str, name: str) -> None:
    if _has_table(table) and name in _columns(table):
        op.drop_column(table, name)


def _create_index(name: str, table: str, cols: list) -> None:
    if name not in _index_names(table):
        op.create_index(name, table, cols)


def _drop_index(name: str, table: str) -> None:
    if _has_table(table) and name in _index_names(table):
        op.drop_index(name, table_name=table)


# ---------------------------------------------------------------- schema
def _schema() -> None:
    # rfqs.buyer_id
    _add_column("rfqs", sa.Column("buyer_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    _create_index("ix_rfqs_buyer_id", "rfqs", ["buyer_id"])
    _create_index("ix_rfqs_p2p_request_id_buyer_id", "rfqs", ["p2p_request_id", "buyer_id"])

    # rfq_items
    if not _has_table("rfq_items"):
        op.create_table(
            "rfq_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("rfq_id", sa.Integer(), sa.ForeignKey("rfqs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("pr_item_id", sa.Integer(), sa.ForeignKey("p2p_request_items.id"), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("withdrawn_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("rfq_id", "pr_item_id", name="uq_rfq_items_rfq_pr_item"),
        )
    _create_index("ix_rfq_items_pr_item_id", "rfq_items", ["pr_item_id"])
    _create_index("ix_rfq_items_store_item_id", "rfq_items", ["store_item_id"])

    # award quantity
    _add_column("p2p_vendor_quotation_items", sa.Column("awarded_qty", sa.Float(), nullable=True))

    # short-close on PR lines
    _add_column("p2p_request_items", sa.Column("short_closed_qty", sa.Float(), nullable=False, server_default="0"))
    _add_column("p2p_request_items", sa.Column("short_closed_reason", sa.Text(), nullable=True))
    _add_column("p2p_request_items", sa.Column(
        "short_closed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    _add_column("p2p_request_items", sa.Column("short_closed_at", sa.DateTime(timezone=True), nullable=True))

    # PO -> RFQ
    _add_column("p2p_purchase_orders", sa.Column(
        "rfq_id", sa.Integer(), sa.ForeignKey("rfqs.id", ondelete="SET NULL"), nullable=True))
    _create_index("ix_p2p_purchase_orders_rfq_id", "p2p_purchase_orders", ["rfq_id"])


# ---------------------------------------------------------------- data
def _step(label: str, bind, sql: str) -> None:
    n = bind.execute(sa.text(sql)).rowcount
    log.info("%s: %s row(s)", label, n)


def _backfill(bind) -> None:
    # 1. buyer of each RFQ
    _step("rfqs.buyer_id", bind, """
        UPDATE rfqs r
           SET buyer_id = COALESCE(pr.assigned_buyer_id, r.created_by_id)
          FROM p2p_requests pr
         WHERE pr.id = r.p2p_request_id
           AND r.buyer_id IS NULL
           AND COALESCE(pr.assigned_buyer_id, r.created_by_id) IS NOT NULL
    """)

    # 2a. every RFQ gets its PR's buy lines (remaining qty after store issue)
    _step("rfq_items (buy lines)", bind, """
        INSERT INTO rfq_items (rfq_id, pr_item_id, store_item_id, quantity)
        SELECT r.id, i.id, i.store_item_id, i.quantity - COALESCE(i.issued_qty, 0)
          FROM rfqs r
          JOIN p2p_request_items i ON i.p2p_request_id = r.p2p_request_id
         WHERE i.fulfillment_status <> 'stock_issued'
           AND i.quantity - COALESCE(i.issued_qty, 0) > 0
        ON CONFLICT (rfq_id, pr_item_id) DO NOTHING
    """)

    # 2b. plus any line the RFQ already holds a quotation for (even if no longer a buy line)
    _step("rfq_items (quoted lines)", bind, """
        INSERT INTO rfq_items (rfq_id, pr_item_id, store_item_id, quantity)
        SELECT DISTINCT ON (vq.rfq_id, vqi.pr_item_id)
               vq.rfq_id, vqi.pr_item_id, COALESCE(vqi.store_item_id, i.store_item_id),
               COALESCE(NULLIF(i.quantity - COALESCE(i.issued_qty, 0), 0), vqi.quantity, i.quantity)
          FROM p2p_vendor_quotation_items vqi
          JOIN p2p_vendor_quotations vq ON vq.id = vqi.vendor_quotation_id
          JOIN p2p_request_items i ON i.id = vqi.pr_item_id
         ORDER BY vq.rfq_id, vqi.pr_item_id, vqi.id
        ON CONFLICT (rfq_id, pr_item_id) DO NOTHING
    """)

    # 3. awarded qty
    _step("awarded_qty", bind, """
        UPDATE p2p_vendor_quotation_items vqi
           SET awarded_qty = COALESCE(vqi.quantity,
                                      NULLIF(i.quantity - COALESCE(i.issued_qty, 0), 0),
                                      i.quantity)
          FROM p2p_request_items i
         WHERE i.id = vqi.pr_item_id
           AND vqi.is_awarded
           AND vqi.awarded_qty IS NULL
    """)

    # 4. PO -> RFQ: via its quotation first, else the PR's only RFQ
    _step("p2p_purchase_orders.rfq_id (via quotation)", bind, """
        UPDATE p2p_purchase_orders po
           SET rfq_id = vq.rfq_id
          FROM p2p_vendor_quotations vq
         WHERE vq.id = po.vendor_quotation_id
           AND po.rfq_id IS NULL
    """)
    _step("p2p_purchase_orders.rfq_id (PR's only RFQ)", bind, """
        UPDATE p2p_purchase_orders po
           SET rfq_id = only_rfq.rfq_id
          FROM (SELECT p2p_request_id, MIN(id) AS rfq_id
                  FROM rfqs
                 GROUP BY p2p_request_id
                HAVING COUNT(*) = 1) only_rfq
         WHERE only_rfq.p2p_request_id = po.p2p_request_id
           AND po.rfq_id IS NULL
    """)

    # 5. line buyer for PRs already past approval
    _step("p2p_request_items.buyer_id", bind, """
        UPDATE p2p_request_items i
           SET buyer_id = pr.assigned_buyer_id
          FROM p2p_requests pr
         WHERE pr.id = i.p2p_request_id
           AND i.buyer_id IS NULL
           AND pr.assigned_buyer_id IS NOT NULL
           AND pr.status NOT IN ('draft', 'submitted', 'returned')
    """)


def _tally_index(bind) -> None:
    """One live PO per Tally / external PO number (case-insensitive). Never fails the deploy:
    if old data already holds duplicates the index is skipped and the duplicates are logged."""
    if not _has_table("p2p_purchase_orders") or "external_ref" not in _columns("p2p_purchase_orders"):
        return
    if TALLY_INDEX in _index_names("p2p_purchase_orders"):
        return
    dups = bind.execute(sa.text("""
        SELECT UPPER(external_ref) AS ref, COUNT(*) AS n
          FROM p2p_purchase_orders
         WHERE status <> 'cancelled' AND external_ref IS NOT NULL
         GROUP BY UPPER(external_ref)
        HAVING COUNT(*) > 1
         ORDER BY 1
    """)).all()
    if dups:
        print("NOTICE: index %s NOT created - %s external PO number(s) are on more than one live PO: %s. "
              "Cancel or correct the duplicates, then create the index by hand."
              % (TALLY_INDEX, len(dups), ", ".join("%s (x%s)" % (d.ref, d.n) for d in dups[:20])))
        log.warning("index %s skipped: duplicate live external_ref values", TALLY_INDEX)
        return
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS %s ON p2p_purchase_orders (UPPER(external_ref)) "
        "WHERE status <> 'cancelled' AND external_ref IS NOT NULL" % TALLY_INDEX))


# ---------------------------------------------------------------- upgrade / downgrade
def upgrade() -> None:
    bind = op.get_bind()
    _schema()
    _backfill(bind)
    _tally_index(bind)


def downgrade() -> None:
    """Schema only. The back-filled values (RFQ buyers, line buyers on PRs, awarded quantities,
    PO-to-RFQ links) cannot be told apart from values set after the upgrade, so
    p2p_request_items.buyer_id keeps what was written. Quantity splits, short-closes and RFQ
    line sets are lost with their columns / table; is_awarded stays as it was."""
    op.execute(sa.text("DROP INDEX IF EXISTS %s" % TALLY_INDEX))

    _drop_index("ix_p2p_purchase_orders_rfq_id", "p2p_purchase_orders")
    _drop_column("p2p_purchase_orders", "rfq_id")

    for name in ("short_closed_at", "short_closed_by_id", "short_closed_reason", "short_closed_qty"):
        _drop_column("p2p_request_items", name)

    _drop_column("p2p_vendor_quotation_items", "awarded_qty")

    if _has_table("rfq_items"):
        op.drop_table("rfq_items")  # drops its indexes and constraints with it

    _drop_index("ix_rfqs_p2p_request_id_buyer_id", "rfqs")
    _drop_index("ix_rfqs_buyer_id", "rfqs")
    _drop_column("rfqs", "buyer_id")
