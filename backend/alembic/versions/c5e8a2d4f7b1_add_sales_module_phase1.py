"""sales module phase 1: sales orders (lines, delivery schedule, billing
plan), amendments, DP extensions, approvals, attachments; the SO link on
production_rrv_builds; and the 'sales' modules row

Phase 1 of docs/02-modules/sales/plan.md — order book and delivery schedule.

Revision ID: c5e8a2d4f7b1
Revises: b3d8f1a6c2e9
Create Date: 2026-10-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "c5e8a2d4f7b1"
down_revision = "b3d8f1a6c2e9"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)
QTY = sa.Numeric(18, 4)
RATE = sa.Numeric(18, 4)
PCT = sa.Numeric(7, 3)


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    ]


def _soft_delete():
    return [
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "sales_orders" not in tables:
        op.create_table(
            "sales_orders",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("so_number", sa.String(length=50), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="draft"),
            sa.Column("order_type", sa.String(length=20), nullable=False, server_default="rrv_supply"),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=False),
            sa.Column("customer_contact_id", sa.Integer(), sa.ForeignKey("crm_org_contacts.id"), nullable=True),
            sa.Column("source_type", sa.String(length=20), nullable=False, server_default="direct"),
            sa.Column("source_inquiry_id", sa.Integer(), sa.ForeignKey("crm_inquiries.id"), nullable=True),
            sa.Column("source_tender_id", sa.Integer(), sa.ForeignKey("crm_tenders.id"), nullable=True),
            sa.Column("source_quotation_id", sa.Integer(), sa.ForeignKey("crm_quotations.id"), nullable=True),
            sa.Column("source_quotation_number", sa.String(length=100), nullable=True),
            sa.Column("customer_po_number", sa.String(length=100), nullable=True),
            sa.Column("customer_po_date", sa.Date(), nullable=True),
            sa.Column("customer_po_received_date", sa.Date(), nullable=True),
            sa.Column("loa_number", sa.String(length=100), nullable=True),
            sa.Column("loa_date", sa.Date(), nullable=True),
            sa.Column("contract_reference", sa.String(length=150), nullable=True),
            sa.Column("purchaser_name", sa.String(length=255), nullable=True),
            sa.Column("paying_authority", sa.String(length=255), nullable=True),
            sa.Column("customer_name", sa.String(length=255), nullable=True),
            sa.Column("billing_address", sa.Text(), nullable=True),
            sa.Column("customer_gstin", sa.String(length=30), nullable=True),
            sa.Column("place_of_supply_state_code", sa.String(length=10), nullable=True),
            sa.Column("customer_state", sa.String(length=100), nullable=True),
            sa.Column("currency", sa.String(length=3), nullable=False, server_default="INR"),
            sa.Column("price_basis", sa.String(length=20), nullable=False, server_default="for_destination"),
            sa.Column("freight_terms", sa.String(length=255), nullable=True),
            sa.Column("insurance_terms", sa.String(length=255), nullable=True),
            sa.Column("payment_terms_label", sa.String(length=255), nullable=True),
            sa.Column("subtotal", MONEY, nullable=False, server_default="0"),
            sa.Column("discount_total", MONEY, nullable=False, server_default="0"),
            sa.Column("taxable_total", MONEY, nullable=False, server_default="0"),
            sa.Column("gst_total", MONEY, nullable=False, server_default="0"),
            sa.Column("grand_total", MONEY, nullable=False, server_default="0"),
            sa.Column("inspection_agency", sa.String(length=30), nullable=True),
            sa.Column("third_party_inspection_required", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("ld_applicable", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("ld_rate_percent", PCT, nullable=True),
            sa.Column("ld_rate_period", sa.String(length=10), nullable=True),
            sa.Column("ld_basis", sa.String(length=20), nullable=True),
            sa.Column("ld_max_percent", PCT, nullable=True),
            sa.Column("warranty_months_from_delivery", sa.Integer(), nullable=True),
            sa.Column("warranty_months_from_commissioning", sa.Integer(), nullable=True),
            sa.Column("warranty_rule", sa.String(length=30), nullable=True),
            sa.Column("warranty_terms_text", sa.Text(), nullable=True),
            sa.Column("pbg_required", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("pbg_percent", PCT, nullable=True),
            sa.Column("pbg_due_days", sa.Integer(), nullable=True),
            sa.Column("delivery_terms_text", sa.Text(), nullable=True),
            sa.Column("special_conditions", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("sales_owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("deviation_flags", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("required_approval_level", sa.String(length=20), nullable=True),
            sa.Column("approval_round", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("confirmed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("oa_issued_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("oa_issued_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("amendment_no", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("held_from_status", sa.String(length=30), nullable=True),
            sa.Column("hold_reason", sa.Text(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("short_close_reason", sa.Text(), nullable=True),
            sa.Column("close_reason", sa.Text(), nullable=True),
            sa.Column("return_comment", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_sales_orders_so_number", "sales_orders", ["so_number"], unique=True)
        op.create_index("ix_sales_orders_status", "sales_orders", ["status"])
        op.create_index("ix_sales_orders_customer_id", "sales_orders", ["customer_id"])
        op.create_index("ix_sales_orders_source_inquiry_id", "sales_orders", ["source_inquiry_id"])
        op.create_index("ix_sales_orders_source_tender_id", "sales_orders", ["source_tender_id"])
        op.create_index("ix_sales_orders_customer_po_number", "sales_orders", ["customer_po_number"])

    if "sales_order_lines" not in tables:
        op.create_table(
            "sales_order_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("so_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("line_number", sa.Integer(), nullable=False),
            sa.Column("line_type", sa.String(length=20), nullable=False, server_default="rrv"),
            sa.Column("crm_product_id", sa.Integer(), sa.ForeignKey("crm_products.id"), nullable=True),
            sa.Column("product_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("rrv_model", sa.String(length=200), nullable=True),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("specification", sa.Text(), nullable=True),
            sa.Column("customer_line_ref", sa.String(length=150), nullable=True),
            sa.Column("hsn_sac_code", sa.String(length=20), nullable=True),
            sa.Column("uom", sa.String(length=20), nullable=False, server_default="NOS"),
            sa.Column("quantity", QTY, nullable=False, server_default="1"),
            sa.Column("unit_price", RATE, nullable=False, server_default="0"),
            sa.Column("discount_percent", PCT, nullable=False, server_default="0"),
            sa.Column("discount_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("taxable_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("gst_rate", PCT, nullable=False, server_default="18"),
            sa.Column("gst_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("line_total", MONEY, nullable=False, server_default="0"),
            sa.Column("qty_scheduled", QTY, nullable=False, server_default="0"),
            sa.Column("qty_dispatched", QTY, nullable=False, server_default="0"),
            sa.Column("qty_delivered", QTY, nullable=False, server_default="0"),
            sa.Column("qty_invoiced", QTY, nullable=False, server_default="0"),
            sa.Column("qty_cancelled", QTY, nullable=False, server_default="0"),
            *_timestamps(),
            sa.UniqueConstraint("so_id", "line_number", name="uq_sales_order_line_number"),
        )
        op.create_index("ix_sales_order_lines_so_id", "sales_order_lines", ["so_id"])

    if "sales_order_schedules" not in tables:
        op.create_table(
            "sales_order_schedules",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("so_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("so_line_id", sa.Integer(), sa.ForeignKey("sales_order_lines.id"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("quantity", QTY, nullable=False, server_default="1"),
            sa.Column("consignee_name", sa.String(length=255), nullable=True),
            sa.Column("consignee_address", sa.Text(), nullable=True),
            sa.Column("consignee_gstin", sa.String(length=30), nullable=True),
            sa.Column("consignee_state_code", sa.String(length=10), nullable=True),
            sa.Column("consignee_contact_name", sa.String(length=150), nullable=True),
            sa.Column("consignee_contact_phone", sa.String(length=50), nullable=True),
            sa.Column("contract_delivery_date", sa.Date(), nullable=True),
            sa.Column("current_delivery_date", sa.Date(), nullable=True),
            sa.Column("committed_date", sa.Date(), nullable=True),
            sa.Column("rrv_build_id", sa.Integer(), sa.ForeignKey("production_rrv_builds.id"), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("dispatched_on", sa.Date(), nullable=True),
            sa.Column("delivered_on", sa.Date(), nullable=True),
            sa.Column("commissioned_on", sa.Date(), nullable=True),
            sa.Column("ld_weeks", sa.Integer(), nullable=True),
            sa.Column("ld_amount", MONEY, nullable=True),
            sa.Column("ld_computed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ld_waived", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("risk_flag", sa.String(length=20), nullable=True),
            sa.Column("warranty_start", sa.Date(), nullable=True),
            sa.Column("warranty_end", sa.Date(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_sales_order_schedules_so_id", "sales_order_schedules", ["so_id"])
        op.create_index("ix_sales_order_schedules_so_line_id", "sales_order_schedules", ["so_line_id"])
        op.create_index("ix_sales_order_schedules_rrv_build_id", "sales_order_schedules", ["rrv_build_id"])
        op.create_index("ix_sales_order_schedules_status", "sales_order_schedules", ["status"])
        op.create_index("ix_sales_order_schedules_current_delivery_date", "sales_order_schedules", ["current_delivery_date"])

    if "sales_billing_plan_lines" not in tables:
        op.create_table(
            "sales_billing_plan_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("so_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("milestone_type", sa.String(length=30), nullable=False),
            sa.Column("description", sa.String(length=255), nullable=True),
            sa.Column("percent", PCT, nullable=False, server_default="0"),
            sa.Column("amount", MONEY, nullable=False, server_default="0"),
            sa.Column("per_unit", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("due_days", sa.Integer(), nullable=True),
            sa.Column("recovers_advance_percent", PCT, nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="not_due"),
            sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("invoiced_amount", MONEY, nullable=False, server_default="0"),
            *_timestamps(),
        )
        op.create_index("ix_sales_billing_plan_lines_so_id", "sales_billing_plan_lines", ["so_id"])

    if "sales_order_amendments" not in tables:
        op.create_table(
            "sales_order_amendments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("so_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("amendment_no", sa.Integer(), nullable=False),
            sa.Column("customer_amendment_ref", sa.String(length=150), nullable=True),
            sa.Column("customer_amendment_date", sa.Date(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("proposed", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("changes", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("value_change", MONEY, nullable=False, server_default="0"),
            sa.Column("new_grand_total", MONEY, nullable=False, server_default="0"),
            sa.Column("deviation_flags", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("required_approval_level", sa.String(length=20), nullable=True),
            sa.Column("approval_round", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("rejection_reason", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_sales_order_amendments_so_id", "sales_order_amendments", ["so_id"])
        op.create_index("ix_sales_order_amendments_status", "sales_order_amendments", ["status"])

    if "sales_delivery_extensions" not in tables:
        op.create_table(
            "sales_delivery_extensions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("so_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("schedule_ids", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("requested_on", sa.Date(), nullable=False),
            sa.Column("requested_new_date", sa.Date(), nullable=False),
            sa.Column("reason_category", sa.String(length=20), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("customer_letter_ref", sa.String(length=150), nullable=True),
            sa.Column("customer_letter_date", sa.Date(), nullable=True),
            sa.Column("granted_new_date", sa.Date(), nullable=True),
            sa.Column("with_ld", sa.Boolean(), nullable=True),
            sa.Column("token_penalty_amount", MONEY, nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="requested"),
            sa.Column("decision_remarks", sa.Text(), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_sales_delivery_extensions_so_id", "sales_delivery_extensions", ["so_id"])
        op.create_index("ix_sales_delivery_extensions_status", "sales_delivery_extensions", ["status"])

    if "sales_approvals" not in tables:
        op.create_table(
            "sales_approvals",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("entity_type", sa.String(length=30), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("level", sa.String(length=20), nullable=False),
            sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("decision", sa.String(length=20), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("stand_in", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
            *_timestamps(),
        )
        op.create_index("ix_sales_approvals_entity_type", "sales_approvals", ["entity_type"])
        op.create_index("ix_sales_approvals_entity_id", "sales_approvals", ["entity_id"])

    if "sales_attachments" not in tables:
        op.create_table(
            "sales_attachments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("entity_type", sa.String(length=30), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("doc_type", sa.String(length=30), nullable=False, server_default="other"),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=255), nullable=True),
            sa.Column("size", sa.Integer(), nullable=True),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(length=1000), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_by_name", sa.String(length=150), nullable=True),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_sales_attachments_entity_type", "sales_attachments", ["entity_type"])
        op.create_index("ix_sales_attachments_entity_id", "sales_attachments", ["entity_id"])

    # The SO ↔ vehicle link on production_rrv_builds (all nullable, additive).
    if "production_rrv_builds" in tables:
        cols = {c["name"] for c in inspector.get_columns("production_rrv_builds")}
        with op.batch_alter_table("production_rrv_builds") as batch:
            if "sales_order_id" not in cols:
                batch.add_column(sa.Column("sales_order_id", sa.Integer(), nullable=True))
                batch.create_foreign_key("fk_production_rrv_builds_sales_order_id", "sales_orders", ["sales_order_id"], ["id"])
                batch.create_index("ix_production_rrv_builds_sales_order_id", ["sales_order_id"])
            if "sales_order_line_id" not in cols:
                batch.add_column(sa.Column("sales_order_line_id", sa.Integer(), nullable=True))
                batch.create_foreign_key("fk_production_rrv_builds_sales_order_line_id", "sales_order_lines", ["sales_order_line_id"], ["id"])
            if "sales_schedule_id" not in cols:
                batch.add_column(sa.Column("sales_schedule_id", sa.Integer(), nullable=True))
                batch.create_foreign_key("fk_production_rrv_builds_sales_schedule_id", "sales_order_schedules", ["sales_schedule_id"], ["id"])
                batch.create_unique_constraint("uq_production_rrv_builds_sales_schedule_id", ["sales_schedule_id"])
            if "customer_id" not in cols:
                batch.add_column(sa.Column("customer_id", sa.Integer(), nullable=True))
                batch.create_foreign_key("fk_production_rrv_builds_customer_id", "crm_organizations", ["customer_id"], ["id"])
                batch.create_index("ix_production_rrv_builds_customer_id", ["customer_id"])

    # Register the new app in the admin's assignable-modules checklist.
    conn = op.get_bind()
    if inspector.has_table("modules") and conn.execute(
        sa.text("SELECT 1 FROM modules WHERE key = :key"), {"key": "sales"}
    ).first() is None:
        conn.execute(
            sa.text(
                "INSERT INTO modules (key, label, icon, description, is_active, sort_order, created_at, updated_at) "
                "VALUES (:key, :label, :icon, :description, true, "
                "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules), now(), now())"
            ),
            {"key": "sales", "label": "Sales", "icon": "sales",
             "description": "Sales orders from won inquiries and tenders: approval, order acknowledgement, delivery schedule per vehicle, LD and DP extensions."},
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM modules WHERE key = 'sales'"))
    inspector = sa.inspect(op.get_bind())
    if "production_rrv_builds" in set(inspector.get_table_names()):
        cols = {c["name"] for c in inspector.get_columns("production_rrv_builds")}
        with op.batch_alter_table("production_rrv_builds") as batch:
            if "customer_id" in cols:
                batch.drop_index("ix_production_rrv_builds_customer_id")
                batch.drop_constraint("fk_production_rrv_builds_customer_id", type_="foreignkey")
                batch.drop_column("customer_id")
            if "sales_schedule_id" in cols:
                batch.drop_constraint("uq_production_rrv_builds_sales_schedule_id", type_="unique")
                batch.drop_constraint("fk_production_rrv_builds_sales_schedule_id", type_="foreignkey")
                batch.drop_column("sales_schedule_id")
            if "sales_order_line_id" in cols:
                batch.drop_constraint("fk_production_rrv_builds_sales_order_line_id", type_="foreignkey")
                batch.drop_column("sales_order_line_id")
            if "sales_order_id" in cols:
                batch.drop_index("ix_production_rrv_builds_sales_order_id")
                batch.drop_constraint("fk_production_rrv_builds_sales_order_id", type_="foreignkey")
                batch.drop_column("sales_order_id")
    for table in ("sales_attachments", "sales_approvals", "sales_delivery_extensions", "sales_order_amendments",
                  "sales_billing_plan_lines", "sales_order_schedules", "sales_order_lines", "sales_orders"):
        op.execute(sa.text(f"DROP TABLE IF EXISTS {table}"))
