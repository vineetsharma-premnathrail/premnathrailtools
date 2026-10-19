import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-masters-company',
  pageTitle: 'Finance — Masters: Company & FY',
  steps: [
    {
      target: 'finance-nav-file',
      title: 'Masters',
      purpose: 'Set-up screens every voucher depends on — financial year, chart of accounts, GST rates, bank & cash accounts, vendors and opening balances.',
      why: 'Get these right once and every invoice, payment and report afterwards posts to the right place automatically.',
    },
    {
      target: 'finance-nav-grid',
      title: 'Journals',
      purpose: 'Manual journal vouchers (drafted by one person, posted by another), the Day Book, ledger statements and month-end Period Close.',
    },
    {
      target: 'finance-nav-cart',
      title: 'Purchase',
      purpose: 'Book vendor bills (against a PO with 3-way match, or direct for services) and raise debit notes for returns or rate differences.',
    },
    {
      target: 'finance-nav-tag',
      title: 'Sales',
      purpose: 'Raise GST tax invoices to customers, record e-invoice (IRN) / e-way bill details and issue credit notes.',
    },
    {
      target: 'finance-nav-rupee',
      title: 'Payments',
      purpose: 'Money going out to vendors and coming in from customers, set off bill-by-bill, plus contra (bank ↔ cash) transfers.',
    },
    {
      target: 'finance-nav-building',
      title: 'Bank & Cash',
      purpose: 'Bank/cash balances, account statements, cheque register and bank reconciliation (matching our books with the bank statement).',
    },
    {
      target: 'finance-nav-percent',
      title: 'GST',
      purpose: 'Monthly GST working: output tax, input credit, set-off, GSTR-1 / GSTR-3B summaries and the HSN summary.',
    },
    {
      target: 'finance-nav-users',
      title: 'Outstanding',
      purpose: 'Who owes us (receivables) and whom we owe (payables), bill-wise, with ageing buckets.',
    },
    {
      target: 'finance-nav-box',
      title: 'Inventory',
      purpose: 'Month-end closing stock valuation that posts to the books (we use periodic inventory).',
    },
    {
      target: 'finance-nav-tool',
      title: 'Assets',
      purpose: 'Fixed asset register, depreciation runs and asset disposal.',
    },
    {
      target: 'finance-nav-chart',
      title: 'Reports',
      purpose: 'Trial Balance, Profit & Loss, Balance Sheet, Cash Flow and other financial statements.',
    },
    {
      target: 'fin-subtab-company-fy',
      title: 'Company & FY tab',
      purpose: 'The masters are split into sub-tabs. This one shows the financial year and company GST registration (read-only here).',
      autoActivate: true,
    },
    {
      target: 'fin-subtab-account-groups',
      title: 'Account Groups',
      purpose: 'The tree of groups (Assets › Current Assets › Sundry Debtors…) that decides where every ledger appears in the Balance Sheet / P&L.',
    },
    {
      target: 'fin-subtab-ledgers',
      title: 'Ledgers',
      purpose: 'The chart of accounts — every account a voucher can post to.',
    },
    {
      target: 'fin-subtab-ledger-settings',
      title: 'Ledger Settings',
      purpose: 'Which ledger the system uses for automatic postings (Purchases, Sales, GST input/output, round-off…).',
    },
    {
      target: 'fin-subtab-gst-rates',
      title: 'GST Rates',
      purpose: 'The GST slabs offered on invoice lines.',
    },
    {
      target: 'fin-subtab-bank-cash',
      title: 'Bank & Cash',
      purpose: 'Company bank accounts and cash boxes, each linked to its own ledger.',
    },
    {
      target: 'fin-subtab-vendors',
      title: 'Vendors',
      purpose: 'Supplier master with GSTIN, state, bank details and payment terms.',
    },
    {
      target: 'fin-subtab-internal-orders',
      title: 'Internal Orders',
      purpose: 'Cost collectors for one job or project (capital build, major repair) with a budget.',
    },
    {
      target: 'fin-subtab-opening-balances',
      title: 'Opening Balances',
      purpose: 'One-time voucher that brings in balances from the old books on go-live day.',
    },
    {
      target: 'fin-masters-fy-card',
      title: 'Current financial year',
      purpose: 'The Indian financial year (1-Apr to 31-Mar) that covers today, its status and lock date.',
      options: [
        { value: 'Open', meaning: 'Vouchers can be posted with dates in this year.' },
        { value: 'Locked', meaning: 'Postings on or before the lock date are refused — used once a period is audited/filed.' },
        { value: 'Closed', meaning: 'Year finished; nothing more can be posted into it.' },
      ],
      why: 'Voucher numbers restart every year (e.g. JV/2026-27/0001) and nothing can be posted outside an open year — this protects filed returns and audited figures.',
    },
    {
      target: 'fin-masters-gst-card',
      title: 'Company GST registration',
      purpose: 'Our GSTIN and state. Our state vs the party\'s state decides CGST + SGST (same state) or IGST (different state) on every invoice.',
    },
    {
      target: 'fin-masters-company-info-link',
      title: 'Open Company Info',
      purpose: 'Financial years and the company GSTIN are maintained in Company Info, not here — Finance only reads them so there is one source of truth.',
      after: 'Takes you to Organization → Company Info (Financial Year and Legal & Registration tabs).',
    },
    {
      target: 'fin-masters-fy-table',
      title: 'All financial years',
      purpose: 'Every year defined in Company Info with its start/end, status and lock date. "(current)" marks the year covering today.',
    },
  ],
}

export default config
