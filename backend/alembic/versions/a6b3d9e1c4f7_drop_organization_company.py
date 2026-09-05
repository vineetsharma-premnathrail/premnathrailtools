"""drop organization company entity: company_id from branches/departments, drop companies table

Revision ID: a6b3d9e1c4f7
Revises: d4f7b0c3e6a9
Create Date: 2026-09-05 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "a6b3d9e1c4f7"
down_revision = "d4f7b0c3e6a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    branch_columns = {c["name"] for c in inspector.get_columns("branches")}
    if "company_id" in branch_columns:
        branch_fks = {fk["name"] for fk in inspector.get_foreign_keys("branches") if fk["name"]}
        with op.batch_alter_table("branches") as batch_op:
            for fk_name in branch_fks:
                fk = next(fk for fk in inspector.get_foreign_keys("branches") if fk["name"] == fk_name)
                if fk["constrained_columns"] == ["company_id"]:
                    batch_op.drop_constraint(fk_name, type_="foreignkey")
            batch_op.drop_column("company_id")

    department_columns = {c["name"] for c in inspector.get_columns("departments")}
    if "company_id" in department_columns:
        department_fks = {fk["name"] for fk in inspector.get_foreign_keys("departments") if fk["name"]}
        with op.batch_alter_table("departments") as batch_op:
            for fk_name in department_fks:
                fk = next(fk for fk in inspector.get_foreign_keys("departments") if fk["name"] == fk_name)
                if fk["constrained_columns"] == ["company_id"]:
                    batch_op.drop_constraint(fk_name, type_="foreignkey")
            batch_op.drop_column("company_id")

    if "companies" in inspector.get_table_names():
        op.drop_table("companies")


def downgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("gst_number", sa.String(length=30), nullable=True),
        sa.Column("pan_number", sa.String(length=20), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column("email", sa.String(length=150), nullable=True),
        sa.Column("logo_url", sa.String(length=500), nullable=True),
        sa.Column("letterhead_html", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("default_currency", sa.String(length=10), nullable=True),
        sa.Column("country", sa.String(length=100), nullable=True),
        sa.Column("tax_id", sa.String(length=50), nullable=True),
        sa.Column("domain", sa.String(length=100), nullable=True),
        sa.Column("date_of_establishment", sa.Date(), nullable=True),
        sa.Column("gst_category", sa.String(length=50), nullable=True),
        sa.Column("reporting_currency", sa.String(length=10), nullable=True),
        sa.Column("registration_details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.add_column("branches", sa.Column("company_id", sa.Integer(), nullable=True))
    op.add_column("departments", sa.Column("company_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "branches_company_id_fkey", "branches", "companies", ["company_id"], ["id"]
    )
    op.create_foreign_key(
        "departments_company_id_fkey", "departments", "companies", ["company_id"], ["id"]
    )
