"""HR workforce master: worker type (office / factory / contract) on the
employee profile, and employees without a portal account (user_id nullable,
own name, joining date, reporting manager and contractor name).

Revision ID: b4e8d2f61c97
Revises: a7c3e91f2b40
"""
from alembic import op
import sqlalchemy as sa

revision = "b4e8d2f61c97"
down_revision = "a7c3e91f2b40"
branch_labels = None
depends_on = None

_TABLE = "hr_employee_profiles"
_COLS = [
    ("worker_type", lambda: sa.Column("worker_type", sa.String(20), nullable=False, server_default="office")),
    ("full_name", lambda: sa.Column("full_name", sa.String(150), nullable=True)),
    ("date_of_joining", lambda: sa.Column("date_of_joining", sa.Date(), nullable=True)),
    ("reporting_manager_id", lambda: sa.Column("reporting_manager_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True)),
    ("contractor_name", lambda: sa.Column("contractor_name", sa.String(150), nullable=True)),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {c["name"] for c in inspector.get_columns(_TABLE)}
    indexes = {i["name"] for i in inspector.get_indexes(_TABLE)}
    with op.batch_alter_table(_TABLE) as batch:
        for name, col in _COLS:
            if name not in existing:
                batch.add_column(col())
        batch.alter_column("user_id", existing_type=sa.Integer(), nullable=True)
    if "ix_hr_employee_profiles_worker_type" not in indexes:
        op.create_index("ix_hr_employee_profiles_worker_type", _TABLE, ["worker_type"])
    if "ix_hr_employee_profiles_reporting_manager_id" not in indexes:
        op.create_index("ix_hr_employee_profiles_reporting_manager_id", _TABLE, ["reporting_manager_id"])


def downgrade() -> None:
    # Workers without a portal account can't survive user_id NOT NULL.
    op.execute(f"DELETE FROM {_TABLE} WHERE user_id IS NULL")
    op.drop_index("ix_hr_employee_profiles_reporting_manager_id", table_name=_TABLE)
    op.drop_index("ix_hr_employee_profiles_worker_type", table_name=_TABLE)
    with op.batch_alter_table(_TABLE) as batch:
        batch.alter_column("user_id", existing_type=sa.Integer(), nullable=False)
        for name, _ in reversed(_COLS):
            batch.drop_column(name)
