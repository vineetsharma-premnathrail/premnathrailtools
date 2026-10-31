import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-before-po',
  pageTitle: 'Before PO',
  steps: [
    {
      target: 'store-sub-before-po',
      title: 'Inward › Before PO',
      purpose: 'Where the store records material that arrived before its purchase order was made. Procurement then sees it, makes a requisition for the same vendor and items and uploads the Tally PO on it.',
      why: 'The goods are real and must be on record, but they enter stock only through the GRN against an approved PO, so value and the invoice match stay correct.',
    },
    {
      target: 'store-bpo-banner',
      title: 'Held, not in stock',
      purpose: 'Goods recorded here are held in store and are NOT in stock yet. Stock is added by the GRN once Procurement\'s PO is approved.',
    },
    {
      target: 'store-bpo-new-btn',
      title: '+ Before PO receipt',
      purpose: 'Opens the form: vendor from the vendor master, received date, your own store (set for you), challan and invoice numbers, and the items with quantities — each line picks the type, then the category, then the Item Master item.',
      after: 'The receipt shows as "PO pending" and appears in Procurement › Purchase Orders › Before PO.',
    },
    {
      target: 'store-bpo-stats',
      title: 'PO pending / PO created / Closed',
      purpose: 'PO pending: waiting for Procurement. PO created: a PO exists for it. Closed: the GRN for the full quantity is done. Click a number to show only those rows; click it again to show all.',
    },
    {
      target: 'store-bpo-table',
      title: 'Receipts',
      purpose: 'Sorted by receipt number. Click a row to see its items, the linked PR and PO numbers, and to cancel it (with a reason) while the PO is still pending.',
    },
  ],
}

export default config
