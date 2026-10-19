"""FI treasury: electronic bank statement (FF67/FEBAN), cash position
planned items (FF7A/FF7B) and the bank guarantee / LC / EMD register.

- accounts_bank_statements + accounts_bank_statement_lines
- accounts_cash_forecast_items
- accounts_bank_guarantees + accounts_bank_guarantee_events
- ledgers + ledger roles: Margin Money with Banks (1185, Deposits), EMD &
  Security Deposits (1186, Deposits), BG / LC commission (5515, Finance
  Costs), BG invoked / EMD forfeited (5660, Indirect Expenses); role
  bank_interest_income -> existing 4110 Interest Income

Revision ID: 4815a1529592
Revises: 8259348ce2e6
"""
from alembic import op
import sqlalchemy as sa

revision = "4815a1529592"
down_revision = "8259348ce2e6"
branch_labels = None
depends_on = None

# (code, name, group_code, is_control, role)
NEW_LEDGERS = [
    ("1185", "Margin Money with Banks (BG / LC)", "G-DEP", False, "margin_money"),
    ("1186", "EMD & Security Deposits", "G-DEP", False, "emd_security_deposit"),
    ("5515", "Bank Guarantee & LC Commission", "G-FIN", False, "bg_commission"),
    ("5660", "Bank Guarantees Invoked / EMD Forfeited", "G-IE", False, "bg_invocation_loss"),
]
EXTRA_ROLES = ["bank_interest_income"]


def _ts():
    return [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)]


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if "accounts_bank_statements" not in tables:
        op.create_table(
            "accounts_bank_statements",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bank_account_id", sa.Integer(), sa.ForeignKey("bank_accounts.id"), nullable=False),
            sa.Column("bank_reconciliation_id", sa.Integer(), sa.ForeignKey("bank_reconciliations.id"), nullable=False),
            sa.Column("statement_format", sa.String(30), nullable=False),
            sa.Column("file_name", sa.String(255), nullable=True),
            sa.Column("from_date", sa.Date(), nullable=True),
            sa.Column("to_date", sa.Date(), nullable=True),
            sa.Column("opening_balance", sa.Numeric(18, 2), nullable=True),
            sa.Column("closing_balance", sa.Numeric(18, 2), nullable=True),
            sa.Column("line_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("skipped_duplicates", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_accounts_bank_statements_bank_account_id", "accounts_bank_statements", ["bank_account_id"])
        op.create_index("ix_accounts_bank_statements_bank_reconciliation_id", "accounts_bank_statements", ["bank_reconciliation_id"])

    if "accounts_bank_statement_lines" not in tables:
        op.create_table(
            "accounts_bank_statement_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("statement_id", sa.Integer(), sa.ForeignKey("accounts_bank_statements.id"), nullable=False),
            sa.Column("bank_account_id", sa.Integer(), sa.ForeignKey("bank_accounts.id"), nullable=False),
            sa.Column("bank_reconciliation_id", sa.Integer(), sa.ForeignKey("bank_reconciliations.id"), nullable=False),
            sa.Column("line_number", sa.Integer(), nullable=False),
            sa.Column("txn_date", sa.Date(), nullable=True),
            sa.Column("value_date", sa.Date(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("reference", sa.String(120), nullable=True),
            sa.Column("cheque_number", sa.String(50), nullable=True),
            sa.Column("debit", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("credit", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("balance", sa.Numeric(18, 2), nullable=True),
            sa.Column("dedup_key", sa.String(64), nullable=False),
            sa.Column("match_status", sa.String(20), nullable=False, server_default="unmatched"),
            sa.Column("match_method", sa.String(20), nullable=True),
            sa.Column("matched_payments", sa.JSON(), nullable=True),
            sa.Column("booked_payment_id", sa.Integer(), sa.ForeignKey("payment_transactions.id"), nullable=True),
            sa.Column("matched_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("matched_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
        )
        for col in ("statement_id", "bank_account_id", "bank_reconciliation_id", "dedup_key"):
            op.create_index(f"ix_accounts_bank_statement_lines_{col}", "accounts_bank_statement_lines", [col])

    if "accounts_cash_forecast_items" not in tables:
        op.create_table(
            "accounts_cash_forecast_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("direction", sa.String(10), nullable=False),
            sa.Column("category", sa.String(30), nullable=False),
            sa.Column("description", sa.String(255), nullable=False),
            sa.Column("amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("expected_date", sa.Date(), nullable=False),
            sa.Column("recurrence", sa.String(10), nullable=False, server_default="none"),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("bank_account_id", sa.Integer(), sa.ForeignKey("bank_accounts.id"), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )

    if "accounts_bank_guarantees" not in tables:
        op.create_table(
            "accounts_bank_guarantees",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bg_number", sa.String(40), nullable=False),
            sa.Column("direction", sa.String(10), nullable=False, server_default="issued"),
            sa.Column("instrument_type", sa.String(20), nullable=False),
            sa.Column("instrument_form", sa.String(20), nullable=False, server_default="bank_guarantee"),
            sa.Column("instrument_number", sa.String(80), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("bank_account_id", sa.Integer(), sa.ForeignKey("bank_accounts.id"), nullable=True),
            sa.Column("issuing_bank_name", sa.String(150), nullable=True),
            sa.Column("issuing_bank_branch", sa.String(150), nullable=True),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=True),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id"), nullable=True),
            sa.Column("tender_id", sa.Integer(), sa.ForeignKey("crm_tenders.id"), nullable=True),
            sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id"), nullable=True),
            sa.Column("counterparty_name", sa.String(255), nullable=True),
            sa.Column("amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("currency", sa.String(10), nullable=False, server_default="INR"),
            sa.Column("issue_date", sa.Date(), nullable=True),
            sa.Column("expiry_date", sa.Date(), nullable=True),
            sa.Column("claim_expiry_date", sa.Date(), nullable=True),
            sa.Column("margin_percent", sa.Numeric(7, 3), nullable=True),
            sa.Column("margin_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("margin_status", sa.String(20), nullable=False, server_default="none"),
            sa.Column("margin_gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=True),
            sa.Column("commission_rate", sa.Numeric(7, 3), nullable=True),
            sa.Column("commission_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("purpose", sa.String(300), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("document_name", sa.String(255), nullable=True),
            sa.Column("document_path", sa.String(1000), nullable=True),
            sa.Column("closed_on", sa.Date(), nullable=True),
            sa.Column("invoked_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("closure_reason", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_accounts_bank_guarantees_bg_number", "accounts_bank_guarantees", ["bg_number"], unique=True)
        for col in ("status", "customer_id", "vendor_id", "sales_order_id", "tender_id"):
            op.create_index(f"ix_accounts_bank_guarantees_{col}", "accounts_bank_guarantees", [col])

    if "accounts_bank_guarantee_events" not in tables:
        op.create_table(
            "accounts_bank_guarantee_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("guarantee_id", sa.Integer(), sa.ForeignKey("accounts_bank_guarantees.id"), nullable=False),
            sa.Column("event_type", sa.String(20), nullable=False),
            sa.Column("event_date", sa.Date(), nullable=False),
            sa.Column("amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("old_expiry_date", sa.Date(), nullable=True),
            sa.Column("new_expiry_date", sa.Date(), nullable=True),
            sa.Column("old_claim_expiry_date", sa.Date(), nullable=True),
            sa.Column("new_claim_expiry_date", sa.Date(), nullable=True),
            sa.Column("payment_transaction_id", sa.Integer(), sa.ForeignKey("payment_transactions.id"), nullable=True),
            sa.Column("journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_accounts_bank_guarantee_events_guarantee_id", "accounts_bank_guarantee_events", ["guarantee_id"])

    # Ledgers + roles (skipped when the chart has no such group yet —
    # ledger_for() then names the missing code and where to fix it).
    groups = {r[0]: (r[1], r[2]) for r in bind.execute(sa.text("SELECT code, id, nature FROM account_groups")).fetchall()}
    existing = {r[0] for r in bind.execute(sa.text("SELECT code FROM gl_accounts")).fetchall()}
    for code, name, gcode, control, _role in NEW_LEDGERS:
        if code in existing or gcode not in groups:
            continue
        gid, nature = groups[gcode]
        bind.execute(sa.text(
            "INSERT INTO gl_accounts (code, name, account_type, group_id, status, currency, opening_balance, is_posting_account, is_control_account) "
            "VALUES (:code, :name, :type, :gid, 'active', 'INR', 0, :posting, :control)"),
            {"code": code, "name": name, "type": nature, "gid": gid, "posting": True, "control": control})
    have_roles = {r[0] for r in bind.execute(sa.text("SELECT role FROM account_determinations")).fetchall()}
    for role in [r for *_x, r in NEW_LEDGERS] + EXTRA_ROLES:
        if role not in have_roles:
            bind.execute(sa.text("INSERT INTO account_determinations (role, gl_account_id) VALUES (:r, NULL)"), {"r": role})


def downgrade() -> None:
    bind = op.get_bind()
    roles = [r for *_x, r in NEW_LEDGERS] + EXTRA_ROLES
    bind.execute(sa.text("DELETE FROM account_determinations WHERE role IN :roles").bindparams(sa.bindparam("roles", expanding=True)), {"roles": roles})
    for code, *_x in NEW_LEDGERS:
        bind.execute(sa.text(
            "DELETE FROM gl_accounts WHERE code = :c AND id NOT IN (SELECT DISTINCT gl_account_id FROM journal_entry_lines)"), {"c": code})
    op.drop_table("accounts_bank_guarantee_events")
    op.drop_table("accounts_bank_guarantees")
    op.drop_table("accounts_cash_forecast_items")
    op.drop_table("accounts_bank_statement_lines")
    op.drop_table("accounts_bank_statements")
