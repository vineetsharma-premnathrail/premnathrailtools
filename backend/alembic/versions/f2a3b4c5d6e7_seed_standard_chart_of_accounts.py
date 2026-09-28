"""seed standard indian-manufacturing chart of accounts

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-26

Starter chart of accounts only — codes/names are editable via the GL
Accounts admin UI once a real chart is supplied by whoever owns SAP FI
configuration (see old_docs/product/ACCOUNTS_MODULE_ROADMAP.md, Open
Question 1). Kept as a separate migration from the schema DDL so a
rollback/re-run of one never entangles the other.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None

# (code, name, account_type, account_sub_type, is_posting_account, is_control_account)
CHART_OF_ACCOUNTS = [
    # Assets — 1xxx
    ("1000", "Fixed Assets", "asset", "Fixed Assets", False, False),
    ("1010", "Plant & Machinery", "asset", "Fixed Assets", True, False),
    ("1020", "Furniture & Fixtures", "asset", "Fixed Assets", True, False),
    ("1030", "Accumulated Depreciation", "asset", "Fixed Assets", True, False),
    ("1100", "Current Assets", "asset", "Current Assets", False, False),
    ("1110", "Cash in Hand", "asset", "Current Assets", True, False),
    ("1120", "Bank Accounts", "asset", "Current Assets", True, False),
    ("1130", "Accounts Receivable", "asset", "Current Assets", True, True),
    ("1140", "Raw Material Inventory", "asset", "Inventory", True, False),
    ("1141", "Work-in-Progress Inventory", "asset", "Inventory", True, False),
    ("1142", "Finished Goods Inventory", "asset", "Inventory", True, False),
    ("1150", "GST Input Credit", "asset", "Current Assets", True, False),
    ("1160", "Prepaid Expenses", "asset", "Current Assets", True, False),
    # Liabilities — 2xxx
    ("2000", "Current Liabilities", "liability", "Current Liabilities", False, False),
    ("2010", "Accounts Payable", "liability", "Current Liabilities", True, True),
    ("2020", "GST Output Payable", "liability", "Current Liabilities", True, False),
    ("2030", "TDS Payable", "liability", "Current Liabilities", True, False),
    ("2040", "PF Payable", "liability", "Current Liabilities", True, False),
    ("2050", "ESI Payable", "liability", "Current Liabilities", True, False),
    ("2060", "Salary Payable", "liability", "Current Liabilities", True, False),
    ("2100", "Short-Term Loans", "liability", "Loans", True, False),
    ("2200", "Long-Term Loans", "liability", "Loans", True, False),
    # Equity — 3xxx
    ("3000", "Share Capital", "equity", "Equity", True, False),
    ("3010", "Retained Earnings", "equity", "Equity", True, False),
    ("3020", "General Reserves", "equity", "Equity", True, False),
    # Revenue — 4xxx
    ("4000", "Sales — Domestic", "revenue", "Sales", True, False),
    ("4010", "Sales — Export", "revenue", "Sales", True, False),
    ("4100", "Other Income", "revenue", "Other Income", True, False),
    ("4110", "Interest Income", "revenue", "Other Income", True, False),
    # Expense — 5xxx
    ("5000", "Raw Material Consumed", "expense", "Cost of Goods Sold", True, False),
    ("5010", "Direct Labor", "expense", "Cost of Goods Sold", True, False),
    ("5020", "Factory Overheads", "expense", "Cost of Goods Sold", True, False),
    ("5100", "Salaries & Wages", "expense", "Employee Cost", True, False),
    ("5200", "Rent", "expense", "Admin Expense", True, False),
    ("5210", "Power & Fuel", "expense", "Admin Expense", True, False),
    ("5220", "Repairs & Maintenance", "expense", "Admin Expense", True, False),
    ("5230", "Administrative Expenses", "expense", "Admin Expense", True, False),
    ("5300", "Freight & Forwarding", "expense", "Selling Expense", True, False),
    ("5310", "Selling & Distribution", "expense", "Selling Expense", True, False),
    ("5400", "Depreciation", "expense", "Depreciation", True, False),
    ("5500", "Interest & Finance Charges", "expense", "Finance Cost", True, False),
    ("5600", "Bad Debts Written Off", "expense", "Other Expense", True, False),
    ("5700", "Provision for Tax", "expense", "Tax", True, False),
]


def upgrade() -> None:
    conn = op.get_bind()
    existing = {row[0] for row in conn.execute(sa.text("SELECT code FROM gl_accounts")).fetchall()}
    rows = [
        {
            "code": code, "name": name, "account_type": account_type, "account_sub_type": sub_type,
            "is_posting_account": is_posting, "is_control_account": is_control,
        }
        for code, name, account_type, sub_type, is_posting, is_control in CHART_OF_ACCOUNTS
        if code not in existing
    ]
    if rows:
        op.bulk_insert(
            sa.table(
                "gl_accounts",
                sa.column("code", sa.String),
                sa.column("name", sa.String),
                sa.column("account_type", sa.String),
                sa.column("account_sub_type", sa.String),
                sa.column("is_posting_account", sa.Boolean),
                sa.column("is_control_account", sa.Boolean),
            ),
            rows,
        )


def downgrade() -> None:
    conn = op.get_bind()
    codes = [c[0] for c in CHART_OF_ACCOUNTS]
    conn.execute(sa.text("DELETE FROM gl_accounts WHERE code IN :codes").bindparams(sa.bindparam("codes", expanding=True)), {"codes": codes})
