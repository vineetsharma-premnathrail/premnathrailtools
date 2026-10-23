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
    { target: 'po-view-create', title: 'Create PO', purpose: 'Requisitions whose RFQ is done. Emailed RFQs appear once lines are awarded on the quote comparison (green "Awarded" chip) — Create PO makes one draft PO per awarded vendor. Older RFQs: click Create PO and the PO goes to the L1 vendor, prices are pre-filled from that vendor\'s catalog where it lists the item, then you add tax, delivery and the PO document and click Save PO — saving sends it for approval. Terms & conditions come from Procurement → Settings and the vendor.' },
    { target: 'po-view-approvals', title: 'Approvals', purpose: 'POs waiting for approval — the PO approvers in Procurement → Settings approve first, then any one Partner gives the final approval.' },
    { target: 'po-view-tracking', title: 'Tracking', purpose: 'Delivery status of every raised PO, with an Overdue filter.' },
  ],
}

export default config
