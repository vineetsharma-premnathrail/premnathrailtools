"""CRM customer organization type: one name per type in both scopes.

The Domestic list said "Private" / "Govt Department" while the International list said
"Private Company" / "Government Department", so filters and reports split the same kind
of customer in two. Old records move to the one name both lists now use. Data only.

Revision ID: b2e6c4a8d1f7
Revises: a8d3f5b7c9e1
"""
from alembic import op
import sqlalchemy as sa

revision = "b2e6c4a8d1f7"
down_revision = "a8d3f5b7c9e1"
branch_labels = None
depends_on = None

_RENAMES = [("Private", "Private Company"), ("Govt Department", "Government Department")]


def upgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table("crm_organizations"):
        return
    for old, new in _RENAMES:
        op.execute(sa.text("UPDATE crm_organizations SET org_type = :new WHERE org_type = :old").bindparams(old=old, new=new))


def downgrade() -> None:
    # One-way merge: the old short name can't be told apart from records that were
    # always "Private Company" / "Government Department", so nothing is split back.
    pass
