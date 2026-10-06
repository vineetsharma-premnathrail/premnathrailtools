"""quality phase 2 — production & dispatch: first article inspections,
customer / third-party inspection calls, lot photos, in-process gate lots on
work order operations, contract inspection requirement on ERP machines /
orders, dispatch issue type + issue → ERP order link

Revision ID: 4f7b2c9e1d58
Revises: 9c4e2a7f1b36
Create Date: 2026-10-06

Checks what already exists first (a fresh database may have been built from
the models). Legacy free-text gate inspections stay on
production_work_order_operations.quality_inspection_id (still readable).
"""
from alembic import op
import sqlalchemy as sa

revision = "4f7b2c9e1d58"
down_revision = "9c4e2a7f1b36"
branch_labels = None
depends_on = None


def _tables():
    return set(sa.inspect(op.get_bind()).get_table_names())


def _cols(table):
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _add(table, column):
    if column.name not in _cols(table):
        op.add_column(table, column)


def upgrade():
    tables = _tables()

    if "quality_first_articles" not in tables:
        op.create_table(
            "quality_first_articles",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("fai_number", sa.String(50), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("item_code", sa.String(100)),
            sa.Column("item_name", sa.String(255), nullable=False),
            sa.Column("vendor_name", sa.String(255)),
            sa.Column("drawing_ref", sa.String(255)),
            sa.Column("trigger", sa.String(20), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("source_type", sa.String(30), nullable=False),
            sa.Column("source_reference", sa.String(100)),
            sa.Column("lot_id", sa.Integer(), sa.ForeignKey("quality_inspection_lots.id")),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("decided_at", sa.DateTime(timezone=True)),
            sa.Column("decision_remarks", sa.Text()),
            sa.Column("remarks", sa.Text()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_quality_first_articles_fai_number", "quality_first_articles", ["fai_number"], unique=True)
        op.create_index("ix_quality_first_articles_item_id", "quality_first_articles", ["item_id"])
        op.create_index("ix_quality_first_articles_status", "quality_first_articles", ["status"])
        op.create_index("ix_quality_first_articles_lot_id", "quality_first_articles", ["lot_id"])

    if "quality_inspection_calls" not in tables:
        op.create_table(
            "quality_inspection_calls",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("call_number", sa.String(50), nullable=False),
            sa.Column("status", sa.String(25), nullable=False, server_default="requested"),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id")),
            sa.Column("order_reference", sa.String(150)),
            sa.Column("customer_name", sa.String(255)),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("item_code", sa.String(100)),
            sa.Column("item_name", sa.String(255), nullable=False),
            sa.Column("uom", sa.String(20)),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("batch_number", sa.String(100)),
            sa.Column("lot_id", sa.Integer(), sa.ForeignKey("quality_inspection_lots.id")),
            sa.Column("agency", sa.String(50), nullable=False),
            sa.Column("requested_date", sa.Date(), nullable=False),
            sa.Column("call_date", sa.Date()),
            sa.Column("inspector_name", sa.String(150)),
            sa.Column("result_date", sa.Date()),
            sa.Column("accepted_qty", sa.Float()),
            sa.Column("rejected_qty", sa.Float()),
            sa.Column("certificate_number", sa.String(150)),
            sa.Column("certificate_file_name", sa.String(255)),
            sa.Column("certificate_file_path", sa.String(1000)),
            sa.Column("certificate_content_type", sa.String(150)),
            sa.Column("result_remarks", sa.Text()),
            sa.Column("ncr_id", sa.Integer(), sa.ForeignKey("quality_ncrs.id")),
            sa.Column("remarks", sa.Text()),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("result_recorded_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("result_recorded_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_quality_inspection_calls_call_number", "quality_inspection_calls", ["call_number"], unique=True)
        op.create_index("ix_quality_inspection_calls_status", "quality_inspection_calls", ["status"])
        op.create_index("ix_quality_inspection_calls_erp_project_id", "quality_inspection_calls", ["erp_project_id"])
        op.create_index("ix_quality_inspection_calls_item_id", "quality_inspection_calls", ["item_id"])

    if "quality_lot_photos" not in tables:
        op.create_table(
            "quality_lot_photos",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("lot_id", sa.Integer(), sa.ForeignKey("quality_inspection_lots.id"), nullable=False),
            sa.Column("result_id", sa.Integer(), sa.ForeignKey("quality_lot_results.id")),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("file_path", sa.String(1000), nullable=False),
            sa.Column("content_type", sa.String(150)),
            sa.Column("file_size", sa.Integer()),
            sa.Column("caption", sa.String(255)),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_quality_lot_photos_lot_id", "quality_lot_photos", ["lot_id"])

    if "quality_lot_id" not in _cols("production_work_order_operations"):
        with op.batch_alter_table("production_work_order_operations") as b:
            b.add_column(sa.Column("quality_lot_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_pwo_operations_quality_lot", "quality_inspection_lots", ["quality_lot_id"], ["id"])

    _add("erp_projects", sa.Column("third_party_inspection_required", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    _add("erp_projects", sa.Column("inspection_agency", sa.String(50), nullable=True))

    if "erp_project_id" not in _cols("store_material_issues"):
        with op.batch_alter_table("store_material_issues") as b:
            b.add_column(sa.Column("erp_project_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_store_material_issues_erp_project", "erp_projects", ["erp_project_id"], ["id"])

    # Store issue type for finished goods leaving to a customer (rule 8 check).
    if "store_doc_types" in tables:
        bind = op.get_bind()
        exists = bind.execute(sa.text("SELECT 1 FROM store_doc_types WHERE kind = 'issue' AND value = 'dispatch'")).first()
        has_any = bind.execute(sa.text("SELECT 1 FROM store_doc_types WHERE kind = 'issue'")).first()
        if not exists and has_any:
            bind.execute(sa.text(
                "INSERT INTO store_doc_types (kind, value, label, requires_issue, approver_rule, approver_user_ids, is_active, created_at, updated_at) "
                "VALUES ('issue', 'dispatch', 'Dispatch to customer', false, 'none', '[]', true, now(), now())"
            ))


def downgrade():
    bind = op.get_bind()
    if "store_doc_types" in _tables():
        bind.execute(sa.text(
            "DELETE FROM store_doc_types WHERE kind = 'issue' AND value = 'dispatch' "
            "AND NOT EXISTS (SELECT 1 FROM store_material_issues WHERE issue_type = 'dispatch')"
        ))
    with op.batch_alter_table("store_material_issues") as b:
        b.drop_constraint("fk_store_material_issues_erp_project", type_="foreignkey")
        b.drop_column("erp_project_id")
    with op.batch_alter_table("erp_projects") as b:
        b.drop_column("inspection_agency")
        b.drop_column("third_party_inspection_required")
    with op.batch_alter_table("production_work_order_operations") as b:
        b.drop_constraint("fk_pwo_operations_quality_lot", type_="foreignkey")
        b.drop_column("quality_lot_id")
    op.drop_table("quality_lot_photos")
    op.drop_table("quality_inspection_calls")
    op.drop_table("quality_first_articles")
