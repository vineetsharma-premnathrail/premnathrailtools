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
    { target: 'po-view-create', title: 'Create PO', purpose: 'Only requisitions whose RFQ is finished and whose vendors are chosen — lines awarded on the quote comparison (green "Awarded" chip), or a vendor selected on an older RFQ. Each row has a Create PO button; there is no create button at the top. The draft PO opens with prices pre-filled from the awarded quote or Item Rates: you can raise a quantity (never lower it, never add items), then use Save, Download PO and Send for approval. Once a draft exists, find it under Tracking. Terms & conditions come from Procurement → Settings and the vendor.' },
    { target: 'po-tally-upload', title: 'Upload Tally POs', purpose: 'POs already approved in Tally: download the Excel template, fill one row per PO line (vendor code or GSTIN, Item Master code or the item\'s Tally code), press Check file, fix anything shown in red, then Upload. Each PO gets a portal PO number, keeps its Tally number, skips portal approval and is ready for goods receipt at once (see Tracking). You can attach each Tally PO\'s PDF after uploading. Shown only to people with the "Upload Tally POs" permission.' },
    { target: 'po-view-before_po', title: 'Before PO', purpose: 'Goods the store already received before a PO existed. Create PO on a row makes a draft PO for that vendor and those items; the receipt then shows "PO created" in Store → Before PO.' },
    { target: 'po-view-approvals', title: 'Approvals', purpose: 'POs waiting for approval — the PO approvers in Procurement → Settings approve first, then any one Partner gives the final approval.' },
    { target: 'po-view-tracking', title: 'Tracking', purpose: 'Every PO from draft to closed — counters (overdue, due this week, with vendor), search, a Filters popup (stage, delivery, vendor, buyer, project, dates, sort), and a side detail with items, receipts, approval, document and timeline.' },
  ],
}

export default config
