"""R&D projects: origin + source — why the project exists (customer
requirement / improvement of an existing product / internal new development /
process research) and the record that proves it.

Revision ID: c4e8a2f6b913
Revises: f1b6d3a8c472
"""
from alembic import op
import sqlalchemy as sa

revision = "c4e8a2f6b913"
down_revision = "f1b6d3a8c472"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("origin", lambda: sa.Column("origin", sa.String(length=30), nullable=True)),
    ("source_kind", lambda: sa.Column("source_kind", sa.String(length=30), nullable=True)),
    ("source_id", lambda: sa.Column("source_id", sa.Integer(), nullable=True)),
    ("source_ref", lambda: sa.Column("source_ref", sa.String(length=255), nullable=True)),
    ("improvement_reason", lambda: sa.Column("improvement_reason", sa.String(length=30), nullable=True)),
    ("product_id", lambda: sa.Column("product_id", sa.Integer(), nullable=True)),
    ("origin_note", lambda: sa.Column("origin_note", sa.Text(), nullable=True)),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    cols = {c["name"] for c in inspector.get_columns("rnd_projects")}
    missing = [(name, make) for name, make in _COLUMNS if name not in cols]
    if missing:
        with op.batch_alter_table("rnd_projects") as batch:
            for name, make in missing:
                batch.add_column(make())
            if any(name == "product_id" for name, _ in missing):
                batch.create_foreign_key("fk_rnd_projects_product_id", "products", ["product_id"], ["id"], ondelete="SET NULL")
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("rnd_projects")}
    if "ix_rnd_projects_origin" not in indexes:
        op.create_index("ix_rnd_projects_origin", "rnd_projects", ["origin"])


def downgrade() -> None:
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("rnd_projects")}
    if "ix_rnd_projects_origin" in indexes:
        op.drop_index("ix_rnd_projects_origin", table_name="rnd_projects")
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("rnd_projects")}
    with op.batch_alter_table("rnd_projects") as batch:
        if "product_id" in cols:
            batch.drop_constraint("fk_rnd_projects_product_id", type_="foreignkey")
        for name, _ in reversed(_COLUMNS):
            if name in cols:
                batch.drop_column(name)
