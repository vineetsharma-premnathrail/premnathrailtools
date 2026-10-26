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
    { target: 'po-create-btn', title: '+ Create PO', purpose: 'Starts a PO from a finished RFQ. It sits at the left of the toolbar on the Create PO, Tracking and Open Items lists. Each of these lists has counters under the title, a search box, and a Filters button that opens a popup with Apply Filters.' },
    { target: 'po-view-create', title: 'Create PO', purpose: 'Requisitions whose RFQ is done. Emailed RFQs appear once lines are awarded on the quote comparison (green "Awarded" chip) — Create PO makes one draft PO per awarded vendor. Older RFQs: click Create PO and the PO goes to the lowest-price vendor, prices are pre-filled from that vendor\'s catalog where it lists the item, then you add tax, delivery and the PO document and click Save PO — saving sends it for approval. Terms & conditions come from Procurement → Settings and the vendor.' },
    { target: 'po-view-approvals', title: 'Approvals', purpose: 'POs waiting for approval — the PO approvers in Procurement → Settings approve first, then any one Partner gives the final approval.' },
    { target: 'po-view-tracking', title: 'Tracking', purpose: 'Every PO from draft to closed — counters (overdue, due this week, with vendor), search, a Filters popup (stage, delivery, vendor, buyer, order project, dates, sort), and a side detail with items, receipts, approval, document and timeline.' },
  ],
}

export default config
