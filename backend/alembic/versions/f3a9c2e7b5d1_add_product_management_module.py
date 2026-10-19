"""Product Management module: product master, applications, specifications.

Revision ID: f3a9c2e7b5d1
Revises: c4e8a1f3b7d2
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "f3a9c2e7b5d1"
down_revision = "c4e8a1f3b7d2"
branch_labels = None
depends_on = None

MODULE_LABEL = "Product Management"
MODULE_DESCRIPTION = "Finished products the company makes and sells, their applications and technical specifications."


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if "product_applications" not in existing:
        op.create_table(
            "product_applications",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(length=30), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_product_applications_code", "product_applications", ["code"], unique=True)

    if "products" not in existing:
        op.create_table(
            "products",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(length=30), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("product_type", sa.String(length=30), nullable=False),
            sa.Column("model_number", sa.String(length=100), nullable=True),
            sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
            sa.Column("short_description", sa.String(length=300), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("hsn_code", sa.String(length=20), nullable=True),
            sa.Column("uom", sa.String(length=20), server_default="Nos", nullable=False),
            sa.Column("warranty_months", sa.Integer(), nullable=True),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_products_code", "products", ["code"], unique=True)
        op.create_index("ix_products_store_item_id", "products", ["store_item_id"])

    if "product_application_links" not in existing:
        op.create_table(
            "product_application_links",
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("application_id", sa.Integer(), sa.ForeignKey("product_applications.id", ondelete="CASCADE"), primary_key=True),
        )

    if "product_specifications" not in existing:
        op.create_table(
            "product_specifications",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
            sa.Column("parameter", sa.String(length=150), nullable=False),
            sa.Column("value", sa.String(length=200), nullable=False),
            sa.Column("unit", sa.String(length=30), nullable=True),
        )
        op.create_index("ix_product_specifications_product_id", "product_specifications", ["product_id"])

    # Register (or revive) the app in the modules registry, as d4f6a8c0e2b5 did for Design.
    if inspector.has_table("modules"):
        row = bind.execute(sa.text("SELECT id FROM modules WHERE key = 'products'")).first()
        if row is None:
            bind.execute(
                sa.text(
                    "INSERT INTO modules (key, label, icon, description, is_active, sort_order, created_at, updated_at) "
                    "VALUES ('products', :label, 'products', :description, true, "
                    "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules), now(), now())"
                ),
                {"label": MODULE_LABEL, "description": MODULE_DESCRIPTION},
            )
        else:
            bind.execute(
                sa.text("UPDATE modules SET label = :label, description = :description, is_active = true WHERE key = 'products'"),
                {"label": MODULE_LABEL, "description": MODULE_DESCRIPTION},
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("modules"):
        op.execute("DELETE FROM modules WHERE key = 'products'")
    existing = set(inspector.get_table_names())
    for table in ("product_specifications", "product_application_links", "products", "product_applications"):
        if table in existing:
            op.drop_table(table)
