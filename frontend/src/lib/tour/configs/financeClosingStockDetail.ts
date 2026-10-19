import { TourConfig } from '../types'
import { SOURCE_OPTIONS } from './financeStockValue'

const config: TourConfig = {
  id: 'finance-closing-stock-detail',
  pageTitle: 'Finance — Closing stock valuation',
  steps: [
    {
      target: 'fin-inv-val-header',
      title: 'Valuation',
      purpose: 'Period, status badge (Draft / Posted / Cancelled), valuation date, number of items, and the journal link once posted.',
    },
    {
      target: 'fin-inv-val-total',
      title: 'Closing stock value',
      purpose: 'Total of all lines — the amount that will be posted.',
    },
    {
      target: 'fin-inv-val-lines',
      title: 'Lines',
      purpose: 'One line per item. On a Draft, Qty and Rate are editable boxes — change a quantity to match the physical count, or a rate (it becomes "Manual"). Each change saves when you leave the box or press Enter.',
      options: SOURCE_OPTIONS,
      why: 'Physical count beats system stock: shortages found in the count must reduce closing stock, or profit is overstated.',
    },
    {
      target: 'fin-inv-val-post',
      title: 'Post closing stock',
      purpose: 'Finance Manager only, Draft only. Posts Dr Stock-in-Hand / Cr Changes in Inventories on the valuation date.',
      after: 'It reverses automatically the next day, becoming next month\'s opening stock. Lines can no longer be edited — cancel and re-create instead.',
    },
    {
      target: 'fin-inv-val-cancel',
      title: 'Cancel valuation',
      purpose: 'Finance Manager only. Asks for a reason. For a posted valuation both the entry and its next-day reversal are undone with counter-entries.',
    },
    {
      target: 'fin-inv-val-back',
      title: '← Back',
      purpose: 'Returns to the list of valuations.',
    },
  ],
}

export default config
