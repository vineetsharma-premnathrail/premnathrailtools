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
      options: [
        { value: 'Receipt', meaning: 'Stock coming in — e.g. initial stock, or a receipt not yet linked to a GRN.' },
        { value: 'Issue', meaning: 'Stock going out manually, outside the normal Material Issue flow.' },
        { value: 'Adjustment (increase)', meaning: 'Correction — actual count is higher than system.' },
        { value: 'Adjustment (decrease)', meaning: 'Correction — actual count is lower than system.' },
        { value: 'Damage / write-off', meaning: 'Existing good stock written off as damaged.' },
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
      title: 'Warehouse',
      required: true,
      purpose: 'Which warehouse this entry affects.',
    },
    {
      target: 'stock-quantity',
      title: 'Quantity',
      required: true,
      why: 'Must be greater than zero. For an outbound type (Issue, Adjustment decrease, Damage), it\'s rejected if it exceeds what\'s currently on hand.',
    },
    {
      target: 'stock-reference',
      title: 'Reference Number',
      purpose: 'Free-text reference back to a source document, if any — a GRN number, issue number, etc.',
    },
    {
      target: 'stock-save-btn',
      title: 'Post Entry',
      purpose: 'Writes this movement to the stock ledger and updates the item\'s on-hand balance at this warehouse immediately.',
    },
    {
      target: 'stock-balances-table',
      title: 'Current Balances',
      purpose: 'On Hand, Reserved, and Available (On Hand minus Reserved) quantity per item and warehouse.',
    },
    {
      target: 'stock-transactions-table',
      title: 'Recent Movements',
      purpose: 'The full stock ledger — every receipt, issue, return, transfer, and adjustment ever posted, most recent first (up to the latest 500).',
    },
  ],
}

export default config
