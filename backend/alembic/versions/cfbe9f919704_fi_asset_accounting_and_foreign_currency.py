"""FI: integrated asset acquisition / capital-order settlement, partial
retirement and sale with GST invoice, Income-tax block depreciation, and
foreign currency (rates, document currency, realised + unrealised FX).

- accounts_currencies, accounts_exchange_rates, accounts_fx_revaluations
- accounts_asset_retirements, accounts_it_asset_blocks (seeded with the
  common Appendix I blocks), accounts_it_block_balances
- accounts_fixed_assets: vendor_invoice_line_id, internal_order_id,
  capitalisation_journal_entry_id, quantity, original_cost, it_block_id
- vendor_invoices / ar_transactions: currency, exchange_rate, amount_fc,
  amount_due_fc; payment_transactions: currency, exchange_rate, amount_fc
- payment_allocations: source_amount, amount_fc, fx_difference,
  fx_journal_entry_id
- ledgers + roles: CWIP 1040, Asset Sale Clearing 1190, FX gain/loss
  realised 4150/5650 and unrealised 4151/5651

Revision ID: cfbe9f919704
Revises: 4815a1529592
"""
from alembic import op
import sqlalchemy as sa

revision = "cfbe9f919704"
down_revision = "4815a1529592"
branch_labels = None
depends_on = None

# (code, name, group_code, is_control, role)
NEW_LEDGERS = [
    ("1040", "Capital Work-in-Progress", "G-FA", False, "cwip"),
    ("1190", "Asset Sale Clearing", "G-CA", False, "asset_sale_clearing"),
    ("4150", "Foreign Exchange Gain (realised)", "G-II", False, "fx_gain"),
    ("4151", "Foreign Exchange Gain (unrealised)", "G-II", False, "fx_unrealised_gain"),
    ("5650", "Foreign Exchange Loss (realised)", "G-IE", False, "fx_loss"),
    ("5651", "Foreign Exchange Loss (unrealised)", "G-IE", False, "fx_unrealised_loss"),
]

# Income-tax Act, Appendix I (Rule 5) — the blocks a manufacturer usually has.
IT_BLOCKS = [
    ("BLDG-RES", "Buildings — residential", 5),
    ("BLDG", "Buildings — other than residential (factory, office)", 10),
    ("FURN", "Furniture and fittings", 10),
    ("PM-GEN", "Plant and machinery — general", 15),
    ("PM-CAR", "Motor cars (not used for hire)", 15),
    ("PM-COMP", "Computers and computer software", 40),
    ("PM-40", "Plant and machinery — 40% items", 40),
    ("INTANG", "Intangible assets (know-how, patents, licences)", 25),
]

CURRENCIES = [("USD", "US Dollar", "$"), ("EUR", "Euro", "€"), ("GBP", "Pound Sterling", "£"),
              ("JPY", "Japanese Yen", "¥"), ("CNY", "Chinese Yuan", "¥"), ("AED", "UAE Dirham", None)]


def _cols(bind, table):
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _ts():
    return [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)]


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if "accounts_currencies" not in tables:
        op.create_table(
            "accounts_currencies",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(3), nullable=False, unique=True),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("symbol", sa.String(8), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            *_ts(),
        )
        for code, name, sym in CURRENCIES:
            bind.execute(sa.text("INSERT INTO accounts_currencies (code, name, symbol, is_active) VALUES (:c, :n, :s, :a)"),
                         {"c": code, "n": name, "s": sym, "a": True})

    if "accounts_exchange_rates" not in tables:
        op.create_table(
            "accounts_exchange_rates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("rate_date", sa.Date(), nullable=False),
            sa.Column("rate_type", sa.String(10), nullable=False, server_default="bank"),
            sa.Column("rate", sa.Numeric(18, 6), nullable=False),
            sa.Column("source", sa.String(100), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("currency", "rate_date", "rate_type", name="uq_exchange_rate_currency_date_type"),
        )
        op.create_index("ix_accounts_exchange_rates_currency", "accounts_exchange_rates", ["currency"])

    if "accounts_fx_revaluations" not in tables:
        op.create_table(
            "accounts_fx_revaluations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("accounting_period", sa.String(7), nullable=False),
            sa.Column("revaluation_date", sa.Date(), nullable=False),
            sa.Column("rates", sa.JSON(), nullable=True),
            sa.Column("lines", sa.JSON(), nullable=True),
            sa.Column("total_gain", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("total_loss", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="posted"),
            sa.Column("journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("reversal_reason", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_accounts_fx_revaluations_accounting_period", "accounts_fx_revaluations", ["accounting_period"])
        op.create_index("uq_fx_revaluation_one_posted_per_period", "accounts_fx_revaluations", ["accounting_period"], unique=True,
                        postgresql_where=sa.text("status = 'posted'"), sqlite_where=sa.text("status = 'posted'"))

    if "accounts_it_asset_blocks" not in tables:
        op.create_table(
            "accounts_it_asset_blocks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(20), nullable=False, unique=True),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("rate_pct", sa.Numeric(7, 3), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            *_ts(),
        )
        for code, name, rate in IT_BLOCKS:
            bind.execute(sa.text("INSERT INTO accounts_it_asset_blocks (code, name, rate_pct, is_active) VALUES (:c, :n, :r, :a)"),
                         {"c": code, "n": name, "r": rate, "a": True})

    if "accounts_it_block_balances" not in tables:
        op.create_table(
            "accounts_it_block_balances",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("block_id", sa.Integer(), sa.ForeignKey("accounts_it_asset_blocks.id"), nullable=False),
            sa.Column("fy_code", sa.String(20), nullable=False),
            sa.Column("opening_wdv", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("block_id", "fy_code", name="uq_it_block_balance_block_fy"),
        )
        op.create_index("ix_accounts_it_block_balances_block_id", "accounts_it_block_balances", ["block_id"])

    if "accounts_asset_retirements" not in tables:
        op.create_table(
            "accounts_asset_retirements",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("fixed_asset_id", sa.Integer(), sa.ForeignKey("accounts_fixed_assets.id"), nullable=False),
            sa.Column("retirement_date", sa.Date(), nullable=False),
            sa.Column("retirement_type", sa.String(10), nullable=False),
            sa.Column("retire_percent", sa.Numeric(7, 3), nullable=False),
            sa.Column("retire_quantity", sa.Numeric(18, 4), nullable=True),
            sa.Column("catch_up_depreciation", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("retired_cost", sa.Numeric(18, 2), nullable=False),
            sa.Column("retired_accumulated_depreciation", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("sale_value", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("gain_loss", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=True),
            sa.Column("gst_rate", sa.Numeric(7, 3), nullable=True),
            sa.Column("hsn_sac_code", sa.String(10), nullable=True),
            sa.Column("ar_transaction_id", sa.Integer(), sa.ForeignKey("ar_transactions.id"), nullable=True),
            sa.Column("journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="posted"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_accounts_asset_retirements_fixed_asset_id", "accounts_asset_retirements", ["fixed_asset_id"])

    fa = _cols(bind, "accounts_fixed_assets")
    with op.batch_alter_table("accounts_fixed_assets") as b:
        if "vendor_invoice_line_id" not in fa:
            b.add_column(sa.Column("vendor_invoice_line_id", sa.Integer(), sa.ForeignKey("vendor_invoice_lines.id", name="fk_fixed_assets_vi_line"), nullable=True))
            b.create_index("ix_accounts_fixed_assets_vendor_invoice_line_id", ["vendor_invoice_line_id"])
        if "internal_order_id" not in fa:
            b.add_column(sa.Column("internal_order_id", sa.Integer(), sa.ForeignKey("internal_orders.id", name="fk_fixed_assets_internal_order"), nullable=True))
            b.create_index("ix_accounts_fixed_assets_internal_order_id", ["internal_order_id"])
        if "capitalisation_journal_entry_id" not in fa:
            b.add_column(sa.Column("capitalisation_journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id", name="fk_fixed_assets_cap_je"), nullable=True))
        if "quantity" not in fa:
            b.add_column(sa.Column("quantity", sa.Numeric(18, 4), nullable=False, server_default="1"))
        if "original_cost" not in fa:
            b.add_column(sa.Column("original_cost", sa.Numeric(18, 2), nullable=True))
        if "it_block_id" not in fa:
            b.add_column(sa.Column("it_block_id", sa.Integer(), sa.ForeignKey("accounts_it_asset_blocks.id", name="fk_fixed_assets_it_block"), nullable=True))
            b.create_index("ix_accounts_fixed_assets_it_block_id", ["it_block_id"])
    bind.execute(sa.text("UPDATE accounts_fixed_assets SET original_cost = cost WHERE original_cost IS NULL"))

    for table in ("vendor_invoices", "ar_transactions", "payment_transactions"):
        cols = _cols(bind, table)
        with op.batch_alter_table(table) as b:
            if "currency" not in cols:
                b.add_column(sa.Column("currency", sa.String(3), nullable=False, server_default="INR"))
            if "exchange_rate" not in cols:
                b.add_column(sa.Column("exchange_rate", sa.Numeric(18, 6), nullable=False, server_default="1"))
            if "amount_fc" not in cols:
                b.add_column(sa.Column("amount_fc", sa.Numeric(18, 2), nullable=True))
            if table != "payment_transactions" and "amount_due_fc" not in cols:
                b.add_column(sa.Column("amount_due_fc", sa.Numeric(18, 2), nullable=True))

    pa = _cols(bind, "payment_allocations")
    with op.batch_alter_table("payment_allocations") as b:
        if "source_amount" not in pa:
            b.add_column(sa.Column("source_amount", sa.Numeric(18, 2), nullable=True))
        if "amount_fc" not in pa:
            b.add_column(sa.Column("amount_fc", sa.Numeric(18, 2), nullable=True))
        if "fx_difference" not in pa:
            b.add_column(sa.Column("fx_difference", sa.Numeric(18, 2), nullable=True))
        if "fx_journal_entry_id" not in pa:
            b.add_column(sa.Column("fx_journal_entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id", name="fk_payment_allocations_fx_je"), nullable=True))

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
    for code, *_x in NEW_LEDGERS:
        bind.execute(sa.text(
            "DELETE FROM gl_accounts WHERE code = :c AND id NOT IN (SELECT DISTINCT gl_account_id FROM journal_entry_lines)"), {"c": code})
    with op.batch_alter_table("payment_allocations") as b:
        for c in ("fx_journal_entry_id", "fx_difference", "amount_fc", "source_amount"):
            b.drop_column(c)
    for table in ("vendor_invoices", "ar_transactions", "payment_transactions"):
        with op.batch_alter_table(table) as b:
            if table != "payment_transactions":
                b.drop_column("amount_due_fc")
            for c in ("amount_fc", "exchange_rate", "currency"):
                b.drop_column(c)
    with op.batch_alter_table("accounts_fixed_assets") as b:
        b.drop_index("ix_accounts_fixed_assets_it_block_id")
        b.drop_index("ix_accounts_fixed_assets_internal_order_id")
        b.drop_index("ix_accounts_fixed_assets_vendor_invoice_line_id")
        for c in ("it_block_id", "original_cost", "quantity", "capitalisation_journal_entry_id", "internal_order_id", "vendor_invoice_line_id"):
            b.drop_column(c)
    op.drop_table("accounts_asset_retirements")
    op.drop_table("accounts_it_block_balances")
    op.drop_table("accounts_it_asset_blocks")
    op.drop_index("uq_fx_revaluation_one_posted_per_period", table_name="accounts_fx_revaluations")
    op.drop_table("accounts_fx_revaluations")
    op.drop_table("accounts_exchange_rates")
    op.drop_table("accounts_currencies")
