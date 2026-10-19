import { TourConfig } from '../types'

const SOURCE_OPTIONS = [
  { value: 'Moving avg', meaning: 'Weighted moving-average cost from Store receipts — the normal case.' },
  { value: 'Standard cost', meaning: 'No average yet, so the item\'s standard cost is used.' },
  { value: 'Manual', meaning: 'Rate typed in by finance on a closing-stock draft.' },
  { value: 'No cost', meaning: 'No rate at all — the item is valued at zero. Fix the item cost in Store.' },
]

export { SOURCE_OPTIONS }

const config: TourConfig = {
  id: 'finance-stock-value',
  pageTitle: 'Finance — Inventory: Stock Value',
  steps: [
    {
      target: 'finance-nav-box',
      title: 'Inventory',
      purpose: 'Stock value from Store, how purchases and sales moved it, and the month-end closing-stock entry.',
      why: 'We use the PERIODIC method: purchases go to expense during the month and stock is valued once at month end. Simpler, and accepted under AS-2.',
    },
    {
      target: 'fin-subtab-stock-value',
      title: 'Stock Value',
      purpose: 'Live value of all stock on hand in Store right now (quarantine included — it is still ours).',
      autoActivate: true,
    },
    {
      target: 'fin-subtab-purchase-sales-impact',
      title: 'Purchase / Sales Impact',
      purpose: 'Quantity and value bought and sold per item in a date range.',
    },
    {
      target: 'fin-subtab-closing-stock',
      title: 'Closing Stock',
      purpose: 'Month-end valuation that posts closing stock to the books.',
    },
    {
      target: 'fin-inv-sv-stats',
      title: 'Summary',
      purpose: 'Total stock value as of today, number of items in stock, and items without any cost (red if any).',
    },
    {
      target: 'fin-inv-sv-categories',
      title: 'By category',
      purpose: 'Number of items and value per Store category, with a total.',
    },
    {
      target: 'fin-inv-sv-items',
      title: 'Items',
      purpose: 'Every item in stock with quantity, rate, value and where the rate came from.',
      options: SOURCE_OPTIONS,
    },
  ],
}

export default config
