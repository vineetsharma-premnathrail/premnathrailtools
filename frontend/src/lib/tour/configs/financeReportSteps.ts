import { TourStep } from '../types'

/** Shared steps for the Financial Reports page: the report tab itself and the
 *  date-range bar shown on Trial Balance, P&L, Balance Sheet, Cash Flow and
 *  Budget Variance. */
export function reportTabStep(target: string, title: string, purpose: string, why?: string): TourStep {
  return { target, title, purpose, why, autoActivate: true }
}

export function rangeSteps(asAt = false): TourStep[] {
  return [
    ...(asAt
      ? []
      : [{
        target: 'fin-rep-from',
        title: 'From',
        purpose: 'Start of the reporting period — defaults to 1 April (start of the financial year).',
      }]),
    {
      target: 'fin-rep-to',
      title: asAt ? 'As at' : 'To',
      purpose: asAt
        ? 'A balance sheet is a position on one date — only this date applies.'
        : 'End of the reporting period — defaults to today. The report reloads as soon as a date changes.',
    },
    {
      target: 'fin-rep-quick',
      title: 'Quick ranges',
      options: [
        { value: 'This month', meaning: '1st of this month to today.' },
        { value: 'Last month', meaning: 'The whole of last month.' },
        { value: 'This FY', meaning: '1 April to today.' },
        { value: 'Last FY', meaning: '1 April to 31 March of the previous year.' },
      ],
    },
  ]
}

export const PRINT_STEP: TourStep = {
  target: 'fin-rep-print',
  title: 'Print',
  purpose: 'Prints the report on screen (tabs and date bar are hidden on paper). Choose "Save as PDF" in the print dialog to keep a copy.',
}
