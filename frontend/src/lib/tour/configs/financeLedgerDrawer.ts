import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-ledger-drawer',
  pageTitle: 'Finance — Ledger statement (drill-down)',
  steps: [
    {
      target: 'fin-rep-ledger-drawer',
      title: 'Ledger statement',
      purpose: 'Opened by clicking a ledger on the Trial Balance — shows that ledger for the same date range.',
    },
    {
      target: 'fin-rep-ledger-stats',
      title: 'Summary',
      purpose: 'Opening balance, total debits, total credits and closing balance (Dr / Cr).',
    },
    {
      target: 'fin-rep-ledger-table',
      title: 'Postings',
      purpose: 'Opening line, then every posting with date, voucher number and type, narration, debit / credit and running balance, ending with the closing balance.',
    },
    {
      target: 'fin-rep-ledger-close',
      title: 'Close',
      purpose: 'Back to the Trial Balance (clicking outside the panel also closes it).',
    },
  ],
}

export default config
