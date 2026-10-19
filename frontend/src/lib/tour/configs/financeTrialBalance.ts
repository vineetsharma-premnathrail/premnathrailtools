import { TourConfig } from '../types'
import { PRINT_STEP, rangeSteps } from './financeReportSteps'

const config: TourConfig = {
  id: 'finance-trial-balance',
  pageTitle: 'Finance — Trial Balance',
  steps: [
    {
      target: 'finance-nav-chart',
      title: 'Reports',
      purpose: 'Trial Balance, P&L, Balance Sheet, Cash Flow, ageing, budgets, the monthly pack and year-end close — all computed live from posted vouchers.',
    },
    {
      target: 'fin-subtab-trial-balance',
      title: 'Report tabs',
      purpose: 'Pick a report. This tour explains the Trial Balance; open another tab and press the tour button again for that report.',
      autoActivate: true,
    },
    ...rangeSteps(),
    {
      target: 'fin-rep-tb-table',
      title: 'Trial Balance',
      purpose: 'Every ledger with a balance or movement, grouped under its primary group (shaded subtotal rows): opening Dr/Cr, period Debit/Credit and closing Dr/Cr. Click a ledger to open its statement in a side panel. A "✓ Balanced" pill shows at the top right.',
      why: 'Every entry has equal debits and credits, so the columns must total the same. If the Grand total is red / "Out of balance", stop and investigate before trusting any other report.',
    },
    PRINT_STEP,
  ],
}

export default config
