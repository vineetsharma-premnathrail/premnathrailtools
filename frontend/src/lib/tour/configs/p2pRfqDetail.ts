import { TourConfig, TourStep } from '../types'

const steps: TourStep[] = [
  {
    target: 'rfq-detail-vendor-quotations',
    title: 'Supplier / Vendor Quotations',
    purpose: 'Every vendor quotation attached when this RFQ was raised, one card per vendor tier (Vendor 1–4), each with its own document link.',
  },
  {
    target: 'rfq-detail-po-vendor-tier',
    title: 'Vendor Tier',
    purpose: 'Picks which of the attached vendor quotations the Purchase Order is being raised against. Only shown when more than one vendor quotation was attached.',
  },
  {
    target: 'rfq-detail-po-vendor-name',
    title: 'Vendor Name',
    purpose: 'Pre-filled from the selected vendor tier\'s quotation — the vendor the PO is actually being placed with.',
  },
  {
    target: 'rfq-detail-po-number',
    title: 'PO Number',
    purpose: 'The Purchase Order number, if one has already been issued outside the system.',
    required: false,
    whatToEnter: 'Leave blank to auto-generate a PO number.',
  },
  {
    target: 'rfq-detail-po-doc-file',
    title: 'PO Document',
    purpose: 'The actual Purchase Order document, agreed and issued outside the system.',
  },
  {
    target: 'rfq-detail-po-attach-btn',
    title: 'Attach PO',
    purpose: 'Records this PO against the requisition and uploads its document — this is a simple record-keeping step, not the full vendor-selection workflow.',
    after: 'Moves this requisition into the "PO Draft" stage below.',
  },
  {
    target: 'rfq-detail-po-upload-btn',
    title: 'Upload',
    purpose: 'Attaches the PO document if it wasn\'t uploaded in the previous step.',
  },
  {
    target: 'rfq-detail-po-send-approval-btn',
    title: 'Send for Approval',
    purpose: 'Sends this PO into the Purchase Head → Director → MD approval chain.',
    why: 'Once submitted, the PO can no longer be edited from this page.',
  },
  {
    target: 'rfq-detail-po-view-approval-btn',
    title: 'View Approval Status',
    purpose: 'Once the PO has been sent for approval, opens the requisition\'s own PO Approval section to see who has signed off so far.',
  },
  {
    target: 'rfq-detail-single-quotation',
    title: 'Single Quotation',
    purpose: 'Shown only when this RFQ was raised with just one vendor quotation — the reason and comments recorded to justify that.',
  },
  {
    target: 'rfq-detail-commercial-terms',
    title: 'Commercial Terms',
    purpose: 'The payment terms, delivery lead time, and late delivery clause agreed with Vendor 1 when this RFQ was raised.',
  },
  {
    target: 'rfq-detail-meta',
    title: 'Details',
    purpose: 'Who created this RFQ, when, and when it was locked.',
  },
  {
    target: 'rfq-detail-admin-edit-btn',
    title: 'Admin Edit',
    purpose: 'Admin-only. Opens an editable panel for the commercial terms and single-quotation justification, even though this RFQ is otherwise locked.',
  },
]

const config: TourConfig = {
  id: 'p2p-rfq-detail',
  pageTitle: 'RFQ Detail',
  steps,
}

export default config
