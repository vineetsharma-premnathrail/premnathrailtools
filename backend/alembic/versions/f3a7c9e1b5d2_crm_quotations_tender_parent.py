"""CRM quotations can belong to a tender (price bid) as well as an inquiry: crm_quotations
gets a nullable tender_id (FK crm_tenders), inquiry_id becomes nullable, and a check
constraint keeps exactly one parent. Existing rows all have an inquiry, so nothing is
back-filled and the constraint validates immediately.

Revision ID: f3a7c9e1b5d2
Revises: d6f1b3a5c7e9
"""
from alembic import op
import sqlalchemy as sa

revision = "f3a7c9e1b5d2"
down_revision = "d6f1b3a5c7e9"
branch_labels = None
depends_on = None

_TABLE = "crm_quotations"
_ONE_PARENT = "(inquiry_id IS NULL) <> (tender_id IS NULL)"


def _insp():
    return sa.inspect(op.get_bind())


def _has_table() -> bool:
    return _insp().has_table(_TABLE)


def _cols() -> set[str]:
    return {c["name"] for c in _insp().get_columns(_TABLE)}


def _checks() -> set[str]:
    return {c["name"] for c in _insp().get_check_constraints(_TABLE)}


def upgrade() -> None:
    if not _has_table():
        return  # fresh install: the table is created from the models with the new shape
    if "tender_id" not in _cols():
        with op.batch_alter_table(_TABLE) as batch:
            batch.add_column(sa.Column("tender_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_crm_quotations_tender", "crm_tenders", ["tender_id"], ["id"])
            batch.create_index("ix_crm_quotations_tender_id", ["tender_id"])
    with op.batch_alter_table(_TABLE) as batch:
        batch.alter_column("inquiry_id", existing_type=sa.Integer(), nullable=True)
        if "ck_crm_quotations_one_parent" not in _checks():
            batch.create_check_constraint("ck_crm_quotations_one_parent", _ONE_PARENT)


def downgrade() -> None:
    if not _has_table() or "tender_id" not in _cols():
        return
    n = op.get_bind().execute(sa.text(f"SELECT COUNT(*) FROM {_TABLE} WHERE tender_id IS NOT NULL")).scalar() or 0
    if n:
        raise RuntimeError(
            f"Cannot downgrade: {n} quotation(s) belong to a tender and crm_quotations.inquiry_id must go back to "
            "NOT NULL. Delete these quotations or move them to an inquiry first "
            "(UPDATE crm_quotations SET inquiry_id = <inquiry id>, tender_id = NULL WHERE tender_id IS NOT NULL), "
            "then run the downgrade again."
        )
    with op.batch_alter_table(_TABLE) as batch:
        if "ck_crm_quotations_one_parent" in _checks():
            batch.drop_constraint("ck_crm_quotations_one_parent", type_="check")
        batch.drop_index("ix_crm_quotations_tender_id")
        batch.drop_constraint("fk_crm_quotations_tender", type_="foreignkey")
        batch.drop_column("tender_id")
        batch.alter_column("inquiry_id", existing_type=sa.Integer(), nullable=False)
