"""FI: payment differences (F-28/F-32), down payments (F-29/F-48), payment
approval + F110-style payment runs.

- accounts_settlement_adjustments (deductions / write-offs settling a bill)
- accounts_payment_proposals + accounts_payment_proposal_lines
- payment_transactions: advance link (is_advance, SO / billing line / PO,
  reason), held-voucher fields (pending_allocations, payment_proposal_id,
  approved_by_id, rejection_reason)
- payment_allocations.journal_entry_id (advance clearing JV)
- vendor_invoices.payment_block / payment_block_reason
- ledgers + ledger roles: Advances from Customers (2080, Current
  Liabilities), Advances to Suppliers (1170, Loans & Advances), deduction
  ledgers (5510, 5620, 5621, 5630, 5640, 4130, 4140)

Revision ID: 80d6cf71a66d
Revises: e6b4d2a8c1f9
"""
from alembic import op
import sqlalchemy as sa

revision = "80d6cf71a66d"
down_revision = "e6b4d2a8c1f9"
branch_labels = None
depends_on = None

# (code, name, group_code, is_control, role)
NEW_LEDGERS = [
    ("2080", "Advances from Customers", "G-CL", True, "customer_advance"),
    ("1170", "Advances to Suppliers", "G-LA", True, "supplier_advance"),
    ("5510", "Bank Charges", "G-FIN", False, "bank_charges"),
    ("5620", "Liquidated Damages deducted by customers", "G-IE", False, "ld_recovered_by_customer"),
    ("5621", "Penalties deducted by customers", "G-IE", False, "penalty_by_customer"),
    ("5630", "Short payments & small differences written off", "G-IE", False, "write_off_small_differences"),
    ("5640", "Cash discount allowed", "G-IE", False, "discount_allowed"),
    ("4130", "LD / penalties recovered from vendors", "G-II", False, "ld_recovered_from_vendor"),
    ("4140", "Cash discount received", "G-II", False, "discount_received"),
]


def _cols(bind, table):
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if "accounts_payment_proposals" not in tables:
        op.create_table(
            "accounts_payment_proposals",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("proposal_number", sa.String(50), nullable=False),
            sa.Column("run_date", sa.Date(), nullable=False),
            sa.Column("pay_by_date", sa.Date(), nullable=False),
            sa.Column("bank_account_id", sa.Integer(), sa.ForeignKey("bank_accounts.id"), nullable=False),
            sa.Column("payment_mode", sa.String(20), nullable=False, server_default="neft"),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("total_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("executed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("rejection_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_accounts_payment_proposals_proposal_number", "accounts_payment_proposals", ["proposal_number"], unique=True)

    if "accounts_payment_proposal_lines" not in tables:
        op.create_table(
            "accounts_payment_proposal_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("proposal_id", sa.Integer(), sa.ForeignKey("accounts_payment_proposals.id"), nullable=False),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=False),
            sa.Column("vendor_invoice_id", sa.Integer(), sa.ForeignKey("vendor_invoices.id"), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("amount_due", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("credit_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("discount_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("excluded", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("exclusion_reason", sa.String(300), nullable=True),
            sa.Column("payment_transaction_id", sa.Integer(), sa.ForeignKey("payment_transactions.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_accounts_payment_proposal_lines_proposal_id", "accounts_payment_proposal_lines", ["proposal_id"])

    if "accounts_settlement_adjustments" not in tables:
        op.create_table(
            "accounts_settlement_adjustments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("payment_transaction_id", sa.Integer(), sa.ForeignKey("payment_transactions.id"), nullable=True),
            sa.Column("journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("target_type", sa.String(20), nullable=False),
            sa.Column("target_id", sa.Integer(), nullable=False),
            sa.Column("reason", sa.String(30), nullable=False),
            sa.Column("gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=False),
            sa.Column("cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=True),
            sa.Column("amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("adjustment_date", sa.Date(), nullable=False),
            sa.Column("remarks", sa.String(300), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_accounts_settlement_adjustments_payment_transaction_id", "accounts_settlement_adjustments", ["payment_transaction_id"])
        op.create_index("ix_accounts_settlement_adjustments_target_id", "accounts_settlement_adjustments", ["target_id"])

    pt = _cols(bind, "payment_transactions")
    with op.batch_alter_table("payment_transactions") as b:
        if "is_advance" not in pt:
            b.add_column(sa.Column("is_advance", sa.Boolean(), nullable=False, server_default=sa.false()))
        if "sales_order_id" not in pt:
            b.add_column(sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id", name="fk_payment_transactions_sales_order"), nullable=True))
        if "billing_line_id" not in pt:
            b.add_column(sa.Column("billing_line_id", sa.Integer(), sa.ForeignKey("sales_billing_plan_lines.id", name="fk_payment_transactions_billing_line"), nullable=True))
        if "purchase_order_id" not in pt:
            b.add_column(sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id", name="fk_payment_transactions_purchase_order"), nullable=True))
        if "advance_reason" not in pt:
            b.add_column(sa.Column("advance_reason", sa.String(300), nullable=True))
        if "pending_allocations" not in pt:
            b.add_column(sa.Column("pending_allocations", sa.JSON(), nullable=True))
        if "payment_proposal_id" not in pt:
            b.add_column(sa.Column("payment_proposal_id", sa.Integer(), sa.ForeignKey("accounts_payment_proposals.id", name="fk_payment_transactions_proposal"), nullable=True))
        if "approved_by_id" not in pt:
            b.add_column(sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id", name="fk_payment_transactions_approved_by"), nullable=True))
        if "rejection_reason" not in pt:
            b.add_column(sa.Column("rejection_reason", sa.Text(), nullable=True))

    if "journal_entry_id" not in _cols(bind, "payment_allocations"):
        with op.batch_alter_table("payment_allocations") as b:
            b.add_column(sa.Column("journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id", name="fk_payment_allocations_journal_entry"), nullable=True))

    vi = _cols(bind, "vendor_invoices")
    with op.batch_alter_table("vendor_invoices") as b:
        if "payment_block" not in vi:
            b.add_column(sa.Column("payment_block", sa.Boolean(), nullable=False, server_default=sa.false()))
        if "payment_block_reason" not in vi:
            b.add_column(sa.Column("payment_block_reason", sa.String(300), nullable=True))

    # Ledgers and ledger roles (skipped when the chart has no such group yet,
    # e.g. a database without the standards upgrade — ledger_for() then names
    # the missing default code and where to fix it).
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
    for *_x, role in NEW_LEDGERS:
        if role not in have_roles:
            bind.execute(sa.text("INSERT INTO account_determinations (role, gl_account_id) VALUES (:r, NULL)"), {"r": role})


def downgrade() -> None:
    bind = op.get_bind()
    roles = [r for *_x, r in NEW_LEDGERS]
    bind.execute(sa.text("DELETE FROM account_determinations WHERE role IN :roles").bindparams(sa.bindparam("roles", expanding=True)), {"roles": roles})
    # Ledgers stay if anything posted to them; drop the untouched ones.
    for code, *_x in NEW_LEDGERS:
        bind.execute(sa.text(
            "DELETE FROM gl_accounts WHERE code = :c AND id NOT IN (SELECT DISTINCT gl_account_id FROM journal_entry_lines)"), {"c": code})
    with op.batch_alter_table("vendor_invoices") as b:
        b.drop_column("payment_block_reason")
        b.drop_column("payment_block")
    with op.batch_alter_table("payment_allocations") as b:
        b.drop_column("journal_entry_id")
    with op.batch_alter_table("payment_transactions") as b:
        for c in ("rejection_reason", "approved_by_id", "payment_proposal_id", "pending_allocations", "advance_reason",
                  "purchase_order_id", "billing_line_id", "sales_order_id", "is_advance"):
            b.drop_column(c)
    op.drop_table("accounts_settlement_adjustments")
    op.drop_table("accounts_payment_proposal_lines")
    op.drop_table("accounts_payment_proposals")
