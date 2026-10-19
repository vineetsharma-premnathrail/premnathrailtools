import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-ledger-statement',
  pageTitle: 'Finance — Ledger Statement',
  steps: [
    {
      target: 'fin-subtab-ledger-statement',
      title: 'Ledger Statement',
      purpose: 'The account statement of one ledger: opening balance, every posting in the period and the running balance.',
      autoActivate: true,
    },
    {
      target: 'fin-ledstmt-ledger',
      title: 'Ledger',
      required: true,
      whatToEnter: 'Search by code or name and pick one active ledger. The statement loads as soon as you pick.',
      validExample: '1110 — HDFC Bank',
    },
    {
      target: 'fin-ledstmt-from',
      title: 'From',
      purpose: 'Start date (defaults to 1-Apr of this financial year). Everything before it is rolled into the opening balance.',
    },
    {
      target: 'fin-ledstmt-to',
      title: 'To',
      purpose: 'End date (defaults to today).',
    },
    {
      target: 'fin-ledstmt-show',
      title: 'Show',
      purpose: 'Reloads the statement after you change the dates.',
    },
    {
      target: 'fin-ledstmt-stats',
      title: 'Summary cards',
      purpose: 'Opening balance, total debits, total credits and closing balance for the period.',
      why: 'Dr balances are normal for assets and expenses; Cr for liabilities, capital and income. A bank ledger showing Cr means an overdraft.',
    },
    {
      target: 'fin-ledstmt-table',
      title: 'Statement',
      purpose: 'Opening balance row, then each posting with voucher no., type, narration, Dr, Cr and running balance, and a closing totals row.',
    },
  ],
}

export default config
