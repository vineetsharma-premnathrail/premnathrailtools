import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-approval-list',
  pageTitle: 'P.R Approval',
  steps: [
    {
      target: 'pr-approval-bucket-pending',
      title: 'Pending',
      purpose: 'Requisitions currently submitted and awaiting your (or your team\'s) approval.',
    },
    {
      target: 'pr-approval-bucket-approved',
      title: 'Approved',
      purpose: 'Requisitions that have been approved — including everything downstream (RFQ raised, PO raised/approved, received, closed).',
    },
    {
      target: 'pr-approval-bucket-rejected',
      title: 'Rejected',
      purpose: 'Requisitions that were rejected at the approval stage.',
    },
    {
      target: 'pr-approval-bucket-all',
      title: 'All',
      purpose: 'Every requisition regardless of status, for a full overview.',
    },
    {
      target: 'p2p-list-table',
      title: 'Purchase Requisition Number / Category / Project / Required Date / Priority / Status',
      purpose: 'Requisitions in the currently selected bucket, with category, project, required date, priority, and status.',
    },
    {
      target: 'p2p-list-view',
      title: 'View',
      purpose: 'Click View — or anywhere on the row — to open the full requisition detail, where Approve/Reject actions are also available.',
    },
  ],
}

export default config
