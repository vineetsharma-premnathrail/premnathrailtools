import { TourConfig } from '../types'
import { PRINT_STEP, reportTabStep } from './financeReportSteps'

const config: TourConfig = {
  id: 'finance-aging-report',
  pageTitle: 'Finance — Aging report',
  steps: [
    reportTabStep('fin-subtab-aging', 'Aging', 'Unpaid posted invoices as of today, placed in buckets by days past their due date.'),
    {
      target: 'fin-subtab-receivables-ar',
      title: 'Receivables (AR)',
      purpose: 'What customers owe us.',
    },
    {
      target: 'fin-subtab-payables-ap',
      title: 'Payables (AP)',
      purpose: 'What we owe vendors.',
    },
    {
      target: 'fin-rep-aging-outstanding-link',
      title: 'Open outstanding & party statements',
      purpose: 'Jumps to Finance → Outstanding for a party\'s open bills and full statement.',
    },
    {
      target: 'fin-rep-aging-table',
      title: 'Party-wise aging',
      purpose: 'Per party: number of bills, amount in each bucket, outstanding, advances and net. Totals in the last row.',
      options: [
        { value: 'Not due', meaning: 'Within the credit period.' },
        { value: '1–30 / 31–60', meaning: 'Overdue — follow up.' },
        { value: '61–90 / > 90', meaning: 'Seriously overdue — escalate; >90 days is a bad-debt risk.' },
      ],
      why: 'Advances (unallocated payments and notes) show separately — allocate them against bills in Payments so the outstanding is net.',
    },
    {
      target: 'fin-rep-aging-bills',
      title: 'Bill-wise detail',
      purpose: 'Every open bill, oldest due first, with days overdue, amount due and bucket badge.',
    },
    PRINT_STEP,
  ],
}

export default config
