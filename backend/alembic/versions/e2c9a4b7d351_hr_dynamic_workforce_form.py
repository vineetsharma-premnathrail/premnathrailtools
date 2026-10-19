"""HR dynamic workforce form: contractor details, contract period, portal
provisioning (work email), attendance policy / weekly off / OT eligibility,
medical & safety dates, documents checklist, exit clearance, draft flag.

Revision ID: e2c9a4b7d351
Revises: d7a1c5e93b20
"""
from alembic import op
import sqlalchemy as sa

revision = "e2c9a4b7d351"
down_revision = "d7a1c5e93b20"
branch_labels = None
depends_on = None

_TABLE = "hr_employee_profiles"
_COLS = [
    ("contractor_worker_id", lambda: sa.Column("contractor_worker_id", sa.String(50), nullable=True)),
    ("contractor_contact_person", lambda: sa.Column("contractor_contact_person", sa.String(150), nullable=True)),
    ("contractor_contact_phone", lambda: sa.Column("contractor_contact_phone", sa.String(30), nullable=True)),
    ("contractor_agreement_ref", lambda: sa.Column("contractor_agreement_ref", sa.String(100), nullable=True)),
    ("contract_start_date", lambda: sa.Column("contract_start_date", sa.Date(), nullable=True)),
    ("contract_end_date", lambda: sa.Column("contract_end_date", sa.Date(), nullable=True)),
    ("portal_access", lambda: sa.Column("portal_access", sa.Boolean(), nullable=False, server_default="false")),
    ("work_email", lambda: sa.Column("work_email", sa.String(255), nullable=True)),
    ("attendance_policy", lambda: sa.Column("attendance_policy", sa.String(20), nullable=True)),
    ("weekly_off", lambda: sa.Column("weekly_off", sa.String(30), nullable=True)),
    ("ot_eligible", lambda: sa.Column("ot_eligible", sa.Boolean(), nullable=True)),
    ("medical_fitness_date", lambda: sa.Column("medical_fitness_date", sa.Date(), nullable=True)),
    ("safety_induction_date", lambda: sa.Column("safety_induction_date", sa.Date(), nullable=True)),
    ("documents_received", lambda: sa.Column("documents_received", sa.JSON(), nullable=True)),
    ("exit_clearance_done", lambda: sa.Column("exit_clearance_done", sa.Boolean(), nullable=False, server_default="false")),
    ("is_draft", lambda: sa.Column("is_draft", sa.Boolean(), nullable=False, server_default="false")),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {c["name"] for c in inspector.get_columns(_TABLE)}
    indexes = {i["name"] for i in inspector.get_indexes(_TABLE)}
    with op.batch_alter_table(_TABLE) as batch:
        for name, col in _COLS:
            if name not in existing:
                batch.add_column(col())
    if "ix_hr_employee_profiles_work_email" not in indexes:
        op.create_index("ix_hr_employee_profiles_work_email", _TABLE, ["work_email"])


def downgrade() -> None:
    op.drop_index("ix_hr_employee_profiles_work_email", table_name=_TABLE)
    with op.batch_alter_table(_TABLE) as batch:
        for name, _ in reversed(_COLS):
            batch.drop_column(name)
