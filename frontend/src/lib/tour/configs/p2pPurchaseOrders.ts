import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-purchase-orders',
  pageTitle: 'Purchase Orders',
  steps: [
    {
      target: 'p2p-nav-clipboard',
      title: 'Purchase Orders',
      purpose: 'Everything about the PO in one place: create it, approve it, and track its delivery.',
    },
    { target: 'po-view-create', title: 'Create PO', purpose: 'Only requisitions whose RFQ is finished and whose vendors are chosen — lines awarded on the quote comparison (green "Awarded" chip), or a vendor selected on an older RFQ. Each row has a Create PO button; there is no create button at the top. The draft PO opens with prices pre-filled from the awarded quote or Item Rates: you can raise a quantity (never lower it, never add items), then make the PO in Tally and upload its Tally PO number + PDF (section 4, Tally PO — required), and use Save, Download PO and Send for approval. Once approved, the PO shows in the store goods receipt (GRN) list. Once a draft exists, find it under Tracking. Terms & conditions come from Procurement → Settings and the vendor.' },
    { target: 'po-view-before_po', title: 'Before PO', purpose: 'Goods the store already received before a PO existed. Create PO on a row makes a draft PO for that vendor and those items; the receipt then shows "PO created" in Store → Before PO.' },
    { target: 'po-view-approvals', title: 'Approvals', purpose: 'POs waiting for approval — the PO approvers in Procurement → Settings approve first, then any one Partner gives the final approval.' },
    { target: 'po-view-tracking', title: 'Tracking', purpose: 'Every PO from draft to closed — counters (overdue, due this week, with vendor), search, a Filters popup (stage, delivery, vendor, buyer, project, dates, sort), and a side detail with items, receipts, approval, document and timeline.' },
  ],
}

export default config
