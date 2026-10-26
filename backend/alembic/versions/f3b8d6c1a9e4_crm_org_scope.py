"""Customer scope (Domestic / International) and international tax fields.

crm_organizations gets org_scope (NOT NULL, default 'domestic', CHECK),
tax_vat_id and company_registration_no (nullable).
Back-fill (old rows only): international where country is set, not India and
gst_number is empty; everything else stays domestic.

Revision ID: f3b8d6c1a9e4
Revises: e2a7c5b9d1f3
"""
from alembic import op
import sqlalchemy as sa

revision = "f3b8d6c1a9e4"
down_revision = "e2a7c5b9d1f3"
branch_labels = None
depends_on = None

TABLE = "crm_organizations"
CK = "ck_crm_organizations_org_scope"


def _cols() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}


def _checks() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_check_constraints(TABLE)}


def upgrade() -> None:
    if TABLE not in sa.inspect(op.get_bind()).get_table_names():
        return
    cols = _cols()
    fresh_scope = "org_scope" not in cols
    if fresh_scope:
        op.add_column(TABLE, sa.Column("org_scope", sa.String(15), nullable=False, server_default="domestic"))
    if "tax_vat_id" not in cols:
        op.add_column(TABLE, sa.Column("tax_vat_id", sa.String(50), nullable=True))
    if "company_registration_no" not in cols:
        op.add_column(TABLE, sa.Column("company_registration_no", sa.String(50), nullable=True))
    if fresh_scope:
        op.execute(
            "UPDATE crm_organizations SET org_scope = 'international' "
            "WHERE country IS NOT NULL AND TRIM(country) <> '' "
            "AND LOWER(TRIM(country)) <> 'india' "
            "AND (gst_number IS NULL OR TRIM(gst_number) = '')"
        )
    if CK not in _checks():
        op.create_check_constraint(CK, TABLE, "org_scope IN ('domestic','international')")


def downgrade() -> None:
    if TABLE not in sa.inspect(op.get_bind()).get_table_names():
        return
    if CK in _checks():
        op.drop_constraint(CK, TABLE, type_="check")
    cols = _cols()
    for name in ("company_registration_no", "tax_vat_id", "org_scope"):
        if name in cols:
            op.drop_column(TABLE, name)
