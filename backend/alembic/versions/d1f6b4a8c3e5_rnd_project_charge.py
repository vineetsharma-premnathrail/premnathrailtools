"""Charge New development purchases to an R&D project.

rnd_projects.internal_order_id (unique, nullable) and
p2p_requests.rnd_project_id (indexed, nullable). The 'development' internal
order type needs no DB change (type is a plain string).

Revision ID: d1f6b4a8c3e5
Revises: c9e5a3b7d2f4
"""
from alembic import op
import sqlalchemy as sa

revision = "d1f6b4a8c3e5"
down_revision = "c9e5a3b7d2f4"
branch_labels = None
depends_on = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    if "internal_order_id" not in _cols("rnd_projects"):
        op.add_column("rnd_projects", sa.Column("internal_order_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_rnd_projects_internal_order_id", "rnd_projects", "internal_orders",
            ["internal_order_id"], ["id"], ondelete="SET NULL")
    if "uq_rnd_projects_internal_order_id" not in _indexes("rnd_projects"):
        op.create_index("uq_rnd_projects_internal_order_id", "rnd_projects", ["internal_order_id"], unique=True)

    if "rnd_project_id" not in _cols("p2p_requests"):
        op.add_column("p2p_requests", sa.Column("rnd_project_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_p2p_requests_rnd_project_id", "p2p_requests", "rnd_projects",
            ["rnd_project_id"], ["id"], ondelete="SET NULL")
    if "ix_p2p_requests_rnd_project_id" not in _indexes("p2p_requests"):
        op.create_index("ix_p2p_requests_rnd_project_id", "p2p_requests", ["rnd_project_id"])


def downgrade() -> None:
    if "ix_p2p_requests_rnd_project_id" in _indexes("p2p_requests"):
        op.drop_index("ix_p2p_requests_rnd_project_id", table_name="p2p_requests")
    if "rnd_project_id" in _cols("p2p_requests"):
        op.drop_constraint("fk_p2p_requests_rnd_project_id", "p2p_requests", type_="foreignkey")
        op.drop_column("p2p_requests", "rnd_project_id")
    if "uq_rnd_projects_internal_order_id" in _indexes("rnd_projects"):
        op.drop_index("uq_rnd_projects_internal_order_id", table_name="rnd_projects")
    if "internal_order_id" in _cols("rnd_projects"):
        op.drop_constraint("fk_rnd_projects_internal_order_id", "rnd_projects", type_="foreignkey")
        op.drop_column("rnd_projects", "internal_order_id")
