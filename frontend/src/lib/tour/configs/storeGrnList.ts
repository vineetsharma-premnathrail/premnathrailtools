import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-grn-list',
  pageTitle: 'Goods Receipt (GRN) & Inspection',
  steps: [
    {
      target: 'store-sub-grn',
      title: 'Inward › GRN & Inspection',
      purpose: 'Where material arriving from suppliers is booked into the store. A GRN (Goods Receipt Note) is the store\'s written proof that goods physically arrived against a Purchase Order.',
      why: 'Standard ERP flow is PO → GRN → Inspection → Stock → Vendor Invoice. Accounts matches the vendor bill against the GRN quantity (3-way match), so the GRN must record only what really came in.',
    },
    {
      target: 'store-grn-new-btn',
      title: '+ New Goods Receipt',
      purpose: 'Starts a new GRN against an approved Purchase Order. Only visible to the Purchase team — receiving against a PO is their action (the system enforces this too).',
      after: 'Opens the Record Goods Receipt page, which has its own guided tour for every field.',
    },
    {
      target: 'store-grn-buckets',
      title: 'Queues',
      purpose: 'Filters the list by where each receipt stands. The number in brackets is how many are in that queue.',
      options: [
        { value: 'Upcoming', meaning: 'Approved Purchase Orders whose goods have not (fully) arrived yet — no GRN exists for the pending quantity. Purchase team only. Click "Receive →" on a row to start its GRN with the PO already picked.' },
        { value: 'Pending Inspection', meaning: 'GRN saved (goods counted in) but quality has not yet accepted/rejected them. Stock is not usable until inspection completes.' },
        { value: 'Completed', meaning: 'Inspection is done — accepted quantity is added to store stock, rejected quantity is recorded against the vendor.' },
        { value: 'All', meaning: 'Every goods receipt regardless of status.' },
      ],
      why: 'Splitting "received" from "inspected" stops untested material being issued to the shop floor.',
    },
    {
      target: 'store-grn-table',
      title: 'Receipts list',
      purpose: 'In Upcoming: one row per Purchase Order with the quantity still pending from the vendor per item, its expected delivery date and a "Receive →" link. In the other queues: one row per GRN — click any row (or "View") to open it.',
      options: [
        { value: 'Awaiting Delivery (blue)', meaning: 'PO issued/acknowledged by the vendor, nothing received yet.' },
        { value: 'Partially Received (amber)', meaning: 'Some quantity came in, the rest is still due from the vendor.' },
        { value: 'Pending Inspection (amber)', meaning: 'GRN saved, waiting for the quality check.' },
        { value: 'Completed (green)', meaning: 'Inspection finished and stock updated.' },
      ],
    },
  ],
}

export default config
