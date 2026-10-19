import { TourConfig, TourStep } from '../types'

export const INTERNAL_ORDER_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-io-code',
    title: 'Code',
    required: true,
    whatToEnter: 'A short unique order code.',
    validExample: 'IO-CAP-2026-01',
  },
  {
    target: 'fin-io-name',
    title: 'Name',
    required: true,
    whatToEnter: 'What the job or project is.',
    validExample: 'New CNC bay civil work',
  },
  {
    target: 'fin-io-type',
    title: 'Order type',
    options: [
      { value: 'Capital', meaning: 'Building or buying an asset — costs are later capitalised.' },
      { value: 'Maintenance', meaning: 'A major repair or overhaul.' },
      { value: 'IT', meaning: 'Software / hardware project.' },
      { value: 'Training', meaning: 'A training programme.' },
    ],
  },
  {
    target: 'fin-io-start',
    title: 'Start date',
    whatToEnter: 'When the job starts (optional).',
  },
  {
    target: 'fin-io-end',
    title: 'End date',
    whatToEnter: 'Planned completion (optional).',
  },
  {
    target: 'fin-io-budget',
    title: 'Budget (₹)',
    whatToEnter: 'Approved spend for the job, in rupees.',
    validExample: '1500000',
    why: 'Actual spend booked against the order is compared with this budget to catch overruns early.',
  },
  {
    target: 'fin-io-cost-center',
    title: 'Cost center',
    purpose: 'Optional — the department responsible. An internal order tracks one job, a cost center tracks a department; they work side by side.',
  },
  {
    target: 'fin-io-status',
    title: 'Status',
    options: [
      { value: 'Open', meaning: 'Created; costs can be booked.' },
      { value: 'In Progress', meaning: 'Work under way.' },
      { value: 'Completed', meaning: 'Work finished; final costs being settled.' },
      { value: 'Closed', meaning: 'Settled — no more costs should be booked.' },
    ],
  },
  {
    target: 'fin-io-description',
    title: 'Description',
    whatToEnter: 'Scope or notes about the job (optional).',
  },
  {
    target: 'fin-masters-form-save',
    title: 'Create Internal Order / Save Changes',
    purpose: 'Saves the order. Code and name are required.',
    after: 'The order appears in the list below.',
  },
  {
    target: 'fin-masters-form-cancel',
    title: 'Cancel',
    purpose: 'Closes the form without saving.',
  },
]

const config: TourConfig = {
  id: 'finance-masters-internal-order-form',
  pageTitle: 'Finance — Internal Order form',
  steps: [
    {
      target: 'fin-subtab-internal-orders',
      title: 'Internal Orders',
      purpose: 'You are adding or editing an internal order.',
    },
    ...INTERNAL_ORDER_FORM_STEPS,
  ],
}

export default config
