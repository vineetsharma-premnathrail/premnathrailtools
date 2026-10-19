import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-grn-detail',
  pageTitle: 'Goods Receipt Detail',
  steps: [
    {
      target: 'store-grn-detail-header',
      title: 'Receipt summary',
      purpose: 'The PO, Purchase Request, vendor, received date, store and who received it. Once inspection is complete, "Inspected By" shows who did the quality check.',
    },
    {
      target: 'store-grn-detail-lines',
      title: 'Quality Inspection',
      purpose: 'One row per item received. While the GRN is "Pending Inspection", enter the result for each line here; once completed, this becomes the read-only Inspection Result.',
      whatToEnter: 'Accepted + Rejected should add up to the Received quantity. Pick a Quality Status and, if anything was rejected, type the reason.',
      options: [
        { value: 'Passed', meaning: 'Everything received is good — all of it is accepted into stock.' },
        { value: 'Partially Accepted', meaning: 'Some is good, some is not — the accepted part goes to stock, the rejected part is recorded against the vendor. Give a reason.' },
        { value: 'Failed', meaning: 'Nothing is usable — the whole quantity is rejected. Give a reason.' },
        { value: 'In Quality inspection', meaning: 'Shown (not selectable) for items flagged "inspection on receipt": Quality holds them in Quality stock under an inspection lot, and its usage decision fills in the accepted/rejected split.' },
      ],
      validExample: 'Received 50 → Accepted 48, Rejected 2, Partially Accepted, reason "2 pcs thread damaged"',
      invalidExample: 'Received 50 → Accepted 50, Rejected 5 (more than received)',
      why: 'Rejected quantity is the basis for a return/debit note to the vendor and for the vendor quality rating.',
    },
    {
      target: 'store-grn-detail-complete-btn',
      title: 'Complete Inspection',
      purpose: 'Saves the inspection result for every line still pending. Only shown while the GRN is Pending Inspection.',
      after: 'Accepted quantity is added to the chosen store\'s stock at the PO price (visible in Stock and Movements) and the GRN moves to "Completed".',
    },
    {
      target: 'store-grn-detail-return-btn',
      title: 'Return to Vendor',
      purpose: 'Sends goods from this GRN back to the vendor. Accepted goods leave stock at the PO price and the PO opens again for the replacement; rejected goods (never taken into stock) are recorded as returned. Material rejected by a Quality lot goes back through its NCR instead.',
      after: 'A Return to Vendor (RTV) number is created as the gate-pass record. If the vendor' + "'" + 's invoice is already booked, a pending debit note is raised for Finance to review and post.',
      why: 'Every unit that leaves the store needs a document — and the vendor must not be paid for goods that went back.',
    },
    {
      target: 'store-grn-detail-reverse-btn',
      title: 'Reverse GRN',
      purpose: 'Cancels this GRN as a whole when it was entered by mistake (wrong PO, quantity or store). The accepted stock is taken back out at the same PO price and the PO is open again. A reason is required and kept on the GRN.',
      why: 'Only allowed while nothing downstream depends on the receipt — not if the vendor' + "'" + 's invoice already covers it, goods were returned, or a Quality lot inspected it. Real returns of goods use Return to Vendor.',
    },
    {
      target: 'store-grn-detail-returns',
      title: 'Returns to Vendor',
      purpose: 'Every return made against this GRN: RTV number, date, reason, items and quantities, value, and whether a debit note was raised.',
    },
    {
      target: 'store-grn-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the GRN list.',
    },
  ],
}

export default config
