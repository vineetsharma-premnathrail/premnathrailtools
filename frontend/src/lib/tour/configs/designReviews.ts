import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-reviews',
  pageTitle: 'Reviews & Approvals',
  steps: [
    {
      target: 'design-reviews-new-sub-btn',
      title: '+ New submission',
      purpose: 'Send internally approved drawings to a customer for their approval (a transmittal).',
      after: 'Opens the new submission form.',
    },
    {
      target: 'design-reviews-internal',
      title: 'Internal reviews — waiting on you',
      purpose: 'Drawings and BOMs where you are the named checker or approver, or customer-approved revisions you can release. Click a row to open it. Waiting days turn red after 3.',
      options: [
        { value: 'Check drawing / Check BOM', meaning: 'First review by a second engineer — is it correct and complete?' },
        { value: 'Approve drawing / Approve BOM', meaning: 'Final internal sign-off after the check.' },
        { value: 'Release (customer approved)', meaning: 'The customer approved it — release it as the controlled revision.' },
      ],
      why: 'Maker-checker-approver is the standard engineering control: the person who drew it never signs off their own work.',
    },
    {
      target: 'design-reviews-awaiting',
      title: 'Approved — waiting on the customer',
      purpose: 'Revisions that passed internal approval but need customer approval before release. Add them to a submission to send them.',
    },
    {
      target: 'design-subs-status-tabs',
      title: 'Submission status',
      options: [
        { value: 'Open', meaning: 'Draft or with the customer.' },
        { value: 'With customer', meaning: 'Sent; waiting for their response.' },
        { value: 'Draft', meaning: 'Being prepared, not sent yet.' },
        { value: 'Closed', meaning: 'Customer responded on every drawing.' },
        { value: 'Cancelled', meaning: 'Withdrawn.' },
        { value: 'All', meaning: 'Every submission.' },
      ],
    },
    {
      target: 'design-subs-overdue',
      title: 'Overdue only',
      purpose: 'Show only submissions past the date the customer should have replied by.',
      why: 'Customer approval is often the longest wait in a project — chasing overdue responses keeps delivery on track.',
    },
    {
      target: 'design-subs-search',
      title: 'Search',
      whatToEnter: 'Submission number or customer name.',
    },
    {
      target: 'design-subs-table',
      title: 'Customer submissions register',
      purpose: 'Click a row to open. Shows drawings sent, sent date, response due (red when overdue), days waiting, response date, turnaround and open customer comments.',
      why: '"Turnaround" is how many days the customer took to respond — useful to plan future schedules with that customer.',
    },
  ],
}

export default config
