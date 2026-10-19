import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-purchase-sales-impact',
  pageTitle: 'Finance — Inventory: Purchase / Sales Impact',
  steps: [
    {
      target: 'fin-subtab-purchase-sales-impact',
      title: 'Purchase / Sales Impact',
      purpose: 'How much of each item was bought (posted purchase invoices) and sold (posted sales invoices) in the period.',
      autoActivate: true,
    },
    {
      target: 'fin-inv-imp-from',
      title: 'From',
      purpose: 'Defaults to 1 April (start of the financial year).',
    },
    {
      target: 'fin-inv-imp-to',
      title: 'To',
      purpose: 'Defaults to today.',
    },
    {
      target: 'fin-inv-imp-show',
      title: 'Show',
      purpose: 'Reloads for the chosen dates.',
    },
    {
      target: 'fin-inv-imp-stats',
      title: 'Totals',
      purpose: 'Total taxable value of purchases and of sales in the range.',
    },
    {
      target: 'fin-inv-imp-table',
      title: 'By item',
      purpose: 'Purchase qty/value and sales qty/value per item. Invoice lines linked to a Store item are grouped by item; other lines by their description.',
    },
  ],
}

export default config
