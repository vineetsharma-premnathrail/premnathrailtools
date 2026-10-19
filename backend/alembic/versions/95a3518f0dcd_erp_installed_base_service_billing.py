"""ERP service: installed base customer/product links, spare consumption
against service requests, service billing to AR, warranty check.

- erp_projects.customer_id → crm_organizations, product_id → products.
  Backfilled from the free-text client_gst / client_company (exact GSTIN,
  else exact name — case and outer spaces ignored, no fuzzy matching, only
  when exactly one live organization matches) and model_name (exact product
  model number, else exact product name). The text columns stay for display.
- erp_service_materials: store_item_id, location_id, qty_issued,
  qty_returned, unit_cost, unit_price.
- erp_service_requests: is_chargeable, chargeable_reason, ar_transaction_id,
  billing_status, material_cost_actual.
- store_material_issues.service_request_id (issue type "service").

Revision ID: 95a3518f0dcd
Revises: 66ffe56a1a42
"""
from alembic import op
import sqlalchemy as sa

revision = "95a3518f0dcd"
down_revision = "66ffe56a1a42"
branch_labels = None
depends_on = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _add(table: str, column: sa.Column) -> None:
    if column.name not in _cols(table):
        with op.batch_alter_table(table) as batch:
            batch.add_column(column)


def _backfill_installed_base() -> None:
    bind = op.get_bind()
    orgs = bind.execute(sa.text(
        "SELECT id, name, gst_number FROM crm_organizations WHERE is_deleted IS NOT TRUE"
    )).fetchall()
    by_gst: dict[str, list[int]] = {}
    by_name: dict[str, list[int]] = {}
    for oid, name, gstin in orgs:
        if gstin and gstin.strip():
            by_gst.setdefault(gstin.strip().upper(), []).append(oid)
        if name and name.strip():
            by_name.setdefault(name.strip().lower(), []).append(oid)

    products = bind.execute(sa.text("SELECT id, name, model_number FROM products")).fetchall()
    by_model: dict[str, list[int]] = {}
    by_pname: dict[str, list[int]] = {}
    for pid, name, model in products:
        if model and model.strip():
            by_model.setdefault(model.strip().lower(), []).append(pid)
        if name and name.strip():
            by_pname.setdefault(name.strip().lower(), []).append(pid)

    machines = bind.execute(sa.text(
        "SELECT id, client_company, client_gst, model_name FROM erp_projects "
        "WHERE customer_id IS NULL OR product_id IS NULL"
    )).fetchall()
    for mid, company, gstin, model in machines:
        customer_id = None
        hits = by_gst.get((gstin or "").strip().upper()) if gstin and gstin.strip() else None
        if hits and len(hits) == 1:
            customer_id = hits[0]
        elif company and company.strip():
            hits = by_name.get(company.strip().lower())
            if hits and len(hits) == 1:
                customer_id = hits[0]
        product_id = None
        if model and model.strip():
            key = model.strip().lower()
            hits = by_model.get(key)
            if not (hits and len(hits) == 1):
                hits = by_pname.get(key)
            if hits and len(hits) == 1:
                product_id = hits[0]
        if customer_id:
            bind.execute(sa.text("UPDATE erp_projects SET customer_id = :c WHERE id = :m AND customer_id IS NULL"),
                         {"c": customer_id, "m": mid})
        if product_id:
            bind.execute(sa.text("UPDATE erp_projects SET product_id = :p WHERE id = :m AND product_id IS NULL"),
                         {"p": product_id, "m": mid})


def upgrade() -> None:
    _add("erp_projects", sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id", ondelete="SET NULL",
                                                                              name="fk_erp_projects_customer_id"), nullable=True))
    _add("erp_projects", sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="SET NULL",
                                                                             name="fk_erp_projects_product_id"), nullable=True))
    op.create_index("ix_erp_projects_customer_id", "erp_projects", ["customer_id"], if_not_exists=True)
    op.create_index("ix_erp_projects_product_id", "erp_projects", ["product_id"], if_not_exists=True)

    _add("erp_service_materials", sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id", name="fk_erp_service_materials_store_item_id"), nullable=True))
    _add("erp_service_materials", sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id", name="fk_erp_service_materials_location_id"), nullable=True))
    _add("erp_service_materials", sa.Column("qty_issued", sa.Float(), nullable=False, server_default="0"))
    _add("erp_service_materials", sa.Column("qty_returned", sa.Float(), nullable=False, server_default="0"))
    _add("erp_service_materials", sa.Column("unit_cost", sa.Float(), nullable=True))
    _add("erp_service_materials", sa.Column("unit_price", sa.Float(), nullable=True))
    op.create_index("ix_erp_service_materials_store_item_id", "erp_service_materials", ["store_item_id"], if_not_exists=True)

    _add("erp_service_requests", sa.Column("is_chargeable", sa.Boolean(), nullable=True))
    _add("erp_service_requests", sa.Column("chargeable_reason", sa.Text(), nullable=True))
    _add("erp_service_requests", sa.Column("ar_transaction_id", sa.Integer(), sa.ForeignKey("ar_transactions.id", ondelete="SET NULL",
                                                                                            name="fk_erp_service_requests_ar_transaction_id"), nullable=True))
    _add("erp_service_requests", sa.Column("billing_status", sa.String(20), nullable=True))
    _add("erp_service_requests", sa.Column("material_cost_actual", sa.Float(), nullable=False, server_default="0"))
    op.create_index("ix_erp_service_requests_ar_transaction_id", "erp_service_requests", ["ar_transaction_id"], if_not_exists=True)

    _add("store_material_issues", sa.Column("service_request_id", sa.Integer(), sa.ForeignKey("erp_service_requests.id",
                                                                                              name="fk_store_material_issues_service_request_id"), nullable=True))
    op.create_index("ix_store_material_issues_service_request_id", "store_material_issues", ["service_request_id"], if_not_exists=True)

    _backfill_installed_base()


def downgrade() -> None:
    op.drop_index("ix_store_material_issues_service_request_id", table_name="store_material_issues", if_exists=True)
    with op.batch_alter_table("store_material_issues") as batch:
        batch.drop_column("service_request_id")

    op.drop_index("ix_erp_service_requests_ar_transaction_id", table_name="erp_service_requests", if_exists=True)
    with op.batch_alter_table("erp_service_requests") as batch:
        for col in ("material_cost_actual", "billing_status", "ar_transaction_id", "chargeable_reason", "is_chargeable"):
            batch.drop_column(col)

    op.drop_index("ix_erp_service_materials_store_item_id", table_name="erp_service_materials", if_exists=True)
    with op.batch_alter_table("erp_service_materials") as batch:
        for col in ("unit_price", "unit_cost", "qty_returned", "qty_issued", "location_id", "store_item_id"):
            batch.drop_column(col)

    op.drop_index("ix_erp_projects_product_id", table_name="erp_projects", if_exists=True)
    op.drop_index("ix_erp_projects_customer_id", table_name="erp_projects", if_exists=True)
    with op.batch_alter_table("erp_projects") as batch:
        batch.drop_column("product_id")
        batch.drop_column("customer_id")
