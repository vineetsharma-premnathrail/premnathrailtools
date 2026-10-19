"""FI receivables management (FSCM): credit releases (FD32/UKM credit
block), collection notes + dunning letters (F150 / Collections), disputes
(UDM). Key-date aging needs no schema change.

- accounts_credit_releases
- accounts_dunning_letters
- accounts_collection_notes
- accounts_disputes

Revision ID: 8259348ce2e6
Revises: 7141cbad5438
"""
from alembic import op
import sqlalchemy as sa

revision = "8259348ce2e6"
down_revision = "7141cbad5438"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)


def _ts():
    return [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)]


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "accounts_credit_releases" not in tables:
        op.create_table(
            "accounts_credit_releases",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("release_number", sa.String(30), nullable=False),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=False),
            sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id"), nullable=True),
            sa.Column("checkpoint", sa.String(20), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending_approval"),
            sa.Column("credit_limit", MONEY, nullable=True),
            sa.Column("exposure", MONEY, nullable=False, server_default="0"),
            sa.Column("overdue_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("max_days_overdue", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("block_reasons", sa.Text(), nullable=False),
            sa.Column("request_reason", sa.Text(), nullable=False),
            sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decision_comment", sa.Text(), nullable=True),
            sa.Column("valid_until", sa.Date(), nullable=True),
            *_ts(),
        )
        op.create_index("ix_accounts_credit_releases_release_number", "accounts_credit_releases", ["release_number"], unique=True)
        op.create_index("ix_accounts_credit_releases_customer_id", "accounts_credit_releases", ["customer_id"])
        op.create_index("ix_accounts_credit_releases_sales_order_id", "accounts_credit_releases", ["sales_order_id"])

    if "accounts_dunning_letters" not in tables:
        op.create_table(
            "accounts_dunning_letters",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("letter_number", sa.String(30), nullable=False),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=False),
            sa.Column("letter_date", sa.Date(), nullable=False),
            sa.Column("as_of", sa.Date(), nullable=False),
            sa.Column("dunning_level", sa.Integer(), nullable=False),
            sa.Column("total_overdue", MONEY, nullable=False, server_default="0"),
            sa.Column("items", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="issued"),
            sa.Column("cancelled_reason", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_accounts_dunning_letters_letter_number", "accounts_dunning_letters", ["letter_number"], unique=True)
        op.create_index("ix_accounts_dunning_letters_customer_id", "accounts_dunning_letters", ["customer_id"])

    if "accounts_collection_notes" not in tables:
        op.create_table(
            "accounts_collection_notes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=False),
            sa.Column("ar_transaction_id", sa.Integer(), sa.ForeignKey("ar_transactions.id"), nullable=True),
            sa.Column("note_type", sa.String(20), nullable=False),
            sa.Column("note_date", sa.Date(), nullable=False),
            sa.Column("contact_person", sa.String(150), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=False),
            sa.Column("promised_date", sa.Date(), nullable=True),
            sa.Column("promised_amount", MONEY, nullable=True),
            sa.Column("promise_status", sa.String(20), nullable=True),
            sa.Column("promise_received", MONEY, nullable=True),
            sa.Column("follow_up_date", sa.Date(), nullable=True),
            sa.Column("follow_up_reminded_on", sa.Date(), nullable=True),
            sa.Column("dunning_letter_id", sa.Integer(), sa.ForeignKey("accounts_dunning_letters.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_accounts_collection_notes_customer_id", "accounts_collection_notes", ["customer_id"])
        op.create_index("ix_accounts_collection_notes_ar_transaction_id", "accounts_collection_notes", ["ar_transaction_id"])
        op.create_index("ix_accounts_collection_notes_follow_up_date", "accounts_collection_notes", ["follow_up_date"])

    if "accounts_disputes" not in tables:
        op.create_table(
            "accounts_disputes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("dispute_number", sa.String(30), nullable=False),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=False),
            sa.Column("ar_transaction_id", sa.Integer(), sa.ForeignKey("ar_transactions.id"), nullable=False),
            sa.Column("disputed_amount", MONEY, nullable=False),
            sa.Column("reason", sa.String(20), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("status", sa.String(30), nullable=False, server_default="open"),
            sa.Column("raised_on", sa.Date(), nullable=False),
            sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("customer_complaint_id", sa.Integer(), nullable=True),
            sa.Column("resolved_on", sa.Date(), nullable=True),
            sa.Column("resolved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("resolution_note", sa.Text(), nullable=True),
            sa.Column("party_note_id", sa.Integer(), sa.ForeignKey("accounts_party_notes.id"), nullable=True),
            sa.Column("settlement_adjustment_id", sa.Integer(), sa.ForeignKey("accounts_settlement_adjustments.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_accounts_disputes_dispute_number", "accounts_disputes", ["dispute_number"], unique=True)
        op.create_index("ix_accounts_disputes_customer_id", "accounts_disputes", ["customer_id"])
        op.create_index("ix_accounts_disputes_ar_transaction_id", "accounts_disputes", ["ar_transaction_id"])
        op.create_index("ix_accounts_disputes_status", "accounts_disputes", ["status"])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for t in ("accounts_disputes", "accounts_collection_notes", "accounts_dunning_letters", "accounts_credit_releases"):
        if t in tables:
            op.drop_table(t)
