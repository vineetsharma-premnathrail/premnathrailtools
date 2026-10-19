import { TourConfig } from '../types'
import { INTERNAL_ORDER_FORM_STEPS } from './financeMastersInternalOrderForm'

const config: TourConfig = {
  id: 'finance-masters-internal-orders',
  pageTitle: 'Finance — Internal Orders',
  steps: [
    {
      target: 'fin-subtab-internal-orders',
      title: 'Internal Orders',
      purpose: 'An internal order collects the cost of one job or project (a capital build, a major repair) across many vouchers, so actual spend can be compared with its budget.',
      autoActivate: true,
    },
    {
      target: 'fin-io-table',
      title: 'Order list',
      purpose: 'Code, name, type, cost center, period, budget and status of every internal order.',
      options: [
        { value: 'Open', meaning: 'Created; costs can be booked.' },
        { value: 'In Progress', meaning: 'Work under way.' },
        { value: 'Completed', meaning: 'Work finished.' },
        { value: 'Closed', meaning: 'Settled — no more costs.' },
        { value: 'Edit / Delete', meaning: 'Change or remove an order.' },
      ],
    },
    {
      target: 'fin-io-new-btn',
      title: '+ New Internal Order',
      purpose: 'Opens a new cost collector for a job.',
      after: 'Opens the form right here — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...INTERNAL_ORDER_FORM_STEPS,
  ],
}

export default config
