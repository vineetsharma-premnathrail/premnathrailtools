import { TourConfig, TourStep } from '../types'

const steps: TourStep[] = [
  {
    target: 'rfq-detail-vendor-quotations',
    title: 'Supplier / Vendor Quotations',
    purpose: 'Every vendor quotation attached when this RFQ was raised, one card per vendor (L1–L4 Vendor), each with its own document link.',
  },
  {
    target: 'rfq-detail-po-vendor-name',
    title: 'L1 Vendor',
    purpose: 'The PO is always placed with the L1 vendor quoted on this RFQ — filled in automatically and not editable.',
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
    target: 'rfq-detail-po-approvers',
    title: 'PO Approvers',
    purpose: 'Who approves this PO. Existing project: a Production, Purchase and Project Manager; new project: an R&D, Purchase and Production Manager. Every Director also gets the PO.',
    required: true,
    whatToEnter: 'Search by name or email in each role\'s picker. Directors are added automatically.',
  },
  {
    target: 'rfq-detail-po-send-approval-btn',
    title: 'Send for Approval',
    purpose: 'Saves the PO approvers picked above and sends this PO to them and to every Director for approval.',
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
    purpose: 'The payment terms, delivery lead time, and late delivery clause agreed with L1 Vendor when this RFQ was raised.',
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
