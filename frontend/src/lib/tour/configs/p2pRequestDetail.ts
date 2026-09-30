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
      purpose: 'The second approval — only shown once this requisition has reached the RFQ stage (before that it may still be fulfilled entirely from store stock and never need a PO). Once a PO is raised it goes to the requisition\'s PO approval roles (based on project type — e.g. Production, Purchase and Project Managers plus the Director for an existing project), and any ONE of them approving approves it. Shows who approved, as which role, and their comment. Requisitions from before this matrix still show the old Purchase Head → Director → MD chain.',
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
      purpose: 'Every line item on this requisition — description, make, part code, unit, quantity, and any per-item attachments. For the purchase team, each still-undecided line runs its store stock check automatically and shows the result inline, with the Issue from Stock / Send to Procurement decision right there.',
    },
    {
      target: 'pr-detail-attachments',
      title: 'Attachments',
      purpose: 'Supporting and specification documents uploaded when this requisition was created.',
    },
  ],
}

export default config
