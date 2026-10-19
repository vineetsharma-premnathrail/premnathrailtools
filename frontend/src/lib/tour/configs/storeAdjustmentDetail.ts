import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-adjustment-detail',
  pageTitle: 'Stock Adjustment Detail',
  steps: [
    {
      target: 'adjustment-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the Stock Adjustments list.',
    },
    {
      target: 'adjustment-detail-approval',
      title: 'Approval',
      purpose: 'Shown while the adjustment is Pending Approval. Stock has NOT changed yet — only the named approver can decide.',
      options: [
        { value: 'Pending Approval (amber)', meaning: 'Recorded, waiting for the approver. Stock unchanged.' },
        { value: 'Approved (green)', meaning: 'Approved and each line\'s difference posted to stock.' },
        { value: 'Rejected (red)', meaning: 'Refused — stock never changed. Recount and raise a new adjustment if needed.' },
      ],
      why: 'Segregation of duties: the person who counts and records an adjustment can never approve it themselves, so stock cannot be quietly written off by one person.',
    },
    {
      target: 'adjustment-detail-reject-btn',
      title: 'Reject',
      purpose: 'Approver only. Refuses the adjustment — you will be asked for a reason, which the creator sees.',
      after: 'Status becomes Rejected and stock stays as it was.',
    },
    {
      target: 'adjustment-detail-approve-btn',
      title: 'Approve & Post',
      purpose: 'Approver only. Asks you to confirm, then posts each line\'s difference to stock.',
      after: 'Status becomes Approved, balances on the Stock page update, and the postings appear in Movements tagged with this adjustment number.',
    },
    {
      target: 'adjustment-detail-summary',
      title: 'Adjustment Summary',
      purpose: 'Store, date, who approved it, and who recorded it.',
    },
    {
      target: 'adjustment-detail-items',
      title: 'Items',
      purpose: 'Each item\'s Existing (system) quantity, Actual (counted) quantity, and the Difference that was posted to stock — green for an increase, red for a decrease.',
    },
  ],
}

export default config
