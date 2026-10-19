import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-outstanding',
  pageTitle: 'Finance — Outstanding',
  steps: [
    {
      target: 'finance-nav-users',
      title: 'Outstanding',
      purpose: 'Who owes us and whom we owe — party-wise, aged by due date.',
    },
    {
      target: 'fin-subtab-receivables-customers',
      title: 'Receivables (customers)',
      purpose: 'Money customers owe us from issued sales invoices.',
    },
    {
      target: 'fin-subtab-payables-vendors',
      title: 'Payables (vendors)',
      purpose: 'Money we owe vendors from posted purchase bills.',
    },
    {
      target: 'fin-os-stats',
      title: 'Totals',
      purpose: 'Total outstanding, the overdue part (red), advances paid / received, and Net = outstanding − advances.',
      why: 'Net equals the balance of the Sundry Debtors / Sundry Creditors control account — if they ever differ, something was posted to the control account without a party.',
    },
    {
      target: 'fin-os-table',
      title: 'Party-wise ageing',
      purpose: 'One row per party: open bills, outstanding, the amount in each age bucket, overdue, advances and net. Click a party to open its bills and statement below.',
      options: [
        { value: 'Not due', meaning: 'Due date not reached yet.' },
        { value: '1–30', meaning: 'Up to 30 days past due.' },
        { value: '31–60', meaning: '31 to 60 days past due.' },
        { value: '61–90', meaning: '61 to 90 days past due — follow up firmly.' },
        { value: '>90', meaning: 'More than 90 days past due — a collection risk.' },
      ],
      why: 'Ageing is by DUE date (invoice date + credit days), not invoice date — a bill is only overdue after its credit period ends.',
    },
  ],
}

export default config
