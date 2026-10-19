import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-request-detail',
  pageTitle: 'Purchase Requisition Detail',
  steps: [
    {
      target: 'pr-detail-status',
      title: 'Status',
      purpose: 'Where this requisition is right now.',
      options: [
        { value: 'Submitted', meaning: 'Waiting for its approvers (the Approval panel shows who).' },
        { value: 'Returned for changes', meaning: 'An approver sent it back (or you withdrew it) — fix it and Resubmit, or cancel it.' },
        { value: 'Partially Approved', meaning: 'Some approvers have signed, others are still pending.' },
        { value: 'Approved', meaning: 'Fully approved — store issues what is in stock, purchase buys the rest.' },
        { value: 'PO Raised / PO Approved', meaning: 'A Purchase Order exists for this requisition / has been approved.' },
        { value: 'Partially Received / Received', meaning: 'Some / all material has arrived at the store.' },
        { value: 'Closed', meaning: 'Finished.' },
        { value: 'Rejected / Cancelled', meaning: 'Stopped — see the Approval section for who and why.' },
      ],
    },
    {
      target: 'pr-detail-back',
      title: '← Back',
      purpose: 'Returns to the Purchase Requisitions list.',
    },
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
      purpose: 'Shown once this requisition reaches the RFQ stage. Once the PO is sent for approval this panel lists each stage of the "Purchase order" workflow (Organization › Approval Workflows), who approved and their comment; if you are the current approver you Approve, Return or Reject right here. Older POs show their old approval chain.',
    },
    {
      target: 'pr-detail-approval',
      title: 'Approval',
      purpose: 'Who approves this requisition, stage by stage (the "Purchase requisition" workflow), who has signed and their comments. If you are the current approver (or their delegate) you Approve, Return for changes or Reject here; the requester can withdraw it while it waits. Older requisitions show their originally assigned approvers.',
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
      purpose: 'Every line item on this requisition — description, make, part code, unit, quantity, and any per-item attachments. Each still-undecided line runs its store stock check automatically and shows the result inline. Only the Store Manager picked on this requisition (or an admin) can issue from stock: pick the store to Issue From (defaults to the Ship To store, else the one with the most stock) and a comment is required. If stock covers only part of the quantity, the button issues what is available and only the shortfall goes to procurement on this same requisition. The Purchase team sends lines with no or too little stock to procurement.',
    },
    {
      target: 'pr-detail-issue-from',
      title: 'Issue From',
      purpose: 'Store Manager only. The store location to issue this line from — each option shows how much is available there.',
      whatToEnter: 'Pick the store that physically holds the stock. Defaults to the Ship To store, else the store with the most stock.',
      why: 'Using stock already on the shelf before buying more avoids tying up money in duplicate inventory.',
    },
    {
      target: 'pr-detail-issue-qty',
      title: 'Issue Qty',
      purpose: 'How many to issue from stock now. Defaults to the most that store can give, up to the requested quantity.',
      whatToEnter: 'A number from 0 up to the smaller of requested qty and available stock.',
      validExample: 'Requested 10, available 6 → 6',
      invalidExample: 'Requested 10, available 6 → 8 (more than is in stock)',
    },
    {
      target: 'pr-detail-issue-btn',
      title: 'Issue from Stock / Issue & Buy',
      purpose: 'Issues the quantity above from the chosen store. If stock covers only part, the label reads "Issue X & Buy Y" — Y is the shortfall that goes to procurement on this same requisition.',
      after: 'You are asked for a comment (required). The stock is reduced and the line shows as issued.',
    },
    {
      target: 'pr-detail-send-procurement-btn',
      title: 'Send to Procurement',
      purpose: 'Purchase team / admin only, shown when stock does not fully cover the line. Marks this line to be bought from a vendor instead of issued from stock.',
      after: 'After you confirm, the line goes to the RFQ/PO process.',
    },
    {
      target: 'pr-detail-attachments',
      title: 'Attachments',
      purpose: 'Supporting and specification documents uploaded when this requisition was created.',
    },
  ],
}

export default config
