"""Finance & Accounting features, PART B — Bank & Cash (reconciliation,
guarantees), Fixed Assets, GST, Currencies & FX, Inventory accounting,
Outstanding (receivables / payables, collections, disputes, MSME), Costing &
Profitability and Controlling. See permission_registry.FEATURES. (Journals,
masters, payments, purchase, sales and reports live in accounts.py.)

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had. Record-level rules stay on top: Finance Manager for GST
set-off / closing stock / FX revaluation / depreciation, the approval
engine (guarantees, credit releases), creator-only deletes and data scope.

No "sensitive data" switch here: every Finance tab is money by nature, so
hiding the tab (or the sub-tab below) is the control."""
from app.core.permission_registry import _feature, register_features

# ── Bank & Cash ──────────────────────────────────────────────────────────

register_features(
    "accounts", "reconciliation",
    _feature("bank_statements", "Bank statement import", "section", {
        "view": "view", "create": "create", "delete": "delete",
    }, "The imported bank statement lines of a reconciliation: import a statement file, see its lines and remove an import."),
    _feature("book_statement_lines", "Book from statement", "action", {
        "view": "view", "create": "edit",
    }, "Post a voucher straight from an unmatched statement line (bank charges, interest, direct credits)."),
    _feature("completion", "Complete reconciliation", "action", {
        "view": "view", "approve": "edit",
    }, "Lock a balanced BRS as the record for its statement date."),
)

register_features(
    "accounts", "guarantees",
    _feature("lifecycle", "Issue, extend & release", "action", {
        "view": "view", "edit": "edit",
    }, "Mark an approved instrument as issued by the bank, extend its validity, or release / close it."),
    _feature("bank_postings", "Margin money & commission", "action", {
        "view": "view", "create": "edit",
    }, "Post the margin money / deposit payment and book the bank's commission (both create accounting entries)."),
    _feature("invocation", "Record invocation", "action", {
        "view": "view", "approve": "approve",
    }, "Record that the beneficiary invoked a guarantee (the claim is booked against us / in our favour)."),
    _feature("instrument_copy", "Instrument copy", "section", {
        "view": "view", "create": "edit",
    }, "Open and upload the scanned copy of the guarantee / LC / EMD instrument."),
)

# ── Fixed assets ─────────────────────────────────────────────────────────

register_features(
    "accounts", "fixed_assets",
    _feature("capitalisation", "Capitalisation", "subtab", {
        "view": "view", "create": "create",
    }, "The Capitalisation sub-tab: invoice lines and internal orders waiting to become assets, and capitalising them."),
    _feature("retirements", "Retirements", "subtab", {
        "view": "view", "create": "edit",
    }, "The Retirements sub-tab: retire (sell / scrap) all or part of an asset and see past retirements."),
    _feature("asset_reconciliation", "Asset reconciliation", "subtab", {
        "view": "view",
    }, "The Reconciliation sub-tab: asset register vs the fixed-asset ledgers."),
)

register_features(
    "accounts", "depreciation",
    _feature("reversal", "Reverse depreciation runs", "action", {
        "view": "view", "cancel": "approve",
    }, "Reverse a posted monthly depreciation run (its journal is reversed). The user must also be a Finance Manager."),
)

# ── GST, currencies, inventory ───────────────────────────────────────────

register_features(
    "accounts", "gst",
    _feature("gstr1", "GSTR-1", "subtab", {"view": "view"},
             "The GSTR-1 sub-tab: outward supplies working figures for a return period."),
    _feature("gstr3b", "GSTR-3B", "subtab", {"view": "view"},
             "The GSTR-3B sub-tab: summary return working figures for a return period."),
    _feature("itc_setoff", "ITC set-off", "subtab", {
        "view": "view", "approve": "edit",
    }, "The ITC Set-off sub-tab: preview the monthly input-credit set-off and post it (posting also needs Finance Manager)."),
)

register_features(
    "accounts", "currencies",
    _feature("exchange_rates", "Exchange rates", "action", {
        "view": "view", "create": "create",
    }, "Record a new exchange rate for a currency (used to convert foreign-currency invoices and payments)."),
    _feature("revaluation", "FX revaluation", "subtab", {
        "view": "view", "approve": "approve", "cancel": "approve",
    }, "The Revaluation sub-tab: preview, post and cancel month-end revaluation of open foreign-currency items (posting also needs Finance Manager)."),
)

register_features(
    "accounts", "inventory",
    _feature("purchase_sales_impact", "Purchase / sales impact", "subtab", {"view": "view"},
             "The Purchase / Sales Impact sub-tab: how purchases and sales moved the stock value in a period."),
    _feature("closing_stock", "Closing stock", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "approve": "edit", "cancel": "edit",
    }, "The Closing Stock sub-tab: create a month-end valuation, adjust its lines, post and cancel it (posting also needs Finance Manager)."),
)

# ── Outstanding ──────────────────────────────────────────────────────────

register_features(
    "accounts", "outstanding",
    _feature("receivables", "Receivables (customers)", "subtab", {"view": "view"},
             "Customer outstanding, open bills and customer statements."),
    _feature("payables", "Payables (vendors)", "subtab", {"view": "view"},
             "Vendor outstanding, open bills and vendor statements."),
    _feature("msme_dues", "MSME dues", "subtab", {"view": "view"},
             "The MSME Dues page: MSME vendor bills nearing / past the 45-day limit and the section 43B(h) disallowance."),
)

register_features(
    "accounts", "collections",
    _feature("dunning", "Dunning & reminder letters", "action", {
        "view": "view", "create": "create", "edit": "edit", "cancel": "edit", "print": "view",
    }, "Run dunning, see / print / edit (Word) the reminder letters and cancel a letter."),
)

register_features(
    "accounts", "disputes",
    _feature("resolution", "Resolve disputes", "action", {
        "view": "view", "approve": "edit",
    }, "Close a dispute with its outcome (accepted, credit note, rejected …)."),
)

# ── Costing & profitability ──────────────────────────────────────────────

register_features(
    "accounts", "product_costing",
    _feature("order_variance", "Order variance", "subtab", {"view": "view"},
             "The Order Variance sub-tab: plan vs actual cost per work order. (Production › BOM viewers keep seeing it.)"),
    _feature("price_history", "Standard price history", "section", {"view": "view"},
             "The history of released standard prices of an item on a cost estimate."),
)

register_features(
    "accounts", "profit_centers",
    _feature("pl_report", "Profit centre P&L", "subtab", {"view": "view"},
             "The Profit Centre P&L sub-tab and its line-item drill-down. (Financial Reports viewers keep seeing it.)"),
    _feature("assignment", "Assign & re-derive", "action", {
        "view": "view", "edit": "edit",
    }, "Assign cost centres / products to profit centres and re-derive the profit centre on posted entries."),
)

register_features(
    "accounts", "profitability",
    _feature("line_items", "Line-item drill-down", "section", {"view": "view"},
             "Open the individual revenue / cost postings behind a contribution-margin figure."),
)

# ── Controlling ──────────────────────────────────────────────────────────

register_features(
    "accounts", "co_planning",
    _feature("plan_vs_actual", "Plan vs actual", "subtab", {"view": "view"},
             "The Plan vs Actual sub-tab: planned vs posted cost per cost centre and ledger."),
)

register_features(
    "accounts", "allocations",
    _feature("reversal", "Reverse allocation runs", "action", {
        "view": "view", "cancel": "approve",
    }, "Reverse a posted assessment / distribution run."),
)

register_features(
    "accounts", "overhead",
    _feature("reversal", "Reverse overhead runs", "action", {
        "view": "view", "cancel": "approve",
    }, "Reverse a posted overhead (costing sheet) run."),
)
