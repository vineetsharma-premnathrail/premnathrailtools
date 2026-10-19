import { TourConfig, TourStep } from '../types'

const steps: TourStep[] = [
  {
    target: 'rfq-detail-back',
    title: '← Back',
    purpose: 'Returns to the R.F.Q list.',
  },
  {
    target: 'rfq-detail-vendor-quotations',
    title: 'Supplier / Vendor Quotations',
    purpose: 'Every vendor quotation attached when this RFQ was raised, one card per vendor (L1–L4 Vendor), each with its own document link.',
  },
  {
    target: 'rfq-detail-po-create-btn',
    title: 'Select Vendor & Create PO',
    purpose: 'The next step once the quotations are in: opens Purchase Orders with the vendor picker ready. L1 (lowest) is pre-selected; picking another quoted vendor needs a reason.',
    why: 'The PO is created in the application — its number is generated and its document is built on the company letterhead, so nothing is typed in or attached by hand.',
    after: 'The PO opens on the Purchase Orders page to price the lines and edit the Word document; saving it there sends it for approval. Nothing is sent for approval from the RFQ.',
  },
  {
    target: 'rfq-detail-open-po',
    title: 'Open in Purchase Orders',
    purpose: 'Opens this requisition\'s PO on the Purchase Orders page, where the PO is priced and its Word document generated — saving the PO there sends it for approval.',
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
