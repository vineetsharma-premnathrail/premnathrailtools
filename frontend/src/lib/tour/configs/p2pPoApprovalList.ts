import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-po-approval-list',
  pageTitle: 'P.O Approval',
  steps: [
    {
      target: 'po-approval-bucket-pending',
      title: 'Pending',
      purpose: 'Requisitions whose Purchase Order has been raised and is awaiting approval (Purchase Head → Director → MD).',
    },
    {
      target: 'po-approval-bucket-approved',
      title: 'Approved',
      purpose: 'Requisitions whose PO has been approved — including everything downstream (partially received, received, closed).',
    },
    {
      target: 'po-approval-bucket-rejected',
      title: 'Rejected',
      purpose: 'Requisitions rejected at the PO approval stage.',
    },
    {
      target: 'po-approval-bucket-all',
      title: 'All',
      purpose: 'Every requisition that has reached PO stage, regardless of current status.',
    },
    {
      target: 'p2p-list-table',
      title: 'Purchase Requisition Number / Category / Project / Required Date / Priority / Status',
      purpose: 'Requisitions in the currently selected bucket, with category, project, required date, priority, and status.',
    },
    {
      target: 'p2p-list-view',
      title: 'View',
      purpose: 'Opens the requisition\'s full detail page, including the PO Approval section and the PO document itself.',
    },
    {
      target: 'p2p-list-approve',
      title: 'Approve',
      purpose: 'Approves this PO inline, without opening the full detail page. Only shown when you are one of the pending PO approvers (Purchase Head, Director, or MD) for a PO-raised requisition.',
    },
    {
      target: 'p2p-list-reject',
      title: 'Reject',
      purpose: 'Rejects this PO inline, with an optional reason.',
      why: 'Rejecting cannot be undone from here.',
    },
  ],
}

export default config
