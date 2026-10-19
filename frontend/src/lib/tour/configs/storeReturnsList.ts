import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-returns-list',
  pageTitle: 'Material Returns',
  steps: [
    {
      target: 'returns-add-btn',
      title: '+ New Return',
      purpose: 'Records material coming back into a store — unused or rejected material from the shop floor, a site, or a customer, optionally against a prior Material Issue.',
      why: 'Without a return entry, material that comes back is invisible in the system: stock looks lower than it really is and the department is still charged for it.',
      after: 'Takes you to a separate Create Return page — its own guided tour covers every field there.',
    },
    {
      target: 'returns-table',
      title: 'Return rows',
      purpose: 'One row per return: number, store, source, date, item count and status. Click a row to open its detail page. Shows "No material returns yet" until one is created.',
      options: [
        { value: 'Pending Approval (amber)', meaning: 'Waiting for the approver group(s). Stock has not changed yet. "· your action" means you are one of the people who can decide it.' },
        { value: 'Approved (green)', meaning: 'Every approval is done — usable quantity is back in stock, damaged/rejected quantity is in the store\'s Quarantine.' },
        { value: 'Rejected (red)', meaning: 'An approver refused it — nothing was added to stock.' },
      ],
    },
  ],
}

export default config
