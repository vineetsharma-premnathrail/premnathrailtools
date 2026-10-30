import { TourConfig, TourStep } from '../types'

const steps: TourStep[] = [
  {
    target: 'rfq-detail-back',
    title: '← Back',
    purpose: 'Returns to the R.F.Q list.',
  },
  {
    target: 'rfq-detail-invites',
    title: 'Invited vendors',
    purpose: 'Emailed RFQs: every vendor the RFQ was emailed to, the quote-by date (a red "passed" chip once it is over) and how many have quoted so far.',
    why: 'Vendors reply by email; this shows at a glance who still owes a quote, so nobody is chased twice or forgotten.',
  },
  {
    target: 'rfq-detail-invites-table',
    title: 'Email and quote status',
    purpose: 'Per vendor: the email used, whether the email went (Sent with time, or Failed with the reason), the last reminder, and the quote status (Quoted with amount / Waiting / Overdue / Not sent).',
    after: '"Resend" re-reads the vendor’s email from the vendor master and sends again — fix a failed address in Procurement › Vendors first. "Record quote" opens the comparison page with that vendor picked.',
  },
  {
    target: 'rfq-detail-send-pending',
    title: 'Send pending emails',
    purpose: 'Shown when some vendors have not been emailed yet (or the email failed) — sends the RFQ to all of them in one go.',
  },
  {
    target: 'rfq-detail-remind-all',
    title: 'Remind all who haven’t quoted',
    purpose: 'Emails a reminder to every vendor who was sent the RFQ but has no quote recorded yet.',
  },
  {
    target: 'rfq-detail-invite-more',
    title: 'Invite more vendors',
    purpose: 'Pick more vendors from the vendor master; the RFQ is emailed to them as soon as you save. Vendors without an email in the master can’t be picked.',
  },
  {
    target: 'rfq-detail-record-quotes-btn',
    title: 'Record quotes & compare',
    purpose: 'The next step on an emailed RFQ: record each vendor’s reply line by line (rate, GST, delivery, validity, payment terms, freight) with their PDF attached.',
    after: 'The comparison ranks L1/L2/L3 automatically; award the lines there, make the PO in Tally and upload it on the requisition (Upload PO).',
  },
  {
    target: 'rfq-detail-vendor-quotations',
    title: 'Supplier / Vendor Quotations',
    purpose: 'Older RFQs only (raised with attached quotations): every vendor quotation attached when this RFQ was raised, one card per vendor (L1–L4 Vendor), each with its own document link.',
  },
  {
    target: 'rfq-detail-po-create-btn',
    title: 'Open requisition to upload PO',
    purpose: 'The next step once the quotations are in: make the PO in Tally, then open the requisition and press Upload PO.',
    why: 'POs are made in Tally, not in the portal. Uploading the Tally PO on the requisition builds the PO from its lines, so the store receives it (GRN) at the PO price.',
    after: 'On the requisition, Upload PO asks for the Tally PO number + PDF, the vendor (L1 by default; another needs a reason), the delivery store and each line’s price, and sends it for approval.',
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
    purpose: 'The late delivery clause — and, on older RFQs, the payment terms and delivery lead time agreed with L1 Vendor. On emailed RFQs payment terms and delivery come with each vendor’s quote.',
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
