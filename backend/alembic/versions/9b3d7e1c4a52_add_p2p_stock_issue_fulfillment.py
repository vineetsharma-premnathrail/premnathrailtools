"""add p2p item stock-issue fulfillment fields

Revision ID: 9b3d7e1c4a52
Revises: f69e88802329
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "9b3d7e1c4a52"
down_revision = "f69e88802329"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    item_columns = {c["name"] for c in inspector.get_columns("p2p_request_items")}
    with op.batch_alter_table("p2p_request_items") as batch_op:
        if "fulfillment_status" not in item_columns:
            batch_op.add_column(sa.Column("fulfillment_status", sa.String(length=30), nullable=False, server_default="pending"))
        if "issued_from_location_id" not in item_columns:
            batch_op.add_column(sa.Column("issued_from_location_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_p2p_request_items_issued_from_location_id", "store_locations", ["issued_from_location_id"], ["id"],
            )
        if "issued_qty" not in item_columns:
            batch_op.add_column(sa.Column("issued_qty", sa.Float(), nullable=True))
        if "material_issue_id" not in item_columns:
            batch_op.add_column(sa.Column("material_issue_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_p2p_request_items_material_issue_id", "store_material_issues", ["material_issue_id"], ["id"],
            )

    issue_columns = {c["name"] for c in inspector.get_columns("store_material_issues")}
    if "p2p_request_id" not in issue_columns:
        with op.batch_alter_table("store_material_issues") as batch_op:
            batch_op.add_column(sa.Column("p2p_request_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_store_material_issues_p2p_request_id", "p2p_requests", ["p2p_request_id"], ["id"],
            )


def downgrade() -> None:
    with op.batch_alter_table("store_material_issues") as batch_op:
        batch_op.drop_constraint("fk_store_material_issues_p2p_request_id", type_="foreignkey")
        batch_op.drop_column("p2p_request_id")

    with op.batch_alter_table("p2p_request_items") as batch_op:
        batch_op.drop_constraint("fk_p2p_request_items_material_issue_id", type_="foreignkey")
        batch_op.drop_column("material_issue_id")
        batch_op.drop_column("issued_qty")
        batch_op.drop_constraint("fk_p2p_request_items_issued_from_location_id", type_="foreignkey")
        batch_op.drop_column("issued_from_location_id")
        batch_op.drop_column("fulfillment_status")
