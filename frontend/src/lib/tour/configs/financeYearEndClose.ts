import { TourConfig } from '../types'
import { reportTabStep } from './financeReportSteps'

const config: TourConfig = {
  id: 'finance-year-end-close',
  pageTitle: 'Finance — Year-end Close',
  steps: [
    reportTabStep(
      'fin-subtab-year-end-close',
      'Year-end Close',
      'Closes a financial year: one voucher on 31 March zeroes every income and expense ledger into Retained Earnings and marks the year closed.',
      'Closing stops anyone back-dating entries into a year whose accounts are final (audited / filed). Before closing: post or cancel pending documents, post closing stock, run depreciation to March and post the March GST set-off.',
    ),
    {
      target: 'fin-rep-ye-fy',
      title: 'Financial year',
      required: true,
      purpose: 'The year to close or review. Closed / locked years show their status in brackets.',
    },
    {
      target: 'fin-rep-ye-panel',
      title: 'Year-end summary',
      purpose: 'Closing date, status badge, net profit (or loss) for the year and the closing voucher number ("Not closed" until done).',
      options: [
        { value: 'open', meaning: 'Postings allowed.' },
        { value: 'closed', meaning: 'Closing voucher posted — no postings can be dated in this year.' },
        { value: 'locked', meaning: 'Locked up to a lock date (shown beside the year).' },
      ],
    },
    {
      target: 'fin-rep-ye-close-btn',
      title: 'Close financial year',
      purpose: 'Finance Manager or admin. Asks for confirmation.',
      after: 'Posts the closing voucher, moves the year\'s profit/loss to Retained Earnings and marks the year closed. The year\'s P&L remains readable afterwards.',
    },
    {
      target: 'fin-rep-ye-reopen-btn',
      title: 'Reopen year',
      purpose: 'Admin only, on a closed year. Asks for a reason (audit log).',
      after: 'The closing voucher is reversed (never deleted) and postings into the year are allowed again — close it again once corrections are done.',
    },
  ],
}

export default config
