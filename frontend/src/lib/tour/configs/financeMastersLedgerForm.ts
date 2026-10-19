import { TourConfig, TourStep } from '../types'

export const LEDGER_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-ledgers-group',
    title: 'Group',
    required: true,
    purpose: 'The account group this ledger belongs to.',
    whatToEnter: 'Search and pick the group, e.g. "Bank Accounts", "Indirect Expenses", "Duties & Taxes".',
    validExample: 'Indirect Expenses › Office Expenses',
    why: 'The group decides where the ledger shows in the Balance Sheet / P&L and fixes its type.',
  },
  {
    target: 'fin-ledgers-type',
    title: 'Type (from group)',
    purpose: 'Asset, Liability, Capital / Equity, Income or Expense — filled in from the group, not typed.',
  },
  {
    target: 'fin-ledgers-code',
    title: 'Code',
    required: true,
    whatToEnter: 'A unique ledger code (numbers or letters).',
    validExample: '5210',
    invalidExample: 'A code already used by another ledger',
  },
  {
    target: 'fin-ledgers-name',
    title: 'Name',
    required: true,
    whatToEnter: 'The ledger name as it should appear in reports.',
    validExample: 'Printing & Stationery',
  },
  {
    target: 'fin-ledgers-subtype',
    title: 'Sub-type (optional)',
    purpose: 'A free-text tag for your own reporting (e.g. "Statutory", "Fuel"). Leave blank if not needed.',
  },
  {
    target: 'fin-ledgers-posting',
    title: 'Posting',
    options: [
      { value: 'Yes — vouchers post here', meaning: 'A normal ledger that invoices, payments and journals can hit.' },
      { value: 'No — header only', meaning: 'A heading used only to group figures in reports; nothing can be posted to it.' },
    ],
  },
  {
    target: 'fin-ledgers-control',
    title: 'Control account',
    options: [
      { value: 'No', meaning: 'Ordinary ledger (default).' },
      { value: 'Yes — sum of a party sub-ledger', meaning: 'Like Sundry Debtors / Sundry Creditors: its balance is the total of individual customer or vendor balances.' },
    ],
    why: 'A journal line on a control account must name the vendor or customer, so party balances and the control total never drift apart.',
  },
  {
    target: 'fin-ledgers-status',
    title: 'Status',
    options: [
      { value: 'Active', meaning: 'Available on new vouchers.' },
      { value: 'Inactive', meaning: 'Hidden from new vouchers; history is kept. Use this instead of deleting a ledger that has postings.' },
    ],
  },
  {
    target: 'fin-masters-form-save',
    title: 'Create Ledger / Save Changes',
    purpose: 'Saves the ledger. Group, code and name are required.',
    after: 'The popup closes and the ledger appears under its group in the list. Opening balances are not typed here — use the Opening Balances tab.',
  },
  {
    target: 'fin-masters-form-cancel',
    title: 'Cancel',
    purpose: 'Closes the form without saving.',
  },
]

const config: TourConfig = {
  id: 'finance-masters-ledger-form',
  pageTitle: 'Finance — Ledger form',
  steps: [
    {
      target: 'fin-subtab-ledgers',
      title: 'Ledgers',
      purpose: 'You are adding or editing a ledger in the chart of accounts.',
    },
    ...LEDGER_FORM_STEPS,
  ],
}

export default config
