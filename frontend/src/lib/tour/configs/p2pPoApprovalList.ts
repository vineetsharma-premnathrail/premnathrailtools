import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-po-approval-list',
  pageTitle: 'P.O Approval',
  steps: [
    {
      target: 'po-approval-bucket-pending',
      title: 'Pending',
      purpose: 'Purchase Orders you are eligible to approve — this tab only appears for holders of a PO-approval role, and it lists only POs your roles cover, never your own requisitions or POs you raised. The PO goes to a fixed set of managers based on the requisition\'s project type (existing: Production, Purchase and Project Managers plus the Director; new: R&D, Purchase and Production Managers plus the Director) — any ONE approval approves the PO.',
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
      purpose: 'Approves this PO inline, without opening the full detail page. Only shown when you hold one of this requisition\'s PO approval roles — your single approval approves the PO. You never see it on your own requisitions.',
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
