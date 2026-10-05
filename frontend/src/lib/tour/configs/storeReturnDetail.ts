import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-return-detail',
  pageTitle: 'Material Return Detail',
  steps: [
    {
      target: 'return-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the Material Returns list.',
    },
    {
      target: 'return-detail-summary',
      title: 'Return Summary',
      purpose: 'Store, source, department, reason, and who recorded it. The status pill shows Pending Approval, Approved or Rejected.',
    },
    {
      target: 'return-detail-approvals',
      title: 'Approvals',
      purpose: 'One row per approver group this return needs. Any one person in a group can decide it. Stock posts only when every group has approved; one rejection rejects the whole return.',
    },
    {
      target: 'return-approve-btn',
      title: 'Approve',
      purpose: 'Shown only when you can approve a pending step. If yours is the last approval, the quantities post to stock.',
    },
    {
      target: 'return-reject-btn',
      title: 'Reject',
      purpose: 'Rejects the return with a required reason. Nothing is posted to stock.',
    },
    {
      target: 'return-detail-items',
      title: 'Items',
      purpose: 'Every item, quantity, and condition on this return. Once approved, usable-condition lines go back to on-hand stock and quarantine-condition lines (e.g. Damaged, Rejected) go to the store\'s Quarantine.',
    },
  ],
}

export default config
