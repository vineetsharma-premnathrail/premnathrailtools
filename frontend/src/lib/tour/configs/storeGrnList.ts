import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-grn-list',
  pageTitle: 'Goods Receipt (GRN) & Quality check',
  steps: [
    {
      target: 'store-sub-grn',
      title: 'Inward › GRN & Quality check',
      purpose: 'Where material arriving from suppliers is booked into the store. A GRN (Goods Receipt Note) is the store\'s written proof that goods physically arrived against a Purchase Order.',
      why: 'Standard ERP flow is PO → GRN → Quality check (only for flagged items) → Stock → Vendor Invoice. Accounts matches the vendor bill against the GRN quantity (3-way match), so the GRN must record only what really came in.',
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
        { value: 'Pending quality check', meaning: 'GRN saved, but some line still waits — an item flagged "Quality check on receipt" sits with Quality under an inspection lot, or an asset line needs its accepted/rejected decision. Items without the flag are already in Free stock.' },
        { value: 'Completed', meaning: 'Every line is decided — accepted quantity is in store stock, rejected quantity is recorded against the vendor. A GRN with only unflagged items completes the moment it is saved.' },
        { value: 'All', meaning: 'Every goods receipt regardless of status.' },
      ],
      why: 'Splitting "received" from "inspected" stops untested material being issued to the shop floor.',
    },
    {
      target: 'store-grn-table',
      title: 'Receipts list',
      purpose: 'In Upcoming: one row per Purchase Order with the quantity still pending from the vendor per item, its expected delivery date and a "Receive →" link. In the other queues: one row per GRN — click a row to open it.',
      options: [
        { value: 'Awaiting Delivery (blue)', meaning: 'PO issued/acknowledged by the vendor, nothing received yet.' },
        { value: 'Partially Received (amber)', meaning: 'Some quantity came in, the rest is still due from the vendor.' },
        { value: 'Pending quality check (amber)', meaning: 'GRN saved, some line still waits for a quality check or decision.' },
        { value: 'Completed (green)', meaning: 'Quality check finished and stock updated.' },
      ],
    },
  ],
}

export default config
