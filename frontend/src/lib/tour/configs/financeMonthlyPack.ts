import { TourConfig } from '../types'
import { PRINT_STEP, reportTabStep } from './financeReportSteps'

const config: TourConfig = {
  id: 'finance-monthly-pack',
  pageTitle: 'Finance — Monthly Pack',
  steps: [
    reportTabStep(
      'fin-subtab-monthly-pack',
      'Monthly Pack',
      'A one-page summary to review at month-end close.',
      'Partners can check the month in one glance — books balanced, profit, position and who owes what — before the period is locked.',
    ),
    {
      target: 'fin-rep-pack-month',
      title: 'Month',
      required: true,
      purpose: 'The month to summarise. The pack reloads when you change it.',
    },
    {
      target: 'fin-rep-pack-cards',
      title: 'Summary cards',
      options: [
        { value: 'Trial balance', meaning: 'Debit / credit and closing totals with a Balanced pill.' },
        { value: 'Profit & loss', meaning: 'Income, expenses, gross profit, profit before tax and profit for the period.' },
        { value: 'Balance sheet', meaning: 'Total assets vs total equity & liabilities as at month end, with any P&L surplus not yet closed.' },
        { value: 'Receivables / payables aging', meaning: 'Outstanding, overdue and over-90-days for customers and vendors.' },
      ],
    },
    PRINT_STEP,
  ],
}

export default config
