import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-before-po',
  pageTitle: 'Before PO',
  steps: [
    {
      target: 'store-sub-before-po',
      title: 'Inward › Before PO',
      purpose: 'Where the store records material that arrived before its purchase order was made. Procurement then sees it, makes a requisition for the same vendor and items and uploads the Tally PO on it.',
      why: 'The goods are real and in the store, so they are in stock the moment the receipt is saved and can be issued. The GRN against the approved PO later settles the receipt without adding the stock again.',
    },
    {
      target: 'store-bpo-banner',
      title: 'In stock as soon as saved',
      purpose: 'Goods go into stock as soon as a receipt is saved — Free stock, or Quality stock for items that need a quality check. The GRN against Procurement\'s PO later settles the receipt; stock is not added a second time.',
    },
    {
      target: 'store-bpo-new-btn',
      title: '+ Before PO receipt',
      purpose: 'Opens the form: vendor from the vendor master, received date, the store the goods went into (your own store is set for you), whether the goods came with a Tax Invoice (number, date, file) or a Delivery Challan (number, date, file), and the items with quantities and an optional rate — each line searches the Item Master item by code, name or technical details.',
      after: 'The goods are in stock. The receipt shows as "PO pending" with an "In stock" tag and appears in Procurement › Purchase Orders › Before PO.',
    },
    {
      target: 'store-bpo-stats',
      title: 'PO pending / PO created / Closed',
      purpose: 'PO pending: waiting for Procurement. PO created: a PO exists for it. Closed: the GRN for the full quantity is done. Click a number to show only those rows; click it again to show all.',
    },
    {
      target: 'store-bpo-table',
      title: 'Receipts',
      purpose: 'Sorted by receipt number. Click a row to see its items — rate, where the stock went (Free stock or the Quality lot) and how much a GRN has settled — the linked PR and PO numbers, and to cancel it (with a reason) while the PO is still pending. Cancelling takes the stock back out, and is refused if any of it was already issued.',
    },
  ],
}

export default config
