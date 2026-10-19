import { TourConfig } from '../types'

export const HR_CLAIM_STATUS_OPTIONS = [
  { value: 'Draft', meaning: 'Being prepared by the employee — add lines and receipts. Not yet seen by the approver.' },
  { value: 'Submitted', meaning: 'Sent for approval. Locked for editing while it is reviewed (can be withdrawn).' },
  { value: 'Approved', meaning: 'Approved by the manager / HR. Waiting for HR / accounts to pay it.' },
  { value: 'Rejected', meaning: 'Sent back with a reason. Fix the lines and resubmit.' },
  { value: 'Paid', meaning: 'Reimbursed — the payment date and reference (NEFT / UTR / cheque / ADP batch) are recorded.' },
  { value: 'Cancelled', meaning: 'Withdrawn; cannot be reopened.' },
]

const config: TourConfig = {
  id: 'hr-my-claims',
  pageTitle: 'My Expense Claims',
  steps: [
    {
      target: 'hr-me-tab-claims',
      title: 'Expense Claims tab',
      purpose: 'Get reimbursed for money you spent on company work — travel, hotel, food, local conveyance, fuel, phone.',
    },
    {
      target: 'hr-myclaims-new-btn',
      title: '+ New Claim',
      purpose: 'Starts a new claim. You give it a title, a claim date and (optionally) the approved trip it belongs to.',
      after: 'A Draft claim is created and opened, where you add each expense as a line with its receipt, then submit.',
    },
    {
      target: 'hr-myclaims-stats',
      title: 'Totals',
      purpose: 'At a glance: how many claims are still drafts or need fixing, and the money awaiting approval, approved but not yet paid, and already paid.',
    },
    {
      target: 'hr-myclaims-status-filter',
      title: 'Status filter',
      purpose: 'Shows only claims in one status.',
      options: HR_CLAIM_STATUS_OPTIONS,
    },
    {
      target: 'hr-myclaims-table',
      title: 'My claims',
      purpose: 'Each claim with its number, title (and rejection reason if any), date, linked trip, number of lines, total amount and status. Click a row to open it.',
      after: 'The row shows "Edit" while the claim is a draft or rejected, otherwise "View".',
    },
  ],
}

export default config
