"""rename standalone purchase requisition (pr_requests) tables/columns to p2p_requests

Revision ID: a4b1e6c8d2f3
Revises: f9a3c6e1b8d4
Create Date: 2026-08-17 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4b1e6c8d2f3'
down_revision: Union[str, Sequence[str], None] = 'f9a3c6e1b8d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Renames the standalone PR Request module's tables/columns to the new
    "P2P" naming, in place (no data loss). This is entirely distinct from
    the `purchase_requisitions` table owned by app.modules.purchase (Service
    Request materials), which is NOT touched by this migration.
    """
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    # --- pr_requests -> p2p_requests -------------------------------------
    if "pr_requests" in existing_tables and "p2p_requests" not in existing_tables:
        op.rename_table("pr_requests", "p2p_requests")

    # Recompute inspector state fresh since the table may have just been renamed.
    inspector = sa.inspect(op.get_bind())
    p2p_requests_columns = {c["name"] for c in inspector.get_columns("p2p_requests")} if "p2p_requests" in inspector.get_table_names() else set()

    if "pr_number" in p2p_requests_columns and "p2p_number" not in p2p_requests_columns:
        with op.batch_alter_table("p2p_requests") as batch_op:
            batch_op.alter_column("pr_number", new_column_name="p2p_number")

    # Rename the unique index on the renamed column, if it still exists under the old name.
    existing_indexes = {ix["name"] for ix in inspector.get_indexes("p2p_requests")} if "p2p_requests" in inspector.get_table_names() else set()
    if "ix_pr_requests_pr_number" in existing_indexes:
        op.drop_index("ix_pr_requests_pr_number", table_name="p2p_requests")
        op.create_index("ix_p2p_requests_p2p_number", "p2p_requests", ["p2p_number"], unique=True)
    elif "ix_p2p_requests_p2p_number" not in existing_indexes and "p2p_number" in p2p_requests_columns:
        op.create_index("ix_p2p_requests_p2p_number", "p2p_requests", ["p2p_number"], unique=True)

    # --- pr_request_items -> p2p_request_items ---------------------------
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())
    if "pr_request_items" in existing_tables and "p2p_request_items" not in existing_tables:
        op.rename_table("pr_request_items", "p2p_request_items")

    inspector = sa.inspect(op.get_bind())
    if "p2p_request_items" in inspector.get_table_names():
        item_columns = {c["name"] for c in inspector.get_columns("p2p_request_items")}
        if "pr_request_id" in item_columns and "p2p_request_id" not in item_columns:
            with op.batch_alter_table("p2p_request_items") as batch_op:
                batch_op.alter_column("pr_request_id", new_column_name="p2p_request_id")

    # --- pr_request_attachments -> p2p_request_attachments ---------------
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())
    if "pr_request_attachments" in existing_tables and "p2p_request_attachments" not in existing_tables:
        op.rename_table("pr_request_attachments", "p2p_request_attachments")

    inspector = sa.inspect(op.get_bind())
    if "p2p_request_attachments" in inspector.get_table_names():
        attachment_columns = {c["name"] for c in inspector.get_columns("p2p_request_attachments")}
        if "pr_request_id" in attachment_columns and "p2p_request_id" not in attachment_columns:
            with op.batch_alter_table("p2p_request_attachments") as batch_op:
                batch_op.alter_column("pr_request_id", new_column_name="p2p_request_id")


def downgrade() -> None:
    """Downgrade schema — reverse the renames, preserving data."""
    inspector = sa.inspect(op.get_bind())

    if "p2p_request_attachments" in inspector.get_table_names():
        attachment_columns = {c["name"] for c in inspector.get_columns("p2p_request_attachments")}
        if "p2p_request_id" in attachment_columns:
            with op.batch_alter_table("p2p_request_attachments") as batch_op:
                batch_op.alter_column("p2p_request_id", new_column_name="pr_request_id")
        op.rename_table("p2p_request_attachments", "pr_request_attachments")

    inspector = sa.inspect(op.get_bind())
    if "p2p_request_items" in inspector.get_table_names():
        item_columns = {c["name"] for c in inspector.get_columns("p2p_request_items")}
        if "p2p_request_id" in item_columns:
            with op.batch_alter_table("p2p_request_items") as batch_op:
                batch_op.alter_column("p2p_request_id", new_column_name="pr_request_id")
        op.rename_table("p2p_request_items", "pr_request_items")

    inspector = sa.inspect(op.get_bind())
    if "p2p_requests" in inspector.get_table_names():
        existing_indexes = {ix["name"] for ix in inspector.get_indexes("p2p_requests")}
        if "ix_p2p_requests_p2p_number" in existing_indexes:
            op.drop_index("ix_p2p_requests_p2p_number", table_name="p2p_requests")

        p2p_requests_columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
        if "p2p_number" in p2p_requests_columns:
            with op.batch_alter_table("p2p_requests") as batch_op:
                batch_op.alter_column("p2p_number", new_column_name="pr_number")

        op.rename_table("p2p_requests", "pr_requests")
        op.create_index("ix_pr_requests_pr_number", "pr_requests", ["pr_number"], unique=True)
