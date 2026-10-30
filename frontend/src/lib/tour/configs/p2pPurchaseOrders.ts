import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-purchase-orders',
  pageTitle: 'Purchase Orders',
  steps: [
    {
      target: 'p2p-nav-clipboard',
      title: 'Purchase Orders',
      purpose: 'Approve POs and track their delivery. POs are not created here: the PO is made in Tally and uploaded on its requisition (Upload PO).',
    },
    { target: 'po-view-before_po', title: 'Before PO', purpose: 'Goods the store already received before a PO existed. Create requisition on a row makes a requisition for that vendor and those items; upload the Tally PO on it and the receipt then shows "PO created" in Store → Before PO.' },
    { target: 'po-view-approvals', title: 'Approvals', purpose: 'POs waiting for approval — the PO approvers in Procurement → Settings approve first, then any one Partner gives the final approval.' },
    { target: 'po-view-tracking', title: 'Tracking', purpose: 'Every PO from draft to closed — counters (overdue, due this week, with vendor), search, a Filters popup (stage, delivery, vendor, buyer, project, dates, sort), and a side detail with items, receipts, approval, document and timeline.' },
  ],
}

export default config
