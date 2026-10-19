import { TourConfig } from '../types'
import { PRINT_STEP, rangeSteps, reportTabStep } from './financeReportSteps'

const config: TourConfig = {
  id: 'finance-profit-loss',
  pageTitle: 'Finance — Profit & Loss',
  steps: [
    reportTabStep('fin-subtab-profit-loss', 'Profit & Loss', 'Income less expenses for the period, in the statutory Schedule III format.'),
    ...rangeSteps(),
    {
      target: 'fin-rep-pl-stats',
      title: 'Headline figures',
      purpose: 'Total income, total expenses, gross profit (trading view) and profit / loss for the period (green = profit, red = loss).',
      why: 'Gross profit = sales − direct costs (purchases, direct expenses, stock change). It shows whether pricing covers material and production cost before overheads.',
    },
    {
      target: 'fin-rep-pl-table',
      title: 'Statement of Profit and Loss',
      purpose: 'I Revenue from operations, II Other income, III Total income, IV Expenses by head, V Profit before tax, VI Tax, VII Profit for the period. Click a head (▶) to list the ledgers inside it.',
      after: 'Cost of materials = opening stock + purchases − closing stock, so post the month\'s closing-stock valuation (Inventory) before reading month-end profit.',
    },
    PRINT_STEP,
  ],
}

export default config
