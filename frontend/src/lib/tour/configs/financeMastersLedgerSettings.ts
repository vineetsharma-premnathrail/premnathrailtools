import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-masters-ledger-settings',
  pageTitle: 'Finance — Ledger Settings',
  steps: [
    {
      target: 'fin-subtab-ledger-settings',
      title: 'Ledger Settings',
      purpose: 'Tells the system which ledger plays each role when it posts on its own — e.g. a purchase invoice debits "Purchases" and credits the vendor; GST goes to "Input CGST/SGST/IGST".',
      autoActivate: true,
      why: 'In ERP terms this is "account determination": users never pick GL accounts on an invoice, so the mapping must be set once, centrally.',
    },
    {
      target: 'fin-ledger-settings-table',
      title: 'Roles and their ledgers',
      purpose: 'One row per role: the ledger currently used, the standard code it defaults to, and a picker to change it.',
      options: [
        { value: 'Default', meaning: 'The role uses the standard ledger from the built-in chart.' },
        { value: 'Changed', meaning: 'Someone pointed this role at a different ledger.' },
        { value: 'Not found — pick a ledger', meaning: 'The standard ledger is missing — automatic postings for this role will fail until you pick one.' },
        { value: 'Change to', meaning: 'Pick a new ledger; it saves immediately.' },
        { value: 'Reset to default', meaning: 'Puts the role back on the standard ledger.' },
      ],
      after: 'A change affects new postings only — vouchers already posted stay where they are. Only a Finance Manager (or admin) can change these.',
    },
  ],
}

export default config
