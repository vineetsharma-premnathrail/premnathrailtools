"""accounts standards upgrade — FY vouchers, groups, GST lines, vouchers, notes, assets, closing stock

Revision ID: a8c3e5f7b9d1
Revises: 3b7d9e1f5a2c
Create Date: 2026-10-06

See docs/02-modules/finance/FINANCE_STANDARDS_PLAN.md. Schema + data:
- money columns Float -> NUMERIC(18,2) (Postgres only; SQLite has no real types)
- account groups (seeded, Schedule III mapped), every ledger assigned a group
- split GST ledgers + round-off/stock/asset ledgers, ledger roles, GST rates
- line items for purchase/sales invoices, debit/credit notes, voucher lines
  and bill-wise allocations, closing-stock valuations, fixed assets
- backfill: one line per existing invoice, allocations for existing
  single-invoice payments, voucher type / FY on journals, and a rebuild of
  the monthly balance cache so balances carry forward month to month.
Every step checks what already exists first (baseline's create_all may have
built new tables straight from the models on a fresh database).
"""
from datetime import date
from alembic import op
import sqlalchemy as sa

revision = "a8c3e5f7b9d1"
down_revision = "3b7d9e1f5a2c"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)
QTY = sa.Numeric(18, 4)
PCT = sa.Numeric(7, 3)

# (code, name, parent_code, nature, schedule_iii_head, affects_gross_profit, sequence)
GROUPS = [
    ("G-CAP", "Capital Account", None, "equity", "share_capital", False, 10),
    ("G-RES", "Reserves & Surplus", "G-CAP", "equity", "reserves_surplus", False, 11),
    ("G-LOAN", "Loans (Liability)", None, "liability", "long_term_borrowings", False, 20),
    ("G-LTL", "Long-term Borrowings", "G-LOAN", "liability", "long_term_borrowings", False, 21),
    ("G-STL", "Short-term Borrowings & Bank OD", "G-LOAN", "liability", "short_term_borrowings", False, 22),
    ("G-CL", "Current Liabilities", None, "liability", "other_current_liabilities", False, 30),
    ("G-SCR", "Sundry Creditors", "G-CL", "liability", "trade_payables", False, 31),
    ("G-DT", "Duties & Taxes", "G-CL", "liability", "other_current_liabilities", False, 32),
    ("G-PROV", "Provisions", "G-CL", "liability", "short_term_provisions", False, 33),
    ("G-SUSP", "Suspense A/c", None, "liability", "other_current_liabilities", False, 39),
    ("G-FA", "Fixed Assets", None, "asset", "ppe", False, 40),
    ("G-INV", "Investments", None, "asset", "non_current_investments", False, 45),
    ("G-CA", "Current Assets", None, "asset", "other_current_assets", False, 50),
    ("G-STK", "Stock-in-Hand", "G-CA", "asset", "inventories", False, 51),
    ("G-SDR", "Sundry Debtors", "G-CA", "asset", "trade_receivables", False, 52),
    ("G-BANK", "Bank Accounts", "G-CA", "asset", "cash_equivalents", False, 53),
    ("G-CASH", "Cash-in-Hand", "G-CA", "asset", "cash_equivalents", False, 54),
    ("G-LA", "Loans & Advances (Asset)", "G-CA", "asset", "short_term_loans_advances", False, 55),
    ("G-DEP", "Deposits (Asset)", "G-CA", "asset", "other_current_assets", False, 56),
    ("G-TAXA", "GST Input Credit", "G-CA", "asset", "other_current_assets", False, 57),
    ("G-SAL", "Sales Accounts", None, "revenue", "revenue_from_operations", True, 60),
    ("G-DI", "Direct Incomes", None, "revenue", "revenue_from_operations", True, 61),
    ("G-II", "Indirect Incomes", None, "revenue", "other_income", False, 62),
    ("G-PUR", "Purchase Accounts", None, "expense", "cost_of_materials_consumed", True, 70),
    ("G-CHINV", "Stock Adjustment (Opening/Closing)", None, "expense", "changes_in_inventories", True, 71),
    ("G-DE", "Direct Expenses", None, "expense", "other_expenses", True, 72),
    ("G-IE", "Indirect Expenses", None, "expense", "other_expenses", False, 73),
    ("G-EMP", "Employee Benefit Expenses", "G-IE", "expense", "employee_benefits", False, 74),
    ("G-FIN", "Finance Costs", "G-IE", "expense", "finance_costs", False, 75),
    ("G-DEPN", "Depreciation", "G-IE", "expense", "depreciation", False, 76),
    ("G-TAX", "Tax Expense", None, "expense", "tax_expense", False, 79),
]

# Existing seeded ledgers -> group.
LEDGER_GROUP = {
    "1000": "G-FA", "1010": "G-FA", "1020": "G-FA", "1030": "G-FA",
    "1100": "G-CA", "1110": "G-CASH", "1120": "G-BANK", "1130": "G-SDR",
    "1140": "G-STK", "1141": "G-STK", "1142": "G-STK", "1150": "G-TAXA", "1160": "G-LA",
    "2000": "G-CL", "2010": "G-SCR", "2020": "G-DT", "2030": "G-DT", "2040": "G-DT", "2050": "G-DT", "2060": "G-PROV",
    "2100": "G-STL", "2200": "G-LTL", "3000": "G-CAP", "3010": "G-RES", "3020": "G-RES",
    "4000": "G-SAL", "4010": "G-SAL", "4100": "G-II", "4110": "G-II",
    "5000": "G-PUR", "5010": "G-DE", "5020": "G-DE", "5100": "G-EMP", "5200": "G-IE", "5210": "G-DE", "5220": "G-IE",
    "5230": "G-IE", "5300": "G-IE", "5310": "G-IE", "5400": "G-DEPN", "5500": "G-FIN", "5600": "G-IE", "5700": "G-TAX",
}
TYPE_FALLBACK = {"asset": "G-CA", "liability": "G-CL", "equity": "G-RES", "revenue": "G-II", "expense": "G-IE"}

# New ledgers: (code, name, group_code, is_control)
NEW_LEDGERS = [
    ("1151", "CGST Input Credit", "G-TAXA", False),
    ("1152", "SGST Input Credit", "G-TAXA", False),
    ("1153", "IGST Input Credit", "G-TAXA", False),
    ("2021", "CGST Output", "G-DT", False),
    ("2022", "SGST Output", "G-DT", False),
    ("2023", "IGST Output", "G-DT", False),
    ("2024", "GST Payable under Reverse Charge", "G-DT", False),
    ("2070", "Expenses Payable (Accruals)", "G-PROV", False),
    ("4120", "Profit on Sale of Fixed Assets", "G-II", False),
    ("5001", "Purchases", "G-PUR", False),
    ("5050", "Changes in Inventories (Opening/Closing Stock)", "G-CHINV", False),
    ("5610", "Loss on Sale of Fixed Assets", "G-IE", False),
    ("5800", "Round Off", "G-IE", False),
]
LEDGER_ROLES = {
    "ap_control": "2010", "ar_control": "1130", "cgst_input": "1151", "sgst_input": "1152", "igst_input": "1153",
    "cgst_output": "2021", "sgst_output": "2022", "igst_output": "2023", "rcm_payable": "2024", "round_off": "5800",
    "purchase_default": "5001", "sales_default": "4000", "stock_in_hand": "1140", "stock_change": "5050",
    "retained_earnings": "3010", "depreciation_expense": "5400", "accumulated_depreciation": "1030",
    "asset_disposal_gain": "4120", "asset_disposal_loss": "5610",
}
GST_RATES = [(0, "Nil / exempt", True), (0.25, "Rough diamonds", True), (3, "Gold, silver, jewellery", True),
             (5, "Merit rate", True), (18, "Standard rate", True), (40, "Demerit rate (from 22-Sep-2025)", True),
             (12, "Withdrawn from 22-Sep-2025", False), (28, "Withdrawn from 22-Sep-2025", False)]

MONEY_COLUMNS = {
    "gl_accounts": ["opening_balance"],
    "gl_balances": ["opening_balance", "total_debits", "total_credits", "closing_balance"],
    "bank_accounts": ["opening_balance", "current_balance"],
    "bank_reconciliations": ["statement_balance", "book_balance"],
    "internal_orders": ["budgeted_amount"],
    "journal_entries": ["total_debit", "total_credit"],
    "journal_entry_lines": ["debit_amount", "credit_amount"],
    "payment_transactions": ["amount"],
    "vendors": ["credit_limit"],
    "vendor_invoices": ["invoice_amount", "invoice_gst", "invoice_total", "amount_paid", "amount_due"],
    "ar_transactions": ["invoice_amount", "gst_amount", "discount_amount", "total_amount", "amount_received", "amount_due"],
}
QTY_COLUMNS = {"vendor_invoices": ["qty_po", "qty_gr", "qty_invoice"]}
PCT_COLUMNS = {"vendors": ["early_payment_discount_pct"]}

NEW_COLUMNS = {
    "gl_accounts": [sa.Column("group_id", sa.Integer, sa.ForeignKey("account_groups.id"), nullable=True)],
    "journal_entries": [
        sa.Column("voucher_type", sa.String(20), nullable=False, server_default="journal"),
        sa.Column("financial_year", sa.String(20), nullable=True),
        sa.Column("auto_reverse_on", sa.Date, nullable=True),
    ],
    "bank_accounts": [sa.Column("account_kind", sa.String(10), nullable=False, server_default="bank")],
    "vendors": [
        sa.Column("gst_registration_type", sa.String(20), nullable=False, server_default="regular"),
        sa.Column("default_expense_gl_account_id", sa.Integer, sa.ForeignKey("gl_accounts.id"), nullable=True),
    ],
    "vendor_invoices": [
        sa.Column("invoice_type", sa.String(10), nullable=False, server_default="po"),
        sa.Column("due_date", sa.Date, nullable=True),
        sa.Column("vendor_gstin", sa.String(20), nullable=True),
        sa.Column("place_of_supply_state_code", sa.String(2), nullable=True),
        sa.Column("is_interstate", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_reverse_charge", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("cgst_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("sgst_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("igst_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("round_off", MONEY, nullable=False, server_default="0"),
        sa.Column("narration", sa.Text, nullable=True),
        sa.Column("cancelled_reason", sa.Text, nullable=True),
    ],
    "ar_transactions": [
        sa.Column("customer_gstin", sa.String(20), nullable=True),
        sa.Column("place_of_supply_state_code", sa.String(2), nullable=True),
        sa.Column("is_interstate", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("cgst_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("sgst_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("igst_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("round_off", MONEY, nullable=False, server_default="0"),
        sa.Column("billing_address", sa.Text, nullable=True),
        sa.Column("shipping_address", sa.Text, nullable=True),
        sa.Column("customer_po_number", sa.String(100), nullable=True),
        sa.Column("customer_po_date", sa.Date, nullable=True),
        sa.Column("narration", sa.Text, nullable=True),
        sa.Column("irn", sa.String(64), nullable=True),
        sa.Column("ack_no", sa.String(30), nullable=True),
        sa.Column("ack_date", sa.Date, nullable=True),
        sa.Column("eway_bill_no", sa.String(20), nullable=True),
        sa.Column("eway_bill_date", sa.Date, nullable=True),
        sa.Column("vehicle_no", sa.String(20), nullable=True),
        sa.Column("cancelled_reason", sa.Text, nullable=True),
    ],
    "payment_transactions": [
        sa.Column("counter_bank_account_id", sa.Integer, sa.ForeignKey("bank_accounts.id"), nullable=True),
        sa.Column("customer_id", sa.Integer, sa.ForeignKey("crm_organizations.id"), nullable=True),
        sa.Column("reference_no", sa.String(100), nullable=True),
        sa.Column("narration", sa.Text, nullable=True),
        sa.Column("unallocated_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="posted"),
        sa.Column("cleared_date", sa.Date, nullable=True),
        sa.Column("counter_reconciliation_status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("counter_bank_reconciliation_id", sa.Integer, sa.ForeignKey("bank_reconciliations.id"), nullable=True),
        sa.Column("counter_cleared_date", sa.Date, nullable=True),
    ],
}


def _tax_line_columns():
    return [
        sa.Column("line_number", sa.Integer, nullable=False),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("store_item_id", sa.Integer, sa.ForeignKey("store_items.id"), nullable=True),
        sa.Column("hsn_sac_code", sa.String(20), nullable=True),
        sa.Column("quantity", QTY, nullable=False, server_default="1"),
        sa.Column("uom", sa.String(20), nullable=True),
        sa.Column("rate", QTY, nullable=False, server_default="0"),
        sa.Column("discount_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("taxable_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("gst_rate", PCT, nullable=False, server_default="0"),
        sa.Column("cgst_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("sgst_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("igst_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("gl_account_id", sa.Integer, sa.ForeignKey("gl_accounts.id"), nullable=False),
        sa.Column("cost_center_id", sa.Integer, sa.ForeignKey("cost_centers.id"), nullable=True),
    ]


def _ts():
    return [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now())]


def _id():
    return sa.Column("id", sa.Integer, primary_key=True, autoincrement=True)


def _new_tables():
    return [
        ("account_groups", [_id(), sa.Column("code", sa.String(20), nullable=False, unique=True), sa.Column("name", sa.String(150), nullable=False),
                            sa.Column("parent_id", sa.Integer, sa.ForeignKey("account_groups.id"), nullable=True),
                            sa.Column("nature", sa.String(20), nullable=False), sa.Column("schedule_iii_head", sa.String(40), nullable=False),
                            sa.Column("affects_gross_profit", sa.Boolean, nullable=False, server_default=sa.false()),
                            sa.Column("sequence", sa.Integer, nullable=False, server_default="0"),
                            sa.Column("is_system", sa.Boolean, nullable=False, server_default=sa.false()), *_ts()]),
        ("account_determinations", [_id(), sa.Column("role", sa.String(40), nullable=False, unique=True),
                                    sa.Column("gl_account_id", sa.Integer, sa.ForeignKey("gl_accounts.id"), nullable=True), *_ts()]),
        ("accounts_number_series", [_id(), sa.Column("series_key", sa.String(40), nullable=False, unique=True),
                                    sa.Column("last_number", sa.Integer, nullable=False, server_default="0"), *_ts()]),
        ("gst_rates", [_id(), sa.Column("rate", PCT, nullable=False, unique=True), sa.Column("description", sa.String(200), nullable=True),
                       sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()), *_ts()]),
        ("vendor_invoice_lines", [_id(), sa.Column("vendor_invoice_id", sa.Integer, sa.ForeignKey("vendor_invoices.id"), nullable=False, index=True),
                                  sa.Column("po_item_id", sa.Integer, sa.ForeignKey("p2p_purchase_order_items.id"), nullable=True),
                                  *_tax_line_columns(), *_ts()]),
        ("ar_transaction_lines", [_id(), sa.Column("ar_transaction_id", sa.Integer, sa.ForeignKey("ar_transactions.id"), nullable=False, index=True),
                                  *_tax_line_columns(), *_ts()]),
        ("accounts_party_notes", [
            _id(), sa.Column("note_number", sa.String(50), nullable=False, unique=True, index=True),
            sa.Column("note_type", sa.String(20), nullable=False), sa.Column("note_date", sa.Date, nullable=False),
            sa.Column("reason", sa.String(30), nullable=False, server_default="return"),
            sa.Column("vendor_id", sa.Integer, sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("customer_id", sa.Integer, sa.ForeignKey("crm_organizations.id"), nullable=True),
            sa.Column("vendor_invoice_id", sa.Integer, sa.ForeignKey("vendor_invoices.id"), nullable=True),
            sa.Column("ar_transaction_id", sa.Integer, sa.ForeignKey("ar_transactions.id"), nullable=True),
            sa.Column("party_gstin", sa.String(20), nullable=True), sa.Column("place_of_supply_state_code", sa.String(2), nullable=True),
            sa.Column("is_interstate", sa.Boolean, nullable=False, server_default=sa.false()),
            *[sa.Column(c, MONEY, nullable=False, server_default="0") for c in (
                "taxable_amount", "cgst_amount", "sgst_amount", "igst_amount", "gst_amount", "round_off", "total_amount", "unadjusted_amount")],
            sa.Column("narration", sa.Text, nullable=True),
            sa.Column("journal_entry_id", sa.Integer, sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("created_by_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True), *_ts()]),
        ("accounts_party_note_lines", [_id(), sa.Column("party_note_id", sa.Integer, sa.ForeignKey("accounts_party_notes.id"), nullable=False, index=True),
                                       *_tax_line_columns(), *_ts()]),
        ("payment_lines", [_id(), sa.Column("payment_transaction_id", sa.Integer, sa.ForeignKey("payment_transactions.id"), nullable=False, index=True),
                           sa.Column("line_number", sa.Integer, nullable=False),
                           sa.Column("gl_account_id", sa.Integer, sa.ForeignKey("gl_accounts.id"), nullable=False),
                           sa.Column("cost_center_id", sa.Integer, sa.ForeignKey("cost_centers.id"), nullable=True),
                           sa.Column("amount", MONEY, nullable=False), sa.Column("remarks", sa.String(300), nullable=True), *_ts()]),
        ("payment_allocations", [_id(), sa.Column("source_type", sa.String(20), nullable=False),
                                 sa.Column("source_id", sa.Integer, nullable=False, index=True),
                                 sa.Column("target_type", sa.String(20), nullable=False),
                                 sa.Column("target_id", sa.Integer, nullable=False, index=True),
                                 sa.Column("amount", MONEY, nullable=False), sa.Column("allocation_date", sa.Date, nullable=False),
                                 sa.Column("created_by_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True), *_ts()]),
        ("inventory_valuations", [_id(), sa.Column("accounting_period", sa.String(7), nullable=False, index=True),
                                  sa.Column("valuation_date", sa.Date, nullable=False),
                                  sa.Column("total_value", MONEY, nullable=False, server_default="0"),
                                  sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
                                  sa.Column("notes", sa.Text, nullable=True),
                                  sa.Column("journal_entry_id", sa.Integer, sa.ForeignKey("journal_entries.id"), nullable=True),
                                  sa.Column("created_by_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
                                  sa.Column("posted_by_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True), *_ts()]),
        ("inventory_valuation_lines", [_id(), sa.Column("inventory_valuation_id", sa.Integer, sa.ForeignKey("inventory_valuations.id"), nullable=False, index=True),
                                       sa.Column("store_item_id", sa.Integer, sa.ForeignKey("store_items.id"), nullable=True),
                                       sa.Column("item_code", sa.String(50), nullable=True), sa.Column("item_name", sa.String(300), nullable=False),
                                       sa.Column("category", sa.String(150), nullable=True), sa.Column("uom", sa.String(20), nullable=True),
                                       sa.Column("quantity", QTY, nullable=False, server_default="0"), sa.Column("rate", QTY, nullable=False, server_default="0"),
                                       sa.Column("value", MONEY, nullable=False, server_default="0"),
                                       sa.Column("rate_source", sa.String(20), nullable=False, server_default="moving_average"), *_ts()]),
        ("accounts_fixed_assets", [
            _id(), sa.Column("asset_code", sa.String(30), nullable=False, unique=True), sa.Column("name", sa.String(200), nullable=False),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("asset_gl_account_id", sa.Integer, sa.ForeignKey("gl_accounts.id"), nullable=False),
            sa.Column("accumulated_depreciation_gl_account_id", sa.Integer, sa.ForeignKey("gl_accounts.id"), nullable=True),
            sa.Column("depreciation_expense_gl_account_id", sa.Integer, sa.ForeignKey("gl_accounts.id"), nullable=True),
            sa.Column("cost_center_id", sa.Integer, sa.ForeignKey("cost_centers.id"), nullable=True),
            sa.Column("vendor_invoice_id", sa.Integer, sa.ForeignKey("vendor_invoices.id"), nullable=True),
            sa.Column("location", sa.String(150), nullable=True),
            sa.Column("purchase_date", sa.Date, nullable=False), sa.Column("put_to_use_date", sa.Date, nullable=False),
            sa.Column("cost", MONEY, nullable=False), sa.Column("residual_value", MONEY, nullable=False, server_default="0"),
            sa.Column("depreciation_method", sa.String(10), nullable=False, server_default="slm"),
            sa.Column("useful_life_months", sa.Integer, nullable=True), sa.Column("wdv_rate_pct", PCT, nullable=True),
            sa.Column("opening_accumulated_depreciation", MONEY, nullable=False, server_default="0"),
            sa.Column("accumulated_depreciation", MONEY, nullable=False, server_default="0"),
            sa.Column("depreciated_up_to", sa.Date, nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("disposal_date", sa.Date, nullable=True), sa.Column("disposal_proceeds", MONEY, nullable=True),
            sa.Column("disposal_journal_entry_id", sa.Integer, sa.ForeignKey("journal_entries.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True), *_ts()]),
        ("accounts_depreciation_runs", [_id(), sa.Column("accounting_period", sa.String(7), nullable=False, index=True),
                                        sa.Column("run_date", sa.Date, nullable=False),
                                        sa.Column("total_amount", MONEY, nullable=False, server_default="0"),
                                        sa.Column("status", sa.String(20), nullable=False, server_default="posted"),
                                        sa.Column("journal_entry_id", sa.Integer, sa.ForeignKey("journal_entries.id"), nullable=True),
                                        sa.Column("created_by_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True), *_ts()]),
        ("accounts_depreciation_run_lines", [_id(), sa.Column("depreciation_run_id", sa.Integer, sa.ForeignKey("accounts_depreciation_runs.id"), nullable=False, index=True),
                                             sa.Column("fixed_asset_id", sa.Integer, sa.ForeignKey("accounts_fixed_assets.id"), nullable=False, index=True),
                                             sa.Column("amount", MONEY, nullable=False), sa.Column("book_value_before", MONEY, nullable=False),
                                             sa.Column("days", sa.Integer, nullable=False, server_default="0"),
                                             sa.Column("previous_depreciated_up_to", sa.Date, nullable=True), *_ts()]),
    ]


def _fy_code(d: date) -> str:
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[2:]}"


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    is_pg = bind.dialect.name == "postgresql"
    tables = set(insp.get_table_names())

    # 1. New tables.
    for name, cols in _new_tables():
        if name not in tables:
            op.create_table(name, *cols)

    # 2. New columns on existing tables.
    for table, cols in NEW_COLUMNS.items():
        existing = {c["name"] for c in insp.get_columns(table)}
        missing = [c for c in cols if c.name not in existing]
        if missing:
            with op.batch_alter_table(table) as batch:
                for c in missing:
                    batch.add_column(c)

    # 3. Exact money types, relaxed nullability (Postgres; SQLite ignores types).
    if is_pg:
        for spec, typ in ((MONEY_COLUMNS, "NUMERIC(18,2)"), (QTY_COLUMNS, "NUMERIC(18,4)"), (PCT_COLUMNS, "NUMERIC(7,3)")):
            for table, cols in spec.items():
                existing = {c["name"]: c for c in insp.get_columns(table)}
                for col in cols:
                    if col in existing and "NUMERIC" not in str(existing[col]["type"]).upper():
                        op.execute(f'ALTER TABLE {table} ALTER COLUMN {col} TYPE {typ} USING ROUND({col}::numeric, {typ.split(",")[1].rstrip(")")})')
    for table, col in (("vendor_invoices", "purchase_order_id"), ("vendor_invoices", "expense_gl_account_id"),
                       ("ar_transactions", "revenue_gl_account_id"), ("bank_accounts", "account_no")):
        cols = {c["name"]: c for c in insp.get_columns(table)}
        if col in cols and not cols[col]["nullable"]:
            with op.batch_alter_table(table) as batch:
                batch.alter_column(col, existing_type=cols[col]["type"], nullable=True)

    existing_idx = {i["name"] for i in insp.get_indexes("journal_entry_lines")}
    if "ix_journal_entry_lines_gl_account_id" not in existing_idx:
        op.create_index("ix_journal_entry_lines_gl_account_id", "journal_entry_lines", ["gl_account_id"])
    if "ix_journal_entry_lines_journal_entry_id" not in existing_idx:
        op.create_index("ix_journal_entry_lines_journal_entry_id", "journal_entry_lines", ["journal_entry_id"])
    je_idx = {i["name"] for i in insp.get_indexes("journal_entries")}
    if "ix_journal_entries_financial_year" not in je_idx:
        op.create_index("ix_journal_entries_financial_year", "journal_entries", ["financial_year"])
    gl_idx = {i["name"] for i in insp.get_indexes("gl_accounts")}
    if "ix_gl_accounts_group_id" not in gl_idx:
        op.create_index("ix_gl_accounts_group_id", "gl_accounts", ["group_id"])

    # 4. Seed groups.
    group_ids = {code: gid for code, gid in bind.execute(sa.text("SELECT code, id FROM account_groups")).fetchall()}
    for code, name, parent, nature, head, gp, seq in GROUPS:
        if code in group_ids:
            continue
        bind.execute(sa.text(
            "INSERT INTO account_groups (code, name, parent_id, nature, schedule_iii_head, affects_gross_profit, sequence, is_system) "
            "VALUES (:code, :name, :parent, :nature, :head, :gp, :seq, :sys)"),
            {"code": code, "name": name, "parent": group_ids.get(parent), "nature": nature, "head": head, "gp": gp, "seq": seq, "sys": True})
        group_ids[code] = bind.execute(sa.text("SELECT id FROM account_groups WHERE code = :c"), {"c": code}).scalar()

    # 5. New ledgers, then every ledger gets a group.
    existing_codes = {r[0] for r in bind.execute(sa.text("SELECT code FROM gl_accounts")).fetchall()}
    natures = {g[0]: g[3] for g in GROUPS}
    for code, name, gcode, is_control in NEW_LEDGERS:
        if code in existing_codes:
            continue
        bind.execute(sa.text(
            "INSERT INTO gl_accounts (code, name, account_type, group_id, status, currency, opening_balance, is_posting_account, is_control_account) "
            "VALUES (:code, :name, :type, :gid, 'active', 'INR', 0, :posting, :control)"),
            {"code": code, "name": name, "type": natures[gcode], "gid": group_ids[gcode], "posting": True, "control": is_control})
    for gid_row in bind.execute(sa.text("SELECT id, code, account_type FROM gl_accounts WHERE group_id IS NULL")).fetchall():
        gcode = LEDGER_GROUP.get(gid_row[1]) or TYPE_FALLBACK.get(gid_row[2], "G-SUSP")
        bind.execute(sa.text("UPDATE gl_accounts SET group_id = :g, account_type = :t WHERE id = :id"),
                     {"g": group_ids[gcode], "t": natures[gcode], "id": gid_row[0]})
    # Seeded header ledgers (1000/1100/2000) are replaced by the group tree.
    bind.execute(sa.text("UPDATE gl_accounts SET status = 'inactive' WHERE code IN ('1000', '1100', '2000') AND is_posting_account = :f"), {"f": False})
    # Legacy combined GST ledgers stay for history but are renamed to say so.
    bind.execute(sa.text("UPDATE gl_accounts SET name = 'GST Input Credit (legacy, combined)' WHERE code = '1150' AND name = 'GST Input Credit'"))
    bind.execute(sa.text("UPDATE gl_accounts SET name = 'GST Output Payable (legacy, combined)' WHERE code = '2020' AND name = 'GST Output Payable'"))

    # 6. Ledger roles and GST rates.
    have_roles = {r[0] for r in bind.execute(sa.text("SELECT role FROM account_determinations")).fetchall()}
    for role in LEDGER_ROLES:
        if role not in have_roles:
            bind.execute(sa.text("INSERT INTO account_determinations (role, gl_account_id) VALUES (:r, NULL)"), {"r": role})
    have_rates = {float(r[0]) for r in bind.execute(sa.text("SELECT rate FROM gst_rates")).fetchall()}
    for rate, desc, active in GST_RATES:
        if float(rate) not in have_rates:
            bind.execute(sa.text("INSERT INTO gst_rates (rate, description, is_active) VALUES (:r, :d, :a)"), {"r": rate, "d": desc, "a": active})

    # 7. Backfill documents.
    bind.execute(sa.text("UPDATE vendor_invoices SET invoice_type = 'po' WHERE invoice_type IS NULL"))
    for inv in bind.execute(sa.text(
            "SELECT v.id, v.invoice_date, v.invoice_amount, v.invoice_gst, v.qty_invoice, v.expense_gl_account_id, vd.payment_days, vd.gstin, "
            "v.invoice_total FROM vendor_invoices v JOIN vendors vd ON vd.id = v.vendor_id "
            "WHERE NOT EXISTS (SELECT 1 FROM vendor_invoice_lines l WHERE l.vendor_invoice_id = v.id)")).fetchall():
        vid, inv_date, amount, gst_amt, qty, gl_id, pdays, gstin, total = inv
        if isinstance(inv_date, str):
            inv_date = date.fromisoformat(inv_date[:10])
        gst_amt = float(gst_amt or 0)
        cgst = round(gst_amt / 2, 2)
        sgst = round(gst_amt - cgst, 2)
        qty = float(qty or 1) or 1
        bind.execute(sa.text("UPDATE vendor_invoices SET cgst_amount = :c, sgst_amount = :s, vendor_gstin = :g, "
                             "due_date = COALESCE(due_date, :due) WHERE id = :id"),
                     {"c": cgst, "s": sgst, "g": gstin, "due": date.fromordinal(inv_date.toordinal() + int(pdays or 0)), "id": vid})
        if gl_id:
            bind.execute(sa.text(
                "INSERT INTO vendor_invoice_lines (vendor_invoice_id, line_number, description, quantity, rate, discount_amount, taxable_amount, "
                "gst_rate, cgst_amount, sgst_amount, igst_amount, gl_account_id) VALUES (:v, 1, 'Purchase (migrated)', :q, :r, 0, :t, :gr, :c, :s, 0, :gl)"),
                {"v": vid, "q": qty, "r": round(float(amount) / qty, 4), "t": amount,
                 "gr": round(gst_amt / float(amount) * 100, 3) if amount else 0, "c": cgst, "s": sgst, "gl": gl_id})
    for txn in bind.execute(sa.text(
            "SELECT a.id, a.invoice_amount, a.gst_amount, a.discount_amount, a.revenue_gl_account_id, o.gst_number FROM ar_transactions a "
            "JOIN crm_organizations o ON o.id = a.customer_id "
            "WHERE NOT EXISTS (SELECT 1 FROM ar_transaction_lines l WHERE l.ar_transaction_id = a.id)")).fetchall():
        aid, amount, gst_amt, disc, gl_id, gstin = txn
        gst_amt = float(gst_amt or 0)
        cgst = round(gst_amt / 2, 2)
        sgst = round(gst_amt - cgst, 2)
        taxable = round(float(amount) - float(disc or 0), 2)
        bind.execute(sa.text("UPDATE ar_transactions SET cgst_amount = :c, sgst_amount = :s, customer_gstin = :g WHERE id = :id"),
                     {"c": cgst, "s": sgst, "g": gstin, "id": aid})
        if gl_id:
            bind.execute(sa.text(
                "INSERT INTO ar_transaction_lines (ar_transaction_id, line_number, description, quantity, rate, discount_amount, taxable_amount, "
                "gst_rate, cgst_amount, sgst_amount, igst_amount, gl_account_id) VALUES (:a, 1, 'Sale (migrated)', 1, :t, 0, :t, :gr, :c, :s, 0, :gl)"),
                {"a": aid, "t": taxable, "gr": round(gst_amt / taxable * 100, 3) if taxable else 0, "c": cgst, "s": sgst, "gl": gl_id})

    # Existing single-invoice payments become bill-wise allocations.
    for pid, ptype, amount, pdate, vinv, artx, created_by in bind.execute(sa.text(
            "SELECT id, payment_type, amount, payment_date, vendor_invoice_id, ar_transaction_id, created_by_id FROM payment_transactions p "
            "WHERE NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.source_type = 'payment' AND a.source_id = p.id)")).fetchall():
        target = ("vendor_invoice", vinv) if vinv else (("ar_transaction", artx) if artx else None)
        if target:
            bind.execute(sa.text("INSERT INTO payment_allocations (source_type, source_id, target_type, target_id, amount, allocation_date, created_by_id) "
                                 "VALUES ('payment', :s, :tt, :ti, :a, :d, :u)"),
                         {"s": pid, "tt": target[0], "ti": target[1], "a": amount, "d": pdate, "u": created_by})
    bind.execute(sa.text("UPDATE payment_transactions SET customer_id = (SELECT customer_id FROM ar_transactions a WHERE a.id = payment_transactions.ar_transaction_id) "
                         "WHERE ar_transaction_id IS NOT NULL AND customer_id IS NULL"))

    # Journals: voucher type + FY.
    vt = {"payment": "payment", "invoice": "journal"}
    for jid, pdate, ptype, rtype in bind.execute(sa.text(
            "SELECT id, posting_date, posting_type, reference_document_type FROM journal_entries WHERE financial_year IS NULL")).fetchall():
        if isinstance(pdate, str):
            pdate = date.fromisoformat(pdate[:10])
        voucher = "purchase" if rtype == "vendor_invoice" and ptype == "invoice" else ("sales" if rtype == "ar_transaction" and ptype == "invoice" else vt.get(ptype, "journal"))
        if ptype == "payment" and rtype == "ar_transaction":
            voucher = "receipt"
        bind.execute(sa.text("UPDATE journal_entries SET financial_year = :fy, voucher_type = :vt WHERE id = :id"),
                     {"fy": _fy_code(pdate), "vt": voucher, "id": jid})

    # 8. Rebuild the monthly balance cache so balances carry forward.
    rows = bind.execute(sa.text(
        "SELECT l.gl_account_id, j.accounting_period, COALESCE(SUM(l.debit_amount), 0), COALESCE(SUM(l.credit_amount), 0) "
        "FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id "
        "WHERE j.status IN ('posted', 'reversed') GROUP BY l.gl_account_id, j.accounting_period "
        "ORDER BY l.gl_account_id, j.accounting_period")).fetchall()
    closed = {r[0] for r in bind.execute(sa.text("SELECT accounting_period FROM period_close WHERE status = 'closed'")).fetchall()}
    bind.execute(sa.text("DELETE FROM gl_balances"))
    running: dict = {}
    for gl_id, period, debits, credits in rows:
        opening = running.get(gl_id, 0.0)
        closing = round(opening + float(debits) - float(credits), 2)
        bind.execute(sa.text(
            "INSERT INTO gl_balances (gl_account_id, accounting_period, opening_balance, total_debits, total_credits, closing_balance, is_locked) "
            "VALUES (:g, :p, :o, :d, :c, :cl, :l)"),
            {"g": gl_id, "p": period, "o": round(opening, 2), "d": round(float(debits), 2), "c": round(float(credits), 2), "cl": closing, "l": period in closed})
        running[gl_id] = closing


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    for name, _ in reversed(_new_tables()):
        if name == "account_groups":
            continue
        if name in tables:
            op.drop_table(name)
    for idx, table in (("ix_journal_entry_lines_gl_account_id", "journal_entry_lines"), ("ix_journal_entry_lines_journal_entry_id", "journal_entry_lines"),
                       ("ix_journal_entries_financial_year", "journal_entries"), ("ix_gl_accounts_group_id", "gl_accounts")):
        if idx in {i["name"] for i in insp.get_indexes(table)}:
            op.drop_index(idx, table_name=table)
    for table, cols in NEW_COLUMNS.items():
        existing = {c["name"] for c in insp.get_columns(table)}
        drop = [c.name for c in cols if c.name in existing]
        if drop:
            with op.batch_alter_table(table) as batch:
                for c in drop:
                    batch.drop_column(c)
    if "account_groups" in tables:
        op.drop_table("account_groups")
    codes = [c[0] for c in NEW_LEDGERS]
    bind.execute(sa.text("DELETE FROM gl_accounts WHERE code IN :codes AND id NOT IN (SELECT gl_account_id FROM journal_entry_lines)")
                 .bindparams(sa.bindparam("codes", expanding=True)), {"codes": codes})
    if bind.dialect.name == "postgresql":
        for spec in (MONEY_COLUMNS, QTY_COLUMNS, PCT_COLUMNS):
            for table, cols in spec.items():
                for col in cols:
                    op.execute(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE DOUBLE PRECISION USING {col}::double precision")
