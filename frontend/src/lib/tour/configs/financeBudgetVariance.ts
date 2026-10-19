import { TourConfig } from '../types'
import { PRINT_STEP, rangeSteps, reportTabStep } from './financeReportSteps'

const config: TourConfig = {
  id: 'finance-budget-variance',
  pageTitle: 'Finance — Budget Variance',
  steps: [
    reportTabStep(
      'fin-subtab-budget-variance',
      'Budget Variance',
      'Budget vs actual spend for cost centres and internal orders.',
      'Variance analysis tells managers early where spending is running ahead of plan, while there is still time to act.',
    ),
    ...rangeSteps(),
    {
      target: 'fin-rep-variance-table',
      title: 'Variance',
      purpose: 'Type, code, name, budget, actual, variance (actual − budget) and variance %.',
      options: [
        { value: 'Cost centre', meaning: 'Annual budget pro-rated to the months in the range (3 months = 3/12 of it).' },
        { value: 'Internal order', meaning: 'Budget covers the order\'s whole life, so it is compared as is.' },
        { value: 'Red variance', meaning: 'Spent more than budgeted.' },
        { value: 'Green variance', meaning: 'Within budget.' },
      ],
      after: 'Budgets are set on Cost Centres (Organization) and Internal Orders (Finance → Masters).',
    },
    PRINT_STEP,
  ],
}

export default config
