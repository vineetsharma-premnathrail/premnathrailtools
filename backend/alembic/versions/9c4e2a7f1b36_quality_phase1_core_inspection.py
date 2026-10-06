"""quality phase 1 — core inspection: stock types, item flags, characteristics,
plans with revisions, ISO 2859-1 sampling tables, defect / disposition codes,
master lists, settings, inspection lots, NCR disposition workflow

Revision ID: 9c4e2a7f1b36
Revises: a8c3e5f7b9d1
Create Date: 2026-10-06

Every step checks what already exists first (baseline create_all may have
built the new tables straight from the models on a fresh database). Legacy
data is kept: old plans become draft/obsolete, old NCR statuses map onto the
new workflow, old checklists / rejections tables stay (screens retired).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "9c4e2a7f1b36"
down_revision = "a8c3e5f7b9d1"
branch_labels = None
depends_on = None


def _tables():
    return set(sa.inspect(op.get_bind()).get_table_names())


def _cols(table):
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _add(table, column):
    if column.name not in _cols(table):
        op.add_column(table, column)


def _json():
    return postgresql.JSONB() if op.get_bind().dialect.name == "postgresql" else sa.JSON()


def upgrade():
    tables = _tables()
    false = sa.text("false")

    # --- Store: stock types + item quality flags -------------------------
    _add("store_stock_balances", sa.Column("quality_qty", sa.Float(), nullable=False, server_default="0"))
    _add("store_items", sa.Column("inspection_on_receipt", sa.Boolean(), nullable=False, server_default=false))
    _add("store_items", sa.Column("test_certificate_required", sa.Boolean(), nullable=False, server_default=false))

    # --- Masters ---------------------------------------------------------
    if "quality_characteristics" not in tables:
        op.create_table(
            "quality_characteristics",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(30), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("char_type", sa.String(20), nullable=False, server_default="variable"),
            sa.Column("unit", sa.String(30)),
            sa.Column("method", sa.String(255)),
            sa.Column("gauge_type", sa.String(120)),
            sa.Column("classification", sa.String(20), nullable=False, server_default="minor"),
            sa.Column("description", sa.Text()),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_quality_characteristics_code", "quality_characteristics", ["code"], unique=True)

    if "quality_defect_codes" not in tables:
        op.create_table(
            "quality_defect_codes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(30), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("category", sa.String(30), nullable=False),
            sa.Column("description", sa.Text()),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_quality_defect_codes_code", "quality_defect_codes", ["code"], unique=True)

    if "quality_disposition_codes" not in tables:
        op.create_table(
            "quality_disposition_codes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(30), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("disposition_type", sa.String(30), nullable=False),
            sa.Column("description", sa.Text()),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_quality_disposition_codes_code", "quality_disposition_codes", ["code"], unique=True)
        op.bulk_insert(sa.table("quality_disposition_codes", sa.column("code"), sa.column("name"), sa.column("disposition_type")), [
            {"code": "UAI", "name": "Use as is", "disposition_type": "use_as_is"},
            {"code": "RWK", "name": "Rework", "disposition_type": "rework"},
            {"code": "REP", "name": "Repair", "disposition_type": "repair"},
            {"code": "RTV", "name": "Return to vendor", "disposition_type": "return_to_vendor"},
            {"code": "SCR", "name": "Scrap", "disposition_type": "scrap"},
        ])

    if "quality_master_values" not in tables:
        op.create_table(
            "quality_master_values",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("list_key", sa.String(40), nullable=False),
            sa.Column("value", sa.String(60), nullable=False),
            sa.Column("label", sa.String(150), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("list_key", "value", name="uq_quality_master_value"),
        )
        op.create_index("ix_quality_master_values_list_key", "quality_master_values", ["list_key"])
        from app.modules.quality.services.settings import QUALITY_MASTER_LIST_SEEDS
        rows = [{"list_key": k, "value": v, "label": l, "sort_order": (i + 1) * 10}
                for k, vals in QUALITY_MASTER_LIST_SEEDS.items() for i, (v, l) in enumerate(vals)]
        op.bulk_insert(sa.table("quality_master_values", sa.column("list_key"), sa.column("value"),
                                sa.column("label"), sa.column("sort_order", sa.Integer)), rows)

    if "quality_settings" not in tables:
        op.create_table(
            "quality_settings",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("key", sa.String(100), nullable=False, unique=True),
            sa.Column("value", _json()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    # --- Sampling tables (ISO 2859-1 / IS 2500) ---------------------------
    from app.modules.quality.sampling_tables import build_aql_rows, build_code_letter_rows
    if "quality_sample_size_codes" not in tables:
        op.create_table(
            "quality_sample_size_codes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("inspection_level", sa.String(5), nullable=False),
            sa.Column("lot_size_min", sa.Integer(), nullable=False),
            sa.Column("lot_size_max", sa.Integer()),
            sa.Column("code_letter", sa.String(2), nullable=False),
            sa.UniqueConstraint("inspection_level", "lot_size_min", name="uq_quality_sample_code_level_min"),
        )
        op.bulk_insert(sa.table("quality_sample_size_codes", sa.column("inspection_level"), sa.column("lot_size_min", sa.Integer),
                                sa.column("lot_size_max", sa.Integer), sa.column("code_letter")), build_code_letter_rows())
    if "quality_aql_plans" not in tables:
        op.create_table(
            "quality_aql_plans",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code_letter", sa.String(2), nullable=False),
            sa.Column("severity", sa.String(10), nullable=False),
            sa.Column("aql", sa.Float(), nullable=False),
            sa.Column("sample_size", sa.Integer(), nullable=False),
            sa.Column("accept_number", sa.Integer(), nullable=False),
            sa.Column("reject_number", sa.Integer(), nullable=False),
            sa.UniqueConstraint("code_letter", "severity", "aql", name="uq_quality_aql_plan"),
        )
        op.bulk_insert(sa.table("quality_aql_plans", sa.column("code_letter"), sa.column("severity"), sa.column("aql", sa.Float),
                                sa.column("sample_size", sa.Integer), sa.column("accept_number", sa.Integer),
                                sa.column("reject_number", sa.Integer)), build_aql_rows())

    # --- Inspection plans: extend in place --------------------------------
    t = "quality_inspection_plans"
    _add(t, sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True))
    _add(t, sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    _add(t, sa.Column("supersedes_id", sa.Integer(), sa.ForeignKey("quality_inspection_plans.id"), nullable=True))
    _add(t, sa.Column("title", sa.String(255)))
    _add(t, sa.Column("sampling_type", sa.String(10), nullable=False, server_default="aql"))
    _add(t, sa.Column("aql", sa.Float()))
    _add(t, sa.Column("inspection_level", sa.String(5), nullable=False, server_default="II"))
    _add(t, sa.Column("fixed_sample_size", sa.Integer()))
    _add(t, sa.Column("remarks", sa.Text()))
    _add(t, sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id")))
    _add(t, sa.Column("approved_at", sa.DateTime(timezone=True)))
    _add(t, sa.Column("obsoleted_at", sa.DateTime(timezone=True)))
    # Legacy plans have no Item Master link → they can't be "approved"
    # under the new rules: active → draft, inactive → obsolete.
    op.execute("UPDATE quality_inspection_plans SET status = 'draft' WHERE status = 'active'")
    op.execute("UPDATE quality_inspection_plans SET status = 'obsolete' WHERE status = 'inactive'")
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(t)}
    if "ix_quality_inspection_plans_item_id" not in indexes:
        op.create_index("ix_quality_inspection_plans_item_id", t, ["item_id"])
    if "uq_quality_plan_one_approved" not in indexes:
        op.create_index(
            "uq_quality_plan_one_approved", t, ["item_id", "inspection_type"], unique=True,
            postgresql_where=sa.text("status = 'approved' AND is_deleted = false"),
            sqlite_where=sa.text("status = 'approved' AND is_deleted = 0"),
        )
    if "quality_inspection_plan_lines" not in tables:
        op.create_table(
            "quality_inspection_plan_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("plan_id", sa.Integer(), sa.ForeignKey("quality_inspection_plans.id"), nullable=False),
            sa.Column("characteristic_id", sa.Integer(), sa.ForeignKey("quality_characteristics.id"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False, server_default="10"),
            sa.Column("nominal", sa.Float()),
            sa.Column("min_value", sa.Float()),
            sa.Column("max_value", sa.Float()),
            sa.Column("classification", sa.String(20)),
            sa.Column("method", sa.String(255)),
            sa.Column("aql", sa.Float()),
            sa.Column("remarks", sa.Text()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_quality_inspection_plan_lines_plan_id", "quality_inspection_plan_lines", ["plan_id"])

    # --- Inspection lots ---------------------------------------------------
    if "quality_inspection_lots" not in tables:
        op.create_table(
            "quality_inspection_lots",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("lot_number", sa.String(50), nullable=False),
            sa.Column("inspection_type", sa.String(20), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="created"),
            sa.Column("source_type", sa.String(20), nullable=False),
            sa.Column("source_id", sa.Integer()),
            sa.Column("source_reference", sa.String(100)),
            sa.Column("grn_item_id", sa.Integer(), sa.ForeignKey("p2p_goods_receipt_items.id")),
            sa.Column("ncr_id", sa.Integer()),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("item_code", sa.String(100)),
            sa.Column("item_name", sa.String(255), nullable=False),
            sa.Column("uom", sa.String(20)),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("batch_number", sa.String(100)),
            sa.Column("vendor_name", sa.String(255)),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id")),
            sa.Column("stock_in_quality", sa.Boolean(), nullable=False, server_default=false),
            sa.Column("plan_id", sa.Integer(), sa.ForeignKey("quality_inspection_plans.id")),
            sa.Column("plan_revision", sa.Integer()),
            sa.Column("sampling_severity", sa.String(10), nullable=False, server_default="normal"),
            sa.Column("sample_size", sa.Integer()),
            sa.Column("test_certificate_required", sa.Boolean(), nullable=False, server_default=false),
            sa.Column("test_certificate_received", sa.Boolean(), nullable=False, server_default=false),
            sa.Column("test_certificate_reference", sa.String(150)),
            sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("started_at", sa.DateTime(timezone=True)),
            sa.Column("results_recorded_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("results_recorded_at", sa.DateTime(timezone=True)),
            sa.Column("decision", sa.String(30)),
            sa.Column("accepted_qty", sa.Float()),
            sa.Column("rejected_qty", sa.Float()),
            sa.Column("deviation_reference", sa.String(150)),
            sa.Column("decision_remarks", sa.Text()),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("decided_at", sa.DateTime(timezone=True)),
            sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("closed_at", sa.DateTime(timezone=True)),
            sa.Column("lot_date", sa.Date(), nullable=False),
            sa.Column("remarks", sa.Text()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        for col, unique in (("lot_number", True), ("inspection_type", False), ("status", False), ("grn_item_id", False),
                            ("item_id", False), ("assigned_to_id", False)):
            op.create_index(f"ix_quality_inspection_lots_{col}", "quality_inspection_lots", [col], unique=unique)

    if "quality_lot_results" not in tables:
        op.create_table(
            "quality_lot_results",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("lot_id", sa.Integer(), sa.ForeignKey("quality_inspection_lots.id"), nullable=False),
            sa.Column("plan_line_id", sa.Integer(), sa.ForeignKey("quality_inspection_plan_lines.id")),
            sa.Column("characteristic_id", sa.Integer(), sa.ForeignKey("quality_characteristics.id"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False, server_default="10"),
            sa.Column("characteristic_name", sa.String(200), nullable=False),
            sa.Column("char_type", sa.String(20), nullable=False),
            sa.Column("classification", sa.String(20), nullable=False),
            sa.Column("unit", sa.String(30)),
            sa.Column("method", sa.String(255)),
            sa.Column("nominal", sa.Float()),
            sa.Column("min_value", sa.Float()),
            sa.Column("max_value", sa.Float()),
            sa.Column("aql", sa.Float()),
            sa.Column("sample_size", sa.Integer(), nullable=False),
            sa.Column("accept_number", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("reject_number", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("measured_values", sa.JSON()),
            sa.Column("defects_found", sa.Integer()),
            sa.Column("result", sa.String(10)),
            sa.Column("defect_code_id", sa.Integer(), sa.ForeignKey("quality_defect_codes.id")),
            sa.Column("gauge_id", sa.Integer()),
            sa.Column("gauge_reference", sa.String(100)),
            sa.Column("remarks", sa.Text()),
            sa.Column("recorded_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("recorded_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_quality_lot_results_lot_id", "quality_lot_results", ["lot_id"])

    # --- NCR: extend in place ---------------------------------------------
    t = "quality_ncrs"
    with op.batch_alter_table(t) as b:
        b.alter_column("source", type_=sa.String(30), existing_type=sa.String(20), existing_nullable=False)
    for col in (
        sa.Column("auto_raised", sa.Boolean(), nullable=False, server_default=false),
        sa.Column("lot_id", sa.Integer(), sa.ForeignKey("quality_inspection_lots.id")),
        sa.Column("source_reference", sa.String(100)),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id")),
        sa.Column("quantity", sa.Float()),
        sa.Column("uom", sa.String(20)),
        sa.Column("batch_number", sa.String(100)),
        sa.Column("vendor_name", sa.String(255)),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id")),
        sa.Column("stock_blocked", sa.Boolean(), nullable=False, server_default=false),
        sa.Column("defect_code_id", sa.Integer(), sa.ForeignKey("quality_defect_codes.id")),
        sa.Column("disposition_code_id", sa.Integer(), sa.ForeignKey("quality_disposition_codes.id")),
        sa.Column("disposition_type", sa.String(30)),
        sa.Column("disposition_status", sa.String(20), nullable=False, server_default="none"),
        sa.Column("disposition_remarks", sa.Text()),
        sa.Column("customer_approval_required", sa.Boolean(), nullable=False, server_default=false),
        sa.Column("customer_approval_reference", sa.String(150)),
        sa.Column("disposition_proposed_by_id", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("disposition_proposed_at", sa.DateTime(timezone=True)),
        sa.Column("disposition_decided_at", sa.DateTime(timezone=True)),
        sa.Column("estimated_value", sa.Float()),
        sa.Column("action_reference", sa.String(150)),
        sa.Column("action_remarks", sa.Text()),
        sa.Column("action_done_by_id", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("action_done_at", sa.DateTime(timezone=True)),
        sa.Column("reinspection_lot_id", sa.Integer(), sa.ForeignKey("quality_inspection_lots.id")),
        sa.Column("verified_by_id", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("verification_remarks", sa.Text()),
        sa.Column("material_cost", sa.Float()),
        sa.Column("rework_cost", sa.Float()),
        sa.Column("other_cost", sa.Float()),
        sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id")),
    ):
        _add(t, col)
    op.execute("UPDATE quality_ncrs SET status = 'open' WHERE status IN ('under_review', 'capa_assigned')")
    op.execute("UPDATE quality_ncrs SET status = 'cancelled' WHERE status = 'rejected'")
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(t)}
    for col in ("lot_id", "item_id"):
        if f"ix_quality_ncrs_{col}" not in indexes:
            op.create_index(f"ix_quality_ncrs_{col}", t, [col])

    if "quality_ncr_approvals" not in tables:
        op.create_table(
            "quality_ncr_approvals",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ncr_id", sa.Integer(), sa.ForeignKey("quality_ncrs.id"), nullable=False),
            sa.Column("role", sa.String(30), nullable=False),
            sa.Column("decision", sa.String(10), nullable=False),
            sa.Column("disposition_type", sa.String(30), nullable=False),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("remarks", sa.Text()),
            sa.Column("superseded", sa.Boolean(), nullable=False, server_default=false),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_quality_ncr_approvals_ncr_id", "quality_ncr_approvals", ["ncr_id"])


def downgrade():
    op.drop_table("quality_ncr_approvals")
    with op.batch_alter_table("quality_ncrs") as b:
        for name in ("ix_quality_ncrs_lot_id", "ix_quality_ncrs_item_id"):
            b.drop_index(name)
        for col in (
            "auto_raised", "lot_id", "source_reference", "item_id", "quantity", "uom", "batch_number", "vendor_name",
            "location_id", "stock_blocked", "defect_code_id", "disposition_code_id", "disposition_type",
            "disposition_status", "disposition_remarks", "customer_approval_required", "customer_approval_reference",
            "disposition_proposed_by_id", "disposition_proposed_at", "disposition_decided_at", "estimated_value",
            "action_reference", "action_remarks", "action_done_by_id", "action_done_at", "reinspection_lot_id",
            "verified_by_id", "verified_at", "verification_remarks", "material_cost", "rework_cost", "other_cost",
            "closed_by_id",
        ):
            b.drop_column(col)
    op.execute("UPDATE quality_ncrs SET status = 'open' WHERE status IN ('disposition_decided', 'action_done', 'verified')")
    op.drop_table("quality_lot_results")
    op.drop_table("quality_inspection_lots")
    op.drop_table("quality_inspection_plan_lines")
    op.drop_index("uq_quality_plan_one_approved", table_name="quality_inspection_plans")
    op.drop_index("ix_quality_inspection_plans_item_id", table_name="quality_inspection_plans")
    op.execute("UPDATE quality_inspection_plans SET status = 'active' WHERE status IN ('draft', 'approved')")
    op.execute("UPDATE quality_inspection_plans SET status = 'inactive' WHERE status = 'obsolete'")
    with op.batch_alter_table("quality_inspection_plans") as b:
        for col in ("item_id", "revision", "supersedes_id", "title", "sampling_type", "aql", "inspection_level",
                    "fixed_sample_size", "remarks", "approved_by_id", "approved_at", "obsoleted_at"):
            b.drop_column(col)
    for name in ("quality_aql_plans", "quality_sample_size_codes", "quality_settings", "quality_master_values",
                 "quality_disposition_codes", "quality_defect_codes", "quality_characteristics"):
        op.drop_table(name)
    with op.batch_alter_table("store_items") as b:
        b.drop_column("test_certificate_required")
        b.drop_column("inspection_on_receipt")
    with op.batch_alter_table("store_stock_balances") as b:
        b.drop_column("quality_qty")
