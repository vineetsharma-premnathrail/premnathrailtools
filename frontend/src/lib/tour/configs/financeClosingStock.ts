import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-closing-stock',
  pageTitle: 'Finance — Inventory: Closing Stock',
  steps: [
    {
      target: 'fin-subtab-closing-stock',
      title: 'Closing Stock',
      purpose: 'Month-end valuation of stock on hand, posted as closing stock.',
      autoActivate: true,
      why: 'P&L shows opening stock + purchases − closing stock = cost of materials consumed. Without a closing-stock entry, all purchases look like expense and profit is understated.',
    },
    {
      target: 'fin-inv-cs-table',
      title: 'Valuations',
      purpose: 'All closing-stock valuations with period, date, value, status and journal link. Click a row (Open / View) to see its lines.',
      options: [
        { value: 'Draft', meaning: 'Editable; nothing in the books yet.' },
        { value: 'Posted', meaning: 'Closing stock posted; reverses automatically the next day as next month\'s opening stock.' },
        { value: 'Cancelled', meaning: 'Withdrawn with a reason; any posted entries were undone.' },
      ],
    },
    {
      target: 'fin-inv-cs-new-btn',
      title: 'New valuation',
      purpose: 'Opens the popup to value one month\'s closing stock from Store.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'fin-inv-cs-period',
      title: 'Period (month)',
      required: true,
      purpose: 'The month being closed. The valuation is dated the last day of that month.',
    },
    {
      target: 'fin-inv-cs-notes',
      title: 'Notes',
      purpose: 'Optional remark, e.g. who did the physical count.',
      validExample: 'Physical count by stores team on 31-Oct',
    },
    {
      target: 'fin-inv-cs-create',
      title: 'Create draft from Store',
      purpose: 'Takes a snapshot of Store stock with weighted-average rates as a Draft valuation.',
      after: 'The popup closes and the draft opens so you can correct quantities from the physical count before posting.',
    },
  ],
}

export default config
