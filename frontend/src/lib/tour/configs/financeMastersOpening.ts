import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-masters-opening',
  pageTitle: 'Finance — Opening Balances',
  steps: [
    {
      target: 'fin-subtab-opening-balances',
      title: 'Opening Balances',
      purpose: 'Brings the closing figures of the old books into this system — once, as one dated, balanced Opening Balance voucher.',
      autoActivate: true,
      why: 'Posting openings as a voucher (instead of typing a balance on each ledger) keeps them auditable and lets bill-wise ageing work from day one.',
    },
    {
      target: 'fin-ob-date',
      title: 'Opening date',
      required: true,
      whatToEnter: 'The first day the books start in this system — normally 1-Apr of the current financial year (pre-filled).',
      validExample: '01-04-2026',
    },
    {
      target: 'fin-ob-narration',
      title: 'Narration',
      whatToEnter: 'Text printed on the voucher.',
      validExample: 'Opening balances as per audited TB 31-03-2026',
    },
    {
      target: 'fin-ob-ledgers',
      title: 'Ledger balances',
      purpose: 'Balances of assets, liabilities and capital ledgers — bank, cash, loans, fixed assets, GST credit, capital, retained earnings.',
      whatToEnter: 'Pick the ledger and enter its balance in Debit (assets) or Credit (liabilities/capital). Typing in one column clears the other.',
      validExample: 'HDFC Bank — Debit 4,25,000.00',
      invalidExample: 'Sundry Debtors / Creditors (enter those bill-wise below) or any income/expense ledger (they start at zero every year)',
    },
    {
      target: 'fin-ob-add-ledger',
      title: '+ Add ledger',
      purpose: 'Adds another ledger row. Use ✕ on a row to remove it.',
    },
    {
      target: 'fin-ob-vendor-bills',
      title: 'Vendor bills unpaid',
      purpose: 'Each vendor bill still unpaid on the opening date, one row per bill — this builds Sundry Creditors (credit, we owe).',
      whatToEnter: 'Vendor, bill no., bill date, due date and amount still due. Bill date defaults to the opening date; due date to bill date + payment days.',
      why: 'Bill-wise entry means payables ageing and bill-by-bill payment set-off work from day one.',
    },
    {
      target: 'fin-ob-add-vendor-bill',
      title: '+ Add vendor bill',
      purpose: 'Adds a row for one unpaid vendor bill.',
    },
    {
      target: 'fin-ob-customer-bills',
      title: 'Customer invoices unpaid',
      purpose: 'Each customer invoice still unpaid on the opening date — this builds Sundry Debtors (debit, owed to us).',
      whatToEnter: 'Customer, invoice no., invoice date, due date and amount due. Due date defaults to invoice date + credit days (30 if not set).',
    },
    {
      target: 'fin-ob-add-customer-bill',
      title: '+ Add customer invoice',
      purpose: 'Adds a row for one unpaid customer invoice.',
    },
    {
      target: 'fin-ob-totals',
      title: 'Totals & difference',
      purpose: 'Total debits (ledger debits + customer invoices) must equal total credits (ledger credits + vendor bills).',
      why: 'If the old trial balance didn\'t agree, find the difference before go-live — never park it in a suspense ledger.',
    },
    {
      target: 'fin-ob-post-btn',
      title: 'Post Opening Balances',
      purpose: 'Enabled only when balanced, dated, and you are a Finance Manager or admin.',
      after: 'You confirm, then one Opening Balance voucher is posted. Party bills now show in Outstanding and ageing. It can be done only once — to redo it, reverse that voucher first.',
    },
  ],
}

export default config
