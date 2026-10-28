"""Quotation line application: a quotation line may add an application (add-on) to its product.

New nullable column crm_quotation_line_items.application_id (FK products — an application
is a product of type 'application'); existing lines stay blank.

Revision ID: a3d5e7f9c1b2
Revises: f1a7c3e9b2d4
"""
from alembic import op
import sqlalchemy as sa

revision = "a3d5e7f9c1b2"
down_revision = "f1a7c3e9b2d4"
branch_labels = None
depends_on = None

TABLE = "crm_quotation_line_items"


def upgrade():
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}
    if "application_id" not in cols:
        op.add_column(TABLE, sa.Column("application_id", sa.Integer(), nullable=True))
        op.create_foreign_key("fk_quote_line_application", TABLE, "products", ["application_id"], ["id"], ondelete="SET NULL")
        op.create_index("ix_crm_quotation_line_items_application_id", TABLE, ["application_id"])


def downgrade():
    op.drop_index("ix_crm_quotation_line_items_application_id", table_name=TABLE)
    op.drop_constraint("fk_quote_line_application", TABLE, type_="foreignkey")
    op.drop_column(TABLE, "application_id")
