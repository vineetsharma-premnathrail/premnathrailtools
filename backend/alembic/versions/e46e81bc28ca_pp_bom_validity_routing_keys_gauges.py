"""PP wave 2 (2026-10-14): BOM validity + change number + item categories
(CS01/CS02), ECN effectivity on Production BOMs and change flags on open work
orders (CC01/ECM), discipline-BOM merges (CWBPP), routing control keys
(CA01), sales-order assignment + dependent (parent) work orders (CO01 /
CS11), and the gauge / test-equipment master with calibrations (QM-IM).

Revision ID: e46e81bc28ca
Revises: ddd3283b1071
"""
from alembic import op
import sqlalchemy as sa

revision = "e46e81bc28ca"
down_revision = "ddd3283b1071"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    ]


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _add(table: str, columns: list[sa.Column]) -> None:
    have = _cols(table)
    todo = [c for c in columns if c.name not in have]
    if not todo:
        return
    with op.batch_alter_table(table) as batch:
        for c in todo:
            batch.add_column(c)


_OP_COLUMNS = lambda: [  # noqa: E731
    sa.Column("control_key", sa.String(20), nullable=False, server_default="internal"),
    sa.Column("confirmation", sa.String(20), nullable=False, server_default="optional"),
    sa.Column("print_on_job_card", sa.Boolean(), nullable=False, server_default=sa.true()),
    sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
    sa.Column("external_cost", sa.Float(), nullable=True),
]


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    # CS01/CS02 — validity, change number, effectivity on BOM versions.
    _add("production_boms", [
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("change_number", sa.String(50), nullable=True),
        sa.Column("ecn_id", sa.Integer(), sa.ForeignKey("design_change_notices.id"), nullable=True),
        sa.Column("effectivity_type", sa.String(20), nullable=True),
        sa.Column("effective_serial", sa.String(100), nullable=True),
    ])
    if "ix_production_boms_ecn_id" not in {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("production_boms")}:
        op.create_index("ix_production_boms_ecn_id", "production_boms", ["ecn_id"])

    # Item categories: text / document lines carry no Store item.
    _add("production_bom_items", [
        sa.Column("item_category", sa.String(20), nullable=False, server_default="stock"),
        sa.Column("line_text", sa.Text(), nullable=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("design_documents.id"), nullable=True),
        sa.Column("source_tag", sa.String(255), nullable=True),
    ])
    with op.batch_alter_table("production_bom_items") as batch:
        batch.alter_column("component_item_id", existing_type=sa.Integer(), nullable=True)

    # CA01 — routing control keys.
    _add("production_bom_operations", _OP_COLUMNS())
    _add("production_work_order_operations", _OP_COLUMNS() + [
        sa.Column("job_work_issue_id", sa.Integer(), sa.ForeignKey("store_material_issues.id"), nullable=True),
    ])

    _add("production_work_order_materials", [
        sa.Column("item_category", sa.String(20), nullable=False, server_default="stock"),
    ])

    # CO01 SO assignment, CS11 parent order, CC01 change flag.
    _add("production_work_orders", [
        sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id", name="fk_production_work_orders_sales_order_id"), nullable=True),
        sa.Column("sales_order_line_id", sa.Integer(), sa.ForeignKey("sales_order_lines.id", name="fk_production_work_orders_sales_order_line_id"), nullable=True),
        sa.Column("parent_work_order_id", sa.Integer(), sa.ForeignKey("production_work_orders.id"), nullable=True),
        sa.Column("change_flag", sa.Text(), nullable=True),
        sa.Column("change_flag_ecn_id", sa.Integer(), sa.ForeignKey("design_change_notices.id"), nullable=True),
        sa.Column("change_flag_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("change_flag_cleared_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("change_flag_cleared_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("change_flag_resolution", sa.Text(), nullable=True),
    ])
    wo_indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("production_work_orders")}
    for col in ("sales_order_id", "parent_work_order_id"):
        if f"ix_production_work_orders_{col}" not in wo_indexes:
            op.create_index(f"ix_production_work_orders_{col}", "production_work_orders", [col])

    # CWBPP — discipline BOM merges.
    if "production_bom_discipline_merges" not in existing:
        op.create_table(
            "production_bom_discipline_merges",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("production_boms.id"), nullable=False),
            sa.Column("source_type", sa.String(20), nullable=False),
            sa.Column("source_id", sa.Integer(), nullable=False),
            sa.Column("source_label", sa.String(255), nullable=False),
            sa.Column("quantities", sa.JSON(), nullable=False),
            sa.Column("merged_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
        )
        op.create_index("ix_production_bom_discipline_merges_bom_id", "production_bom_discipline_merges", ["bom_id"])

    # QM-IM — gauges and calibrations.
    if "quality_gauges" not in existing:
        op.create_table(
            "quality_gauges",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(50), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("gauge_type", sa.String(120), nullable=True),
            sa.Column("make", sa.String(120), nullable=True),
            sa.Column("serial_number", sa.String(120), nullable=True),
            sa.Column("measuring_range", sa.String(120), nullable=True),
            sa.Column("least_count", sa.String(60), nullable=True),
            sa.Column("location", sa.String(150), nullable=True),
            sa.Column("custodian_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("status", sa.String(30), nullable=False, server_default="active"),
            sa.Column("calibration_interval_days", sa.Integer(), nullable=False, server_default="365"),
            sa.Column("last_calibrated_on", sa.Date(), nullable=True),
            sa.Column("next_due_on", sa.Date(), nullable=True),
            sa.Column("certificate_ref", sa.String(150), nullable=True),
            sa.Column("calibration_agency", sa.String(200), nullable=True),
            sa.Column("maintenance_asset_id", sa.Integer(), sa.ForeignKey("maintenance_assets.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
        )
        op.create_index("ix_quality_gauges_code", "quality_gauges", ["code"], unique=True)
        op.create_index("ix_quality_gauges_status", "quality_gauges", ["status"])
        op.create_index("ix_quality_gauges_next_due_on", "quality_gauges", ["next_due_on"])
    if "quality_gauge_calibrations" not in existing:
        op.create_table(
            "quality_gauge_calibrations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("gauge_id", sa.Integer(), sa.ForeignKey("quality_gauges.id"), nullable=False),
            sa.Column("calibrated_on", sa.Date(), nullable=False),
            sa.Column("result", sa.String(20), nullable=False),
            sa.Column("next_due_on", sa.Date(), nullable=True),
            sa.Column("agency", sa.String(200), nullable=True),
            sa.Column("certificate_ref", sa.String(150), nullable=True),
            sa.Column("error_found", sa.Float(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("recorded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_quality_gauge_calibrations_gauge_id", "quality_gauge_calibrations", ["gauge_id"])

    # The lot result's gauge id becomes a real reference. Old free ids that
    # point nowhere are cleared first so the constraint can be created.
    op.execute("UPDATE quality_lot_results SET gauge_id = NULL WHERE gauge_id IS NOT NULL "
               "AND gauge_id NOT IN (SELECT id FROM quality_gauges)")
    fks = {fk.get("name") for fk in sa.inspect(op.get_bind()).get_foreign_keys("quality_lot_results")}
    if "fk_quality_lot_results_gauge_id" not in fks:
        with op.batch_alter_table("quality_lot_results") as batch:
            batch.create_foreign_key("fk_quality_lot_results_gauge_id", "quality_gauges", ["gauge_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("quality_lot_results") as batch:
        batch.drop_constraint("fk_quality_lot_results_gauge_id", type_="foreignkey")
    op.drop_index("ix_quality_gauge_calibrations_gauge_id", table_name="quality_gauge_calibrations")
    op.drop_table("quality_gauge_calibrations")
    op.drop_index("ix_quality_gauges_next_due_on", table_name="quality_gauges")
    op.drop_index("ix_quality_gauges_status", table_name="quality_gauges")
    op.drop_index("ix_quality_gauges_code", table_name="quality_gauges")
    op.drop_table("quality_gauges")
    op.drop_index("ix_production_bom_discipline_merges_bom_id", table_name="production_bom_discipline_merges")
    op.drop_table("production_bom_discipline_merges")

    op.drop_index("ix_production_work_orders_parent_work_order_id", table_name="production_work_orders")
    op.drop_index("ix_production_work_orders_sales_order_id", table_name="production_work_orders")
    with op.batch_alter_table("production_work_orders") as batch:
        for col in ("change_flag_resolution", "change_flag_cleared_at", "change_flag_cleared_by_id", "change_flag_at",
                    "change_flag_ecn_id", "change_flag", "parent_work_order_id", "sales_order_line_id", "sales_order_id"):
            batch.drop_column(col)
    with op.batch_alter_table("production_work_order_materials") as batch:
        batch.drop_column("item_category")
    with op.batch_alter_table("production_work_order_operations") as batch:
        for col in ("job_work_issue_id", "external_cost", "vendor_id", "print_on_job_card", "confirmation", "control_key"):
            batch.drop_column(col)
    with op.batch_alter_table("production_bom_operations") as batch:
        for col in ("external_cost", "vendor_id", "print_on_job_card", "confirmation", "control_key"):
            batch.drop_column(col)
    # Text / document lines have no item; they can't survive NOT NULL.
    op.execute("DELETE FROM production_bom_items WHERE component_item_id IS NULL")
    with op.batch_alter_table("production_bom_items") as batch:
        batch.alter_column("component_item_id", existing_type=sa.Integer(), nullable=False)
        for col in ("source_tag", "document_id", "line_text", "item_category"):
            batch.drop_column(col)
    op.drop_index("ix_production_boms_ecn_id", table_name="production_boms")
    with op.batch_alter_table("production_boms") as batch:
        for col in ("effective_serial", "effectivity_type", "ecn_id", "change_number", "valid_to", "valid_from"):
            batch.drop_column(col)
