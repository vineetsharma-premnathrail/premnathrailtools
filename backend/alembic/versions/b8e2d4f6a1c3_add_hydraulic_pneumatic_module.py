"""add hydraulic & pneumatic module (systems, component master, circuits, BOM,
calculations, testing, maintenance plans, service records, spare parts, documents)

New `hyd_*` tables — prefixed `hyd_` rather than `hydraulic_` so nothing
collides with the R&D tool's existing `hydraulic_calculations` history
table. Also registers the "hydraulic" app in the admin's assignable-modules
checklist.

Revision ID: b8e2d4f6a1c3
Revises: e8b0c2d4f6a1
Create Date: 2026-09-30 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b8e2d4f6a1c3'
down_revision = 'e8b0c2d4f6a1'
branch_labels = None
depends_on = None

MODULE_KEY = "hydraulic"
MODULE_LABEL = "Hydraulic & Pneumatic"
MODULE_DESCRIPTION = "Hydraulic and pneumatic systems, component master, circuits, BOM, calculations, testing, maintenance, service records and spares."

# Creation order (parents first); dropped in reverse.
TABLES = (
    "hyd_systems",
    "hyd_components",
    "hyd_circuits",
    "hyd_boms",
    "hyd_bom_items",
    "hyd_calculations",
    "hyd_tests",
    "hyd_test_readings",
    "hyd_maintenance_plans",
    "hyd_spare_parts",
    "hyd_service_records",
    "hyd_service_parts",
    "hyd_documents",
)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    ]


def _soft_delete() -> list[sa.Column]:
    return [
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def _user_fk(name: str) -> sa.Column:
    return sa.Column(name, sa.Integer(), sa.ForeignKey("users.id"), nullable=True)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = set(inspector.get_table_names())

    if "hyd_systems" not in existing:
        op.create_table(
            "hyd_systems",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("system_number", sa.String(50), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("system_type", sa.String(20), nullable=False, server_default="hydraulic"),
            sa.Column("application", sa.String(200), nullable=True),
            sa.Column("status", sa.String(30), nullable=False, server_default="design"),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("equipment_ref", sa.String(150), nullable=True),
            sa.Column("location", sa.String(200), nullable=True),
            sa.Column("working_pressure_bar", sa.Float(), nullable=True),
            sa.Column("max_pressure_bar", sa.Float(), nullable=True),
            sa.Column("flow_rate", sa.Float(), nullable=True),
            sa.Column("reservoir_capacity_l", sa.Float(), nullable=True),
            sa.Column("prime_mover_kw", sa.Float(), nullable=True),
            sa.Column("fluid_medium", sa.String(150), nullable=True),
            sa.Column("filtration_micron", sa.Float(), nullable=True),
            sa.Column("cleanliness_target", sa.String(30), nullable=True),
            sa.Column("operating_temp_min_c", sa.Float(), nullable=True),
            sa.Column("operating_temp_max_c", sa.Float(), nullable=True),
            sa.Column("commissioned_on", sa.Date(), nullable=True),
            sa.Column("running_hours", sa.Float(), nullable=False, server_default="0"),
            _user_fk("owner_id"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            _user_fk("created_by_id"),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_hyd_systems_system_number", "hyd_systems", ["system_number"], unique=True)
        op.create_index("ix_hyd_systems_system_type", "hyd_systems", ["system_type"])
        op.create_index("ix_hyd_systems_erp_project_id", "hyd_systems", ["erp_project_id"])

    if "hyd_components" not in existing:
        op.create_table(
            "hyd_components",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(30), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("category", sa.String(30), nullable=False),
            sa.Column("system_type", sa.String(20), nullable=False, server_default="hydraulic"),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("manufacturer", sa.String(150), nullable=True),
            sa.Column("model_number", sa.String(100), nullable=True),
            sa.Column("part_number", sa.String(100), nullable=True),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("rated_pressure_bar", sa.Float(), nullable=True),
            sa.Column("max_pressure_bar", sa.Float(), nullable=True),
            sa.Column("flow_rate_lpm", sa.Float(), nullable=True),
            sa.Column("displacement_cc", sa.Float(), nullable=True),
            sa.Column("bore_mm", sa.Float(), nullable=True),
            sa.Column("rod_mm", sa.Float(), nullable=True),
            sa.Column("stroke_mm", sa.Float(), nullable=True),
            sa.Column("port_size", sa.String(50), nullable=True),
            sa.Column("mounting", sa.String(100), nullable=True),
            sa.Column("media", sa.String(100), nullable=True),
            sa.Column("seal_material", sa.String(50), nullable=True),
            sa.Column("temp_min_c", sa.Float(), nullable=True),
            sa.Column("temp_max_c", sa.Float(), nullable=True),
            sa.Column("weight_kg", sa.Float(), nullable=True),
            sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("specifications", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("datasheet_url", sa.String(1000), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            _user_fk("created_by_id"),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_hyd_components_code", "hyd_components", ["code"], unique=True)
        op.create_index("ix_hyd_components_category", "hyd_components", ["category"])
        op.create_index("ix_hyd_components_system_type", "hyd_components", ["system_type"])
        op.create_index("ix_hyd_components_store_item_id", "hyd_components", ["store_item_id"])

    if "hyd_circuits" not in existing:
        op.create_table(
            "hyd_circuits",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("circuit_number", sa.String(50), nullable=False),
            sa.Column("revision", sa.String(10), nullable=False, server_default="A"),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("system_type", sa.String(20), nullable=False, server_default="hydraulic"),
            sa.Column("system_id", sa.Integer(), sa.ForeignKey("hyd_systems.id"), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("drawing_number", sa.String(100), nullable=True),
            sa.Column("symbol_standard", sa.String(100), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("change_note", sa.Text(), nullable=True),
            _user_fk("created_by_id"),
            _user_fk("submitted_by_id"),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            _user_fk("approved_by_id"),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("review_remarks", sa.Text(), nullable=True),
            *_timestamps(),
            *_soft_delete(),
            sa.UniqueConstraint("circuit_number", "revision", name="uq_hyd_circuits_number_revision"),
        )
        op.create_index("ix_hyd_circuits_circuit_number", "hyd_circuits", ["circuit_number"])
        op.create_index("ix_hyd_circuits_system_id", "hyd_circuits", ["system_id"])

    if "hyd_boms" not in existing:
        op.create_table(
            "hyd_boms",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bom_number", sa.String(50), nullable=False),
            sa.Column("revision", sa.String(10), nullable=False, server_default="A"),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("system_type", sa.String(20), nullable=False, server_default="hydraulic"),
            sa.Column("system_id", sa.Integer(), sa.ForeignKey("hyd_systems.id"), nullable=True),
            sa.Column("circuit_id", sa.Integer(), sa.ForeignKey("hyd_circuits.id"), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("remarks", sa.Text(), nullable=True),
            _user_fk("created_by_id"),
            _user_fk("released_by_id"),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_hyd_boms_bom_number", "hyd_boms", ["bom_number"])
        op.create_index("ix_hyd_boms_system_id", "hyd_boms", ["system_id"])

    if "hyd_bom_items" not in existing:
        op.create_table(
            "hyd_bom_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("hyd_boms.id"), nullable=False),
            sa.Column("component_id", sa.Integer(), sa.ForeignKey("hyd_components.id"), nullable=False),
            sa.Column("tag_number", sa.String(30), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("uom", sa.String(20), nullable=False, server_default="NOS"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            *_timestamps(),
        )
        op.create_index("ix_hyd_bom_items_bom_id", "hyd_bom_items", ["bom_id"])
        op.create_index("ix_hyd_bom_items_component_id", "hyd_bom_items", ["component_id"])

    if "hyd_calculations" not in existing:
        op.create_table(
            "hyd_calculations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("calc_number", sa.String(50), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("calc_type", sa.String(50), nullable=False),
            sa.Column("system_type", sa.String(20), nullable=False),
            sa.Column("system_id", sa.Integer(), sa.ForeignKey("hyd_systems.id"), nullable=True),
            sa.Column("inputs", sa.JSON(), nullable=False),
            sa.Column("results", sa.JSON(), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            _user_fk("created_by_id"),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_hyd_calculations_calc_number", "hyd_calculations", ["calc_number"], unique=True)
        op.create_index("ix_hyd_calculations_calc_type", "hyd_calculations", ["calc_type"])
        op.create_index("ix_hyd_calculations_system_id", "hyd_calculations", ["system_id"])

    if "hyd_tests" not in existing:
        op.create_table(
            "hyd_tests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("test_number", sa.String(50), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("test_type", sa.String(30), nullable=False),
            sa.Column("system_type", sa.String(20), nullable=False, server_default="hydraulic"),
            sa.Column("system_id", sa.Integer(), sa.ForeignKey("hyd_systems.id"), nullable=True),
            sa.Column("component_id", sa.Integer(), sa.ForeignKey("hyd_components.id"), nullable=True),
            sa.Column("component_serial", sa.String(100), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="planned"),
            sa.Column("result", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("test_date", sa.Date(), nullable=True),
            sa.Column("test_standard", sa.String(150), nullable=True),
            sa.Column("test_pressure_bar", sa.Float(), nullable=True),
            sa.Column("hold_time_min", sa.Float(), nullable=True),
            sa.Column("test_medium", sa.String(100), nullable=True),
            sa.Column("ambient_temp_c", sa.Float(), nullable=True),
            sa.Column("fluid_temp_c", sa.Float(), nullable=True),
            _user_fk("tested_by_id"),
            sa.Column("witnessed_by", sa.String(200), nullable=True),
            sa.Column("observations", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            _user_fk("created_by_id"),
            _user_fk("completed_by_id"),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_hyd_tests_test_number", "hyd_tests", ["test_number"], unique=True)
        op.create_index("ix_hyd_tests_test_type", "hyd_tests", ["test_type"])
        op.create_index("ix_hyd_tests_system_id", "hyd_tests", ["system_id"])
        op.create_index("ix_hyd_tests_component_id", "hyd_tests", ["component_id"])

    if "hyd_test_readings" not in existing:
        op.create_table(
            "hyd_test_readings",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("test_id", sa.Integer(), sa.ForeignKey("hyd_tests.id"), nullable=False),
            sa.Column("parameter", sa.String(200), nullable=False),
            sa.Column("unit", sa.String(30), nullable=True),
            sa.Column("specification", sa.String(255), nullable=True),
            sa.Column("min_value", sa.Float(), nullable=True),
            sa.Column("max_value", sa.Float(), nullable=True),
            sa.Column("measured_value", sa.Float(), nullable=True),
            sa.Column("measured_text", sa.String(255), nullable=True),
            sa.Column("result", sa.String(10), nullable=False, server_default="na"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            *_timestamps(),
        )
        op.create_index("ix_hyd_test_readings_test_id", "hyd_test_readings", ["test_id"])

    if "hyd_maintenance_plans" not in existing:
        op.create_table(
            "hyd_maintenance_plans",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("plan_number", sa.String(50), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("system_id", sa.Integer(), sa.ForeignKey("hyd_systems.id"), nullable=False),
            sa.Column("maintenance_type", sa.String(30), nullable=False, server_default="preventive"),
            sa.Column("frequency_days", sa.Integer(), nullable=True),
            sa.Column("frequency_hours", sa.Float(), nullable=True),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("last_done_date", sa.Date(), nullable=True),
            sa.Column("last_done_hours", sa.Float(), nullable=True),
            sa.Column("next_due_date", sa.Date(), nullable=True),
            _user_fk("assigned_to_id"),
            sa.Column("checklist", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("remarks", sa.Text(), nullable=True),
            _user_fk("created_by_id"),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_hyd_maintenance_plans_plan_number", "hyd_maintenance_plans", ["plan_number"], unique=True)
        op.create_index("ix_hyd_maintenance_plans_system_id", "hyd_maintenance_plans", ["system_id"])
        op.create_index("ix_hyd_maintenance_plans_next_due_date", "hyd_maintenance_plans", ["next_due_date"])

    if "hyd_spare_parts" not in existing:
        op.create_table(
            "hyd_spare_parts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("part_code", sa.String(30), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("category", sa.String(30), nullable=False, server_default="other"),
            sa.Column("system_type", sa.String(20), nullable=False, server_default="hydraulic"),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("criticality", sa.String(20), nullable=False, server_default="essential"),
            sa.Column("component_id", sa.Integer(), sa.ForeignKey("hyd_components.id"), nullable=True),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("manufacturer", sa.String(150), nullable=True),
            sa.Column("part_number", sa.String(100), nullable=True),
            sa.Column("uom", sa.String(20), nullable=False, server_default="NOS"),
            sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("min_stock_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("reorder_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("lead_time_days", sa.Integer(), nullable=True),
            sa.Column("shelf_life_months", sa.Integer(), nullable=True),
            sa.Column("interchangeable_with", sa.String(255), nullable=True),
            sa.Column("storage_notes", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            _user_fk("created_by_id"),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_hyd_spare_parts_part_code", "hyd_spare_parts", ["part_code"], unique=True)
        op.create_index("ix_hyd_spare_parts_component_id", "hyd_spare_parts", ["component_id"])
        op.create_index("ix_hyd_spare_parts_store_item_id", "hyd_spare_parts", ["store_item_id"])

    if "hyd_service_records" not in existing:
        op.create_table(
            "hyd_service_records",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("record_number", sa.String(50), nullable=False),
            sa.Column("system_id", sa.Integer(), sa.ForeignKey("hyd_systems.id"), nullable=False),
            sa.Column("plan_id", sa.Integer(), sa.ForeignKey("hyd_maintenance_plans.id"), nullable=True),
            sa.Column("service_type", sa.String(30), nullable=False, server_default="preventive"),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("service_date", sa.Date(), nullable=False),
            sa.Column("completed_on", sa.Date(), nullable=True),
            sa.Column("reported_problem", sa.Text(), nullable=True),
            sa.Column("root_cause", sa.Text(), nullable=True),
            sa.Column("work_done", sa.Text(), nullable=True),
            sa.Column("checklist", sa.Text(), nullable=True),
            _user_fk("performed_by_id"),
            sa.Column("external_agency", sa.String(200), nullable=True),
            sa.Column("running_hours", sa.Float(), nullable=True),
            sa.Column("downtime_hours", sa.Float(), nullable=False, server_default="0"),
            sa.Column("fluid_added_l", sa.Float(), nullable=False, server_default="0"),
            sa.Column("oil_condition", sa.String(100), nullable=True),
            sa.Column("labour_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("other_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("next_service_date", sa.Date(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            _user_fk("created_by_id"),
            _user_fk("completed_by_id"),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_hyd_service_records_record_number", "hyd_service_records", ["record_number"], unique=True)
        op.create_index("ix_hyd_service_records_system_id", "hyd_service_records", ["system_id"])
        op.create_index("ix_hyd_service_records_plan_id", "hyd_service_records", ["plan_id"])

    if "hyd_service_parts" not in existing:
        op.create_table(
            "hyd_service_parts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("record_id", sa.Integer(), sa.ForeignKey("hyd_service_records.id"), nullable=False),
            sa.Column("spare_part_id", sa.Integer(), sa.ForeignKey("hyd_spare_parts.id"), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("issued_location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_hyd_service_parts_record_id", "hyd_service_parts", ["record_id"])
        op.create_index("ix_hyd_service_parts_spare_part_id", "hyd_service_parts", ["spare_part_id"])

    if "hyd_documents" not in existing:
        op.create_table(
            "hyd_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("entity_type", sa.String(30), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("doc_type", sa.String(30), nullable=False, server_default="other"),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("sharepoint_path", sa.String(1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(1000), nullable=True),
            sa.Column("file_size", sa.Integer(), nullable=True),
            sa.Column("mime_type", sa.String(255), nullable=True),
            _user_fk("uploaded_by_id"),
            sa.Column("uploaded_by_name", sa.String(150), nullable=True),
            *_timestamps(),
            *_soft_delete(),
        )
        op.create_index("ix_hyd_documents_entity", "hyd_documents", ["entity_type", "entity_id"])

    # Register the new app in the admin's assignable-modules checklist.
    conn = op.get_bind()
    if inspector.has_table("modules") and conn.execute(
        sa.text("SELECT 1 FROM modules WHERE key = :key"), {"key": MODULE_KEY}
    ).first() is None:
        conn.execute(
            sa.text(
                "INSERT INTO modules (key, label, icon, description, is_active, sort_order, created_at, updated_at) "
                "VALUES (:key, :label, :icon, :description, true, "
                "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules), now(), now())"
            ),
            {"key": MODULE_KEY, "label": MODULE_LABEL, "icon": "hydraulic", "description": MODULE_DESCRIPTION},
        )


def downgrade() -> None:
    op.execute(sa.text(f"DELETE FROM modules WHERE key = '{MODULE_KEY}'"))
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in reversed(TABLES):
        if table in existing:
            op.drop_table(table)
