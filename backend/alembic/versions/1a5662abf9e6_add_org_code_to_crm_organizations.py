"""add org_code to crm_organizations

Revision ID: 1a5662abf9e6
Revises: 7194d06da32c
Create Date: 2026-08-31
"""
from alembic import op
import sqlalchemy as sa
from datetime import date

revision = "1a5662abf9e6"
down_revision = "7194d06da32c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("crm_organizations")}
    if "org_code" not in columns:
        op.add_column(
            "crm_organizations",
            sa.Column("org_code", sa.String(length=30), nullable=True),
        )
        op.create_index(
            "ix_crm_organizations_org_code", "crm_organizations", ["org_code"], unique=True
        )

    year = date.today().year
    prefix = f"ORG-{year}-"
    orgs = bind.execute(
        sa.text("SELECT id FROM crm_organizations WHERE org_code IS NULL ORDER BY id ASC")
    ).fetchall()
    for i, row in enumerate(orgs, start=1):
        code = f"{prefix}{i:04d}"
        bind.execute(
            sa.text("UPDATE crm_organizations SET org_code = :code WHERE id = :id"),
            {"code": code, "id": row[0]},
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_organizations")}
    if "org_code" in columns:
        op.drop_index("ix_crm_organizations_org_code", table_name="crm_organizations")
        op.drop_column("crm_organizations", "org_code")
