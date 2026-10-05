import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-movements',
  pageTitle: 'Stock Movements',
  steps: [
    {
      target: 'movements-tabs',
      title: 'Movement Type',
      purpose: 'Narrows the ledger to one kind of posting. The number on each tab is how many movements match the current filters.',
      options: [
        { value: 'Receipts', meaning: 'Stock received — GRNs and receipt entries.' },
        { value: 'Issues', meaning: 'Material issued out of the store.' },
      ],
    },
    {
      target: 'movements-filters',
      title: 'Filters',
      purpose: 'Search by item, store, vendor, invoice or document number, or batch; narrow by store, category and date range.',
    },
    {
      target: 'movements-table',
      title: 'Stock Ledger',
      purpose: 'Every receipt, issue, return, transfer, and adjustment posted, most recent first (up to the latest 500). Quantity shows + for stock in and − for stock out. Invoice / Document shows the supplier invoice for manual entries; system postings are tagged with what they point to — PR, GRN, Issue, Return, Adjustment, Transfer or Work Order.',
    },
  ],
}

export default config
