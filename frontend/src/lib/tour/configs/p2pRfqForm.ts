import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-rfq-form',
  pageTitle: 'Raise RFQ',
  steps: [
    {
      target: 'rfq-new-pr',
      title: 'Purchase Requisition',
      purpose: 'The approved Purchase Requisition this RFQ is being raised for.',
      required: true,
      whatToEnter: 'Search by PR number or category. Only approved requisitions without an existing RFQ are listed.',
    },
    {
      target: 'rfq-vendor-name',
      title: 'Vendor Name',
      purpose: 'The vendor this quotation slot belongs to (Vendor 1 through Vendor 4).',
      required: false,
      why: 'Required as soon as a quotation file is attached for that vendor slot.',
    },
    {
      target: 'rfq-vendor-contact',
      title: 'Contact Number',
      purpose: 'The vendor\'s contact phone number for this quotation.',
      required: false,
      why: 'Required for Vendor 1 — it is the only mandatory vendor slot.',
    },
    {
      target: 'rfq-vendor-file',
      title: 'Quotation',
      purpose: 'The vendor\'s quotation document for this slot.',
      required: false,
      after: 'At least the Vendor 1 quotation must be attached before this RFQ can be saved.',
    },
    {
      target: 'rfq-single-reason',
      title: 'Reason for Single Quotation',
      purpose: 'Only shown when just Vendor 1 was attached. Explains why competing quotations from other vendors weren\'t obtained.',
      required: true,
    },
    {
      target: 'rfq-single-comments',
      title: 'Comments',
      purpose: 'Additional context supporting the single-quotation justification above.',
      required: true,
    },
    {
      target: 'rfq-payment-terms',
      title: 'Payment Terms',
      purpose: 'The agreed payment terms with Vendor 1 — e.g. advance/on-delivery split.',
      required: true,
      validExample: '50% advance, 50% on delivery',
    },
    {
      target: 'rfq-delivery-lead-time',
      title: 'Delivery Lead Time',
      purpose: 'How long Vendor 1 needs to deliver after the PO is placed.',
      required: true,
      validExample: '4 weeks',
    },
    {
      target: 'rfq-late-delivery-clause',
      title: 'Late Delivery Clause',
      purpose: 'The penalty or clause agreed with Vendor 1 in case of a late delivery.',
      required: true,
    },
    {
      target: 'rfq-new-save',
      title: 'Save RFQ',
      purpose: 'Validates every required field, creates the RFQ, uploads all attached quotations, and locks it.',
      why: 'Once saved, this RFQ is locked and cannot be edited — only an admin can later make changes via Admin Edit on its detail page.',
      after: 'On success you land on this RFQ\'s own detail page.',
    },
    {
      target: 'rfq-new-cancel',
      title: 'Cancel',
      purpose: 'Discards this RFQ draft and returns to the R.F.Q list.',
    },
  ],
}

export default config
