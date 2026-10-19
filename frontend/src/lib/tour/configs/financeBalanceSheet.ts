import { TourConfig } from '../types'
import { PRINT_STEP, rangeSteps, reportTabStep } from './financeReportSteps'

const config: TourConfig = {
  id: 'finance-balance-sheet',
  pageTitle: 'Finance — Balance Sheet',
  steps: [
    reportTabStep(
      'fin-subtab-balance-sheet',
      'Balance Sheet',
      'What the company owns (assets) and owes (equity and liabilities) on one date, in Schedule III format.',
      'Assets must always equal Equity + Liabilities. A "✓ Balanced" pill confirms it; otherwise the difference is shown in red.',
    ),
    ...rangeSteps(true),
    {
      target: 'fin-rep-bs-table',
      title: 'Balance Sheet',
      purpose: 'I Equity and Liabilities and II Assets, each split into sub-sections (shareholders\' funds, non-current / current liabilities, non-current / current assets) and heads. Click a head (▶) to see its ledgers.',
      after: 'If profit has not yet been closed to Retained Earnings, it shows as "Surplus in the Statement of P&L" inside Reserves and Surplus so the sheet still balances. If out of balance, check the Trial Balance — a ledger is probably in the wrong account group.',
    },
    PRINT_STEP,
  ],
}

export default config
