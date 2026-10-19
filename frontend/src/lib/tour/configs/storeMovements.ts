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
        { value: 'All', meaning: 'Every posting of every kind — receipts, issues, returns, transfers, adjustments, quarantine.' },
        { value: 'Receipts', meaning: 'Stock received — GRNs and receipt entries.' },
        { value: 'Issues', meaning: 'Material issued out of the store to a department, job or work order.' },
      ],
    },
    {
      target: 'movements-search',
      title: 'Search',
      purpose: 'Finds movements by item code/name, store, vendor, invoice or document number, or batch number.',
      validExample: 'Search "HT-23-4471" to see every movement of that heat/batch, or "GRN-" to see only GRN postings.',
    },
    {
      target: 'movements-store-filter',
      title: 'Store filter',
      purpose: 'Shows only postings at one store. "All stores" shows every store.',
    },
    {
      target: 'movements-category-filter',
      title: 'Category filter',
      purpose: 'Shows only items of one category (e.g. Raw Material, Consumables).',
    },
    {
      target: 'movements-date-from',
      title: 'From date',
      purpose: 'Hides postings dated before this day. Leave empty for no lower limit.',
    },
    {
      target: 'movements-date-to',
      title: 'To date',
      purpose: 'Hides postings dated after this day. Use From + To together to see one month, e.g. 01-04 to 30-04.',
      after: 'A "Clear" button appears once any filter is set — it resets all filters at once.',
    },
    {
      target: 'movements-table',
      title: 'Stock Ledger',
      purpose: 'Every receipt, issue, return, transfer, adjustment and quarantine posting, most recent first (up to the latest 500). Quantity shows + (green) for stock in and − (red) for stock out. Invoice / Document shows the supplier invoice for manual entries; system postings carry a tag for the document behind them.',
      options: [
        { value: 'Receipt / Stock in', meaning: 'Stock added — from a GRN or a manual stock entry.' },
        { value: 'Issue / Stock out', meaning: 'Stock taken out for use.' },
        { value: 'Return (in) / (out)', meaning: 'Material coming back into the store, or sent back out (e.g. to the supplier).' },
        { value: 'Transfer In / Out', meaning: 'The two halves of a move between stores — one store goes down, the other goes up.' },
        { value: 'Adjustment (+) / (−)', meaning: 'Approved correction after a physical count.' },
        { value: 'Quarantine (in) / (out)', meaning: 'Damaged or rejected quantity parked in / cleared from the store\'s Quarantine — not usable stock.' },
        { value: 'Damage', meaning: 'Stock written off as damaged.' },
      ],
      why: 'The ledger is append-only: stock is never edited directly, every change is a dated posting with a document behind it. That is what lets an auditor (or you) explain any balance.',
    },
  ],
}

export default config
