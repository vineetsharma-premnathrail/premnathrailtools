import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-request-detail',
  pageTitle: 'Purchase Requisition Detail',
  steps: [
    {
      target: 'pr-detail-request-info',
      title: 'Request Details',
      purpose: 'Department, requester, request/required dates, requirement type, priority, assigned buyer, and remarks — everything entered when this requisition was raised.',
    },
    {
      target: 'pr-detail-po-info',
      title: 'Purchase Order',
      purpose: 'Shown once a Purchase Order has been raised against this requisition — its PO number, vendor, and the PO document itself.',
    },
    {
      target: 'pr-detail-vendor-quotations',
      title: 'Vendor Quotations',
      purpose: 'The vendor quotation attachments collected on this requisition\'s RFQ, one per vendor tier (L1–L4).',
    },
    {
      target: 'pr-detail-po-approval',
      title: 'PO Approval',
      purpose: 'The second approval chain: once a PO is raised it goes Purchase Head → Director → MD. Each stage names the person who acted, their Approved/Pending/Rejected status, and any comment they left — until a PO exists, all three read "PO not raised yet".',
    },
    {
      target: 'pr-detail-approval',
      title: 'Approval',
      purpose: 'The Department Head, Project Head, and Plant Head assigned to approve this requisition, and whether each has signed off yet. If the requisition was rejected or cancelled, that shows here too — on the rejecter\'s own row, with their reason.',
    },
    {
      target: 'pr-detail-approve',
      title: 'Approve',
      purpose: 'Approves this requisition on your behalf. Only shown when you are looking at it from the P.R Approval list and are one of its pending approvers (or an admin).',
    },
    {
      target: 'pr-detail-approve-po',
      title: 'Approve PO',
      purpose: 'Approves the Purchase Order raised against this requisition. Only shown from the P.O Approval list when you are a pending PO approver.',
    },
    {
      target: 'pr-detail-reject',
      title: 'Reject',
      purpose: 'Rejects this requisition (or its PO) with an optional reason — visible on the requisition afterward.',
      why: 'Rejecting cannot be undone from here; the requester would need to raise a fresh requisition.',
    },
    {
      target: 'pr-detail-items',
      title: 'Item Details',
      purpose: 'Every line item on this requisition — description, make, part code, unit, quantity, and any per-item attachments.',
    },
    {
      target: 'pr-detail-attachments',
      title: 'Attachments',
      purpose: 'Supporting and specification documents uploaded when this requisition was created.',
    },
  ],
}

export default config
