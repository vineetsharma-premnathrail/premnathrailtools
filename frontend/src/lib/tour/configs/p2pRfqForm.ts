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
      target: 'rfq-vendors',
      title: 'Vendors to ask',
      purpose: 'Pick every vendor you want a quotation from. Each one gets the RFQ by email.',
      required: true,
      whatToEnter: 'Search active vendors from Procurement › Vendors. Each vendor needs an email in the vendor master — a vendor without one is flagged in red and blocks sending.',
      why: 'Procurement › Settings sets the minimum number of vendors to ask. Fewer than that needs a written reason.',
      after: 'Vendors reply to your mailbox. Record each reply on the RFQ\'s comparison page — it ranks L1/L2/L3 automatically.',
    },
    {
      target: 'rfq-vendor-suggestions',
      title: 'Catalog suggestions',
      purpose: 'Vendors whose catalog already lists these items — most items first, then lowest catalog price. Click one to add it to the list.',
    },
    {
      target: 'rfq-quote-by',
      title: 'Quote by',
      purpose: 'The last day vendors can send their quotation. It is printed in the RFQ email.',
      required: true,
      why: 'Defaults to today plus the quote window in Procurement › Settings. It cannot be in the past.',
    },
    {
      target: 'rfq-late-delivery-clause',
      title: 'Late Delivery Clause',
      purpose: 'The penalty for late supply. It is sent in the RFQ email so vendors quote knowing it, and printed on this RFQ\'s PO after the company terms.',
      required: true,
      validExample: '0.5% of the order value per week of delay, max 10%',
    },
    {
      target: 'rfq-invite-note',
      title: 'Note to vendors',
      purpose: 'An optional message added to the RFQ email — urgency, site, special conditions.',
      required: false,
      validExample: 'Urgent — needed at site by 5 Nov',
    },
    {
      target: 'rfq-single-reason',
      title: 'Reason for a limited quotation',
      purpose: 'Only shown when fewer vendors are picked than Procurement › Settings asks for. Explains why more vendors were not asked.',
      required: true,
    },
    {
      target: 'rfq-new-save',
      title: 'Send RFQ',
      purpose: 'Checks every required field, saves the RFQ, emails it to every picked vendor and locks it.',
      why: 'If an email fails to go out, the RFQ is still saved — the failure is shown per vendor on the RFQ page, where you can resend.',
      after: 'On success you land on this RFQ\'s own detail page.',
    },
    {
      target: 'rfq-new-cancel',
      title: 'Cancel',
      purpose: 'Discards this RFQ and returns to the R.F.Q list.',
    },
    {
      target: 'rfq-new-back',
      title: '← Back',
      purpose: 'Returns to the R.F.Q list without saving — same as Cancel.',
    },
  ],
}

export default config
