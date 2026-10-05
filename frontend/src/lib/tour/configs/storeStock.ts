import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-stock',
  pageTitle: 'Stock',
  steps: [
    {
      target: 'stock-add-btn',
      title: '+ Record Stock Entry',
      purpose: 'Manually posts a stock movement — for corrections and initial receipts. Normal issues, returns, and transfers should be recorded through their own tabs instead, which post to this same ledger automatically.',
    },
    {
      target: 'stock-txn-type',
      title: 'Entry Type',
      purpose: 'Maintained under Store → Settings → Stock Entry Types. Each type is fixed as stock in or stock out when it is created.',
      options: [
        { value: 'Receipt', meaning: 'Stock in — e.g. initial stock, or a receipt not yet linked to a GRN.' },
        { value: 'Issue', meaning: 'Stock out manually, outside the normal Material Issue flow.' },
        { value: 'Damage / write-off', meaning: 'Stock out — existing good stock written off as damaged.' },
      ],
    },
    {
      target: 'stock-item',
      title: 'Item',
      required: true,
      purpose: 'Which Item Master record this entry affects.',
    },
    {
      target: 'stock-location',
      title: 'Store',
      required: true,
      purpose: 'Which store this entry affects.',
    },
    {
      target: 'stock-quantity',
      title: 'Quantity',
      required: true,
      why: 'Must be greater than zero. For an outbound type (Issue, Adjustment decrease, Damage), it\'s rejected if it exceeds what\'s currently on hand.',
    },
    {
      target: 'stock-reference',
      title: 'Invoice Number',
      purpose: 'The supplier invoice (or delivery challan) number this stock came in on, so the entry can be matched to the bill later.',
    },
    {
      target: 'stock-save-btn',
      title: 'Post Entry',
      purpose: 'Writes this movement to the stock ledger and updates the item\'s on-hand balance at this store immediately.',
    },
    {
      target: 'stock-balances-table',
      title: 'Current Balances',
      purpose: 'On Hand, Reserved, and Available (On Hand minus Reserved) quantity per item and store. Quarantine is damaged/rejected returned material held apart — use Clear to record it as scrapped, returned to vendor, or released to usable stock.',
    },
  ],
}

export default config
