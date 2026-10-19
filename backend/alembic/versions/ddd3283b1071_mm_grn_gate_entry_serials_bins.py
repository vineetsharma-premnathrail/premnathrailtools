"""MM: GRN gate entry + vendor document fields, blind receipt (invoice qty),
serial number management (IQ01) and WM bin stock (putaway / pick / bin moves /
bin-wise count).

- p2p_goods_receipts: gate_entry_number/at, vendor_invoice_number/date,
  delivery_challan_number/date, eway_bill_number, vehicle_number,
  transporter_name, lr_number
- p2p_goods_receipt_items: invoice_quantity, bin_id, serial_numbers
- store_material_issue_items: bin_id, serial_numbers
- store_stock_transfer_items: from_bin_id, to_bin_id, serial_numbers
- store_material_return_items: bin_id, serial_numbers
- store_physical_counts.bin_id, store_stock_adjustment_items.bin_id
- store_serial_numbers / store_serial_events — serialised units + history
- store_bin_moves — bin-to-bin moves inside one store
- index on store_stock_transactions (location_id, bin_id) for bin stock

Revision ID: ddd3283b1071
Revises: 574fa59bee73
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ddd3283b1071"
down_revision = "574fa59bee73"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _ts() -> list[sa.Column]:
    return [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True)]


def _json():
    return postgresql.JSONB().with_variant(sa.JSON(), "sqlite")


_GRN_COLS = [
    ("gate_entry_number", lambda: sa.String(50)),
    ("gate_entry_at", lambda: sa.DateTime()),
    ("vendor_invoice_number", lambda: sa.String(100)),
    ("vendor_invoice_date", lambda: sa.Date()),
    ("delivery_challan_number", lambda: sa.String(100)),
    ("delivery_challan_date", lambda: sa.Date()),
    ("eway_bill_number", lambda: sa.String(30)),
    ("vehicle_number", lambda: sa.String(30)),
    ("transporter_name", lambda: sa.String(150)),
    ("lr_number", lambda: sa.String(50)),
]

# (table, column, type factory, FK target or None)
_LINE_COLS = [
    ("p2p_goods_receipt_items", "invoice_quantity", lambda: sa.Float(), None),
    ("p2p_goods_receipt_items", "bin_id", lambda: sa.Integer(), "store_bins.id"),
    ("p2p_goods_receipt_items", "serial_numbers", _json, None),
    ("store_material_issue_items", "bin_id", lambda: sa.Integer(), "store_bins.id"),
    ("store_material_issue_items", "serial_numbers", _json, None),
    ("store_stock_transfer_items", "from_bin_id", lambda: sa.Integer(), "store_bins.id"),
    ("store_stock_transfer_items", "to_bin_id", lambda: sa.Integer(), "store_bins.id"),
    ("store_stock_transfer_items", "serial_numbers", _json, None),
    ("store_material_return_items", "bin_id", lambda: sa.Integer(), "store_bins.id"),
    ("store_material_return_items", "serial_numbers", _json, None),
    ("store_physical_counts", "bin_id", lambda: sa.Integer(), "store_bins.id"),
    ("store_stock_adjustment_items", "bin_id", lambda: sa.Integer(), "store_bins.id"),
]


def upgrade() -> None:
    have = _columns("p2p_goods_receipts")
    with op.batch_alter_table("p2p_goods_receipts") as b:
        for name, typ in _GRN_COLS:
            if name not in have:
                b.add_column(sa.Column(name, typ(), nullable=True))
    op.create_index("ix_p2p_goods_receipts_gate_entry_number", "p2p_goods_receipts", ["gate_entry_number"])
    op.create_index("ix_p2p_goods_receipts_vendor_invoice_number", "p2p_goods_receipts", ["vendor_invoice_number"])

    by_table: dict[str, list] = {}
    for table, name, typ, fk in _LINE_COLS:
        by_table.setdefault(table, []).append((name, typ, fk))
    for table, cols in by_table.items():
        have = _columns(table)
        with op.batch_alter_table(table) as b:
            for name, typ, fk in cols:
                if name in have:
                    continue
                b.add_column(sa.Column(name, typ(), nullable=True))
                if fk:
                    b.create_foreign_key(f"fk_{table}_{name}"[:63], fk.split(".")[0], [name], ["id"])

    tables = _tables()
    if "store_serial_numbers" not in tables:
        op.create_table(
            "store_serial_numbers",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("serial_no", sa.String(100), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="quality"),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
            sa.Column("bin_id", sa.Integer(), sa.ForeignKey("store_bins.id"), nullable=True),
            sa.Column("batch_number", sa.String(100), nullable=True),
            sa.Column("vendor_name", sa.String(255), nullable=True),
            sa.Column("grn_id", sa.Integer(), sa.ForeignKey("p2p_goods_receipts.id"), nullable=True),
            sa.Column("grn_item_id", sa.Integer(), sa.ForeignKey("p2p_goods_receipt_items.id"), nullable=True),
            sa.Column("received_date", sa.Date(), nullable=True),
            sa.Column("vendor_warranty_until", sa.Date(), nullable=True),
            sa.Column("issue_id", sa.Integer(), sa.ForeignKey("store_material_issues.id"), nullable=True),
            sa.Column("issue_item_id", sa.Integer(), sa.ForeignKey("store_material_issue_items.id"), nullable=True),
            sa.Column("issued_to", sa.String(255), nullable=True),
            sa.Column("work_order", sa.String(150), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("service_request_id", sa.Integer(), sa.ForeignKey("erp_service_requests.id"), nullable=True),
            sa.Column("transfer_item_id", sa.Integer(), sa.ForeignKey("store_stock_transfer_items.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("item_id", "serial_no", name="uq_store_serial_item_serial"),
        )
        for col in ("item_id", "serial_no", "status", "location_id", "grn_id", "grn_item_id", "issue_id",
                    "erp_project_id", "service_request_id"):
            op.create_index(f"ix_store_serial_numbers_{col}", "store_serial_numbers", [col])

    if "store_serial_events" not in tables:
        op.create_table(
            "store_serial_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("serial_id", sa.Integer(), sa.ForeignKey("store_serial_numbers.id"), nullable=False),
            sa.Column("event", sa.String(30), nullable=False),
            sa.Column("from_status", sa.String(20), nullable=True),
            sa.Column("to_status", sa.String(20), nullable=False),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
            sa.Column("bin_id", sa.Integer(), sa.ForeignKey("store_bins.id"), nullable=True),
            sa.Column("reference_type", sa.String(30), nullable=True),
            sa.Column("reference_number", sa.String(100), nullable=True),
            sa.Column("event_date", sa.Date(), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_store_serial_events_serial_id", "store_serial_events", ["serial_id"])

    if "store_bin_moves" not in tables:
        op.create_table(
            "store_bin_moves",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("move_number", sa.String(50), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("from_bin_id", sa.Integer(), sa.ForeignKey("store_bins.id"), nullable=True),
            sa.Column("to_bin_id", sa.Integer(), sa.ForeignKey("store_bins.id"), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("batch_number", sa.String(100), nullable=True),
            sa.Column("move_date", sa.Date(), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_store_bin_moves_move_number", "store_bin_moves", ["move_number"], unique=True)
        for col in ("item_id", "location_id", "from_bin_id", "to_bin_id"):
            op.create_index(f"ix_store_bin_moves_{col}", "store_bin_moves", [col])

    op.create_index("ix_store_stock_transactions_location_bin", "store_stock_transactions", ["location_id", "bin_id"])


def downgrade() -> None:
    op.drop_index("ix_store_stock_transactions_location_bin", table_name="store_stock_transactions")
    op.drop_table("store_bin_moves")
    op.drop_table("store_serial_events")
    op.drop_table("store_serial_numbers")
    by_table: dict[str, list] = {}
    for table, name, _typ, fk in _LINE_COLS:
        by_table.setdefault(table, []).append((name, fk))
    for table, cols in by_table.items():
        with op.batch_alter_table(table) as b:
            for name, fk in cols:
                if fk:
                    b.drop_constraint(f"fk_{table}_{name}"[:63], type_="foreignkey")
                b.drop_column(name)
    op.drop_index("ix_p2p_goods_receipts_vendor_invoice_number", table_name="p2p_goods_receipts")
    op.drop_index("ix_p2p_goods_receipts_gate_entry_number", table_name="p2p_goods_receipts")
    with op.batch_alter_table("p2p_goods_receipts") as b:
        for name, _typ in _GRN_COLS:
            b.drop_column(name)
