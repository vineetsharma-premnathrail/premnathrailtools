"""add project/plant head approval fields to p2p_requests

Revision ID: e1a9c4d7f3b2
Revises: d3f6b8a2c1e9
Create Date: 2026-08-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e1a9c4d7f3b2'
down_revision = 'd3f6b8a2c1e9'
branch_labels = None
depends_on = None

NEW_COLUMNS = [
    ("department_head_approved_at", sa.DateTime(timezone=True)),
    ("project_head_id", sa.Integer()),
    ("project_head_name", sa.String(length=150)),
    ("project_head_approved_at", sa.DateTime(timezone=True)),
    ("plant_head_id", sa.Integer()),
    ("plant_head_name", sa.String(length=150)),
    ("plant_head_approved_at", sa.DateTime(timezone=True)),
    ("rejected_by_role", sa.String(length=30)),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
    for name, col_type in NEW_COLUMNS:
        if name not in columns:
            op.add_column("p2p_requests", sa.Column(name, col_type, nullable=True))
    if "project_head_id" not in columns:
        op.create_foreign_key("p2p_requests_project_head_id_fkey", "p2p_requests", "users", ["project_head_id"], ["id"])
    if "plant_head_id" not in columns:
        op.create_foreign_key("p2p_requests_plant_head_id_fkey", "p2p_requests", "users", ["plant_head_id"], ["id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
    if "project_head_id" in columns:
        op.drop_constraint("p2p_requests_project_head_id_fkey", "p2p_requests", type_="foreignkey")
    if "plant_head_id" in columns:
        op.drop_constraint("p2p_requests_plant_head_id_fkey", "p2p_requests", type_="foreignkey")
    for name, _ in NEW_COLUMNS:
        if name in columns:
            op.drop_column("p2p_requests", name)
