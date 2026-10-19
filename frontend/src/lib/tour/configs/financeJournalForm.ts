import { TourConfig, TourStep } from '../types'

export const JOURNAL_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-jv-date',
    title: 'Posting Date',
    required: true,
    whatToEnter: 'The date the entry belongs to (defaults to today). It must fall in an open financial year and an unclosed month.',
    validExample: '31-10-2026 for an October month-end provision',
  },
  {
    target: 'fin-jv-form-type',
    title: 'Posting Type',
    options: [
      { value: 'Adjustment', meaning: 'A general correction or reclassification between ledgers.' },
      { value: 'Accrual', meaning: 'Books an expense/income in the month it belongs to before the bill arrives — reverses itself automatically next month.' },
      { value: 'Correction', meaning: 'Fixes an earlier wrong posting.' },
      { value: 'Depreciation', meaning: 'Manual depreciation entry (normally done from Assets → Depreciation run).' },
    ],
    why: 'Use a journal only for entries no document covers — invoices, notes and payments post their own entries.',
  },
  {
    target: 'fin-jv-auto-reverse',
    title: 'Auto-reverse On',
    purpose: 'Shown only for Accrual. The date an automatic reversing entry is posted — normally the 1st of next month (pre-filled).',
    why: 'When the real bill arrives and is booked, the reversal cancels the accrual so the expense is not counted twice.',
  },
  {
    target: 'fin-jv-description',
    title: 'Description / Narration',
    whatToEnter: 'What the entry is for — this appears in the Day Book and ledger statements.',
    validExample: 'Provision for October electricity — bill not yet received',
  },
  {
    target: 'fin-jv-lines',
    title: 'Journal lines',
    purpose: 'Each line is one ledger with either a Debit or a Credit amount (typing in one column clears the other).',
    whatToEnter: 'Ledger (required), Party (only for control accounts like Sundry Creditors/Debtors — then required), Cost Centre (optional, for department-wise costing), Debit or Credit, Remarks.',
    validExample: 'Dr Electricity Expense 85,000 / Cr Provision for Expenses 85,000',
    invalidExample: 'Dr 85,000 / Cr 80,000 — the Difference badge turns red and Save stays disabled',
    after: 'The badge at the bottom shows "Balanced" in green only when total debits equal total credits.',
  },
  {
    target: 'fin-jv-add-line',
    title: '+ Add line',
    purpose: 'Adds another line. Use ✕ to remove a line (minimum two lines).',
  },
  {
    target: 'fin-jv-save',
    title: 'Save Draft',
    purpose: 'Saves the journal as a Draft — enabled only when it balances.',
    after: 'The draft appears in the list. A different finance user must open it and click Post (maker-checker); only then does it get a JV number and hit the ledgers.',
    why: 'Maker-checker: the second pair of eyes is the control against errors and fraud.',
  },
  {
    target: 'fin-jv-cancel',
    title: 'Cancel',
    purpose: 'Closes the form without saving.',
  },
  {
    target: 'fin-jv-back',
    title: '← Back',
    purpose: 'Closes the form without saving — same as Cancel.',
  },
]

const config: TourConfig = {
  id: 'finance-journal-form',
  pageTitle: 'Finance — New Journal',
  steps: [
    {
      target: 'fin-subtab-journal-vouchers',
      title: 'Journal Vouchers',
      purpose: 'You are drafting a manual journal voucher.',
    },
    ...JOURNAL_FORM_STEPS,
  ],
}

export default config
