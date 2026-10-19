"""HR workforce form v2: probation status as its own field (no more
'probation' employment type / status), portal role, contractor
verification, safety / medical clearance status, and document verification
(pending / verified / rejected, by whom, when). Old checklist keys move to
the new document types.

Revision ID: b8e4c1d6f372
Revises: a3d7f2c9e815
"""
from alembic import op
import sqlalchemy as sa

revision = "b8e4c1d6f372"
down_revision = "a3d7f2c9e815"
branch_labels = None
depends_on = None

_P = "hr_employee_profiles"
_PCOLS = [
    ("probation_status", lambda: sa.Column("probation_status", sa.String(20), nullable=False, server_default="not_applicable")),
    ("contractor_verification", lambda: sa.Column("contractor_verification", sa.String(20), nullable=True)),
    ("portal_role_id", lambda: sa.Column("portal_role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)),
    ("medical_clearance_status", lambda: sa.Column("medical_clearance_status", sa.String(20), nullable=True)),
    ("safety_induction_status", lambda: sa.Column("safety_induction_status", sa.String(20), nullable=True)),
]
_DCOLS = [
    ("verification_status", lambda: sa.Column("verification_status", sa.String(20), nullable=True)),
    ("verified_by_id", lambda: sa.Column("verified_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True)),
    ("verified_at", lambda: sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True)),
]
_KEY_MAP = {"aadhaar": "identity_proof", "age_proof": "identity_proof", "experience": "other",
            "contractor_id": "other", "contract_copy": "contractor_agreement"}


def _add(table, cols):
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    with op.batch_alter_table(table) as batch:
        for name, col in cols:
            if name not in existing:
                batch.add_column(col())


def upgrade() -> None:
    _add(_P, _PCOLS)
    _add("user_documents", _DCOLS)
    # Probation leaves employment type / status for its own field.
    op.execute(f"UPDATE {_P} SET probation_status = 'confirmed' WHERE confirmation_date IS NOT NULL")
    op.execute(f"UPDATE {_P} SET probation_status = 'on_probation' WHERE confirmation_date IS NULL AND "
               "(employment_status = 'probation' OR employment_type = 'probation' OR probation_end_date IS NOT NULL)")
    op.execute(f"UPDATE {_P} SET employment_status = 'active' WHERE employment_status = 'probation'")
    op.execute(f"UPDATE {_P} SET employment_type = 'permanent' WHERE employment_type = 'probation'")
    for old, new in _KEY_MAP.items():
        op.execute(f"UPDATE user_documents SET checklist_key = '{new}' WHERE checklist_key = '{old}'")
    op.execute("UPDATE user_documents SET verification_status = 'pending' WHERE checklist_key IS NOT NULL AND verification_status IS NULL")


def downgrade() -> None:
    op.execute(f"UPDATE {_P} SET employment_status = 'probation' WHERE probation_status = 'on_probation' AND employment_status = 'active'")
    with op.batch_alter_table("user_documents") as batch:
        for name, _ in reversed(_DCOLS):
            batch.drop_column(name)
    with op.batch_alter_table(_P) as batch:
        for name, _ in reversed(_PCOLS):
            batch.drop_column(name)
