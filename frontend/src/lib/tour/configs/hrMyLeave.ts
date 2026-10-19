import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-my-leave',
  pageTitle: 'My Leave',
  steps: [
    {
      target: 'hr-me-tab-leave',
      title: 'My HR tabs',
      purpose: 'Your own self-service pages: Profile, Leave, Attendance, Travel, Expense Claims, My Assets and Visitors. Every employee can use these — no HR rights needed.',
    },
    {
      target: 'hr-myleave-year',
      title: 'Year',
      purpose: 'Leave balances run per calendar year. Pick a year to see that year\'s balances and requests.',
      why: 'HR allots each year\'s quota at the start of the year; unused balance may be carried forward depending on the leave type.',
    },
    {
      target: 'hr-myleave-apply-btn',
      title: '+ Apply Leave',
      purpose: 'Opens the leave application form on this page.',
      after: 'The form opens as a popup. Start the tour again while the form is open for a field-by-field guide.',
    },
    {
      target: 'hr-myleave-balances',
      title: 'Leave balances',
      purpose: 'One card per leave type. Big number = days you can still take. Below it: days used, days in pending requests, and how the balance was built (carried forward + allotted ± HR adjustments).',
      why: 'Available = opening + allotted ± adjusted − used − pending. Pending days are held back so the same balance cannot be applied for twice. Unpaid types show days taken instead.',
    },
    {
      target: 'hr-myleave-status-filter',
      title: 'Status filter',
      purpose: 'Shows only your requests in one status.',
      options: [
        { value: 'Pending', meaning: 'Waiting for your approver\'s decision. You can still cancel it.' },
        { value: 'Approved', meaning: 'Granted. Days are deducted and marked on attendance. Cancelling it returns the days to your balance.' },
        { value: 'Rejected', meaning: 'Not granted. Read the approver\'s remark; nothing was deducted.' },
        { value: 'Cancelled', meaning: 'Withdrawn. Any deducted days were returned.' },
      ],
    },
    {
      target: 'hr-myleave-table',
      title: 'My requests',
      purpose: 'Every leave you applied for in the selected year: request number, type, dates (with half-day marks), days counted, status, and who is approving / who decided with their remark.',
      after: '"Attachment" opens the document you attached. "Cancel" appears while a request can still be withdrawn; it asks for confirmation first, and your approver is told.',
    },
  ],
}

export default config
