import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-liquidity-forecast',
  pageTitle: 'Finance — Liquidity Forecast',
  steps: [
    {
      target: 'fin-subtab-liquidity-forecast',
      title: 'Liquidity Forecast',
      purpose: 'A read-only projection of cash: today\'s bank + cash, plus money due in from customers, minus money due out to vendors, by due date.',
      autoActivate: true,
      why: 'Lets you see a cash shortfall weeks ahead and plan vendor payments or chase collections in time.',
    },
    {
      target: 'fin-bk-forecast-cash',
      title: 'Current Cash & Bank',
      purpose: 'The starting point — total book balance of all active bank and cash accounts today.',
    },
    {
      target: 'fin-bk-forecast-table',
      title: 'Forecast by period',
      purpose: 'Inflows (open sales invoices) and outflows (open purchase bills) grouped by when they fall due, with the projected balance after each period. A negative projected balance shows in red.',
      options: [
        { value: 'Overdue', meaning: 'Already past due — should have been collected / paid.' },
        { value: '0–30 Days', meaning: 'Due within the next month.' },
        { value: '31–60 Days', meaning: 'Due in the second month.' },
        { value: '61+ Days', meaning: 'Due later.' },
      ],
    },
  ],
}

export default config
