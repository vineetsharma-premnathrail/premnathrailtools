import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-returns-list',
  pageTitle: 'Material Returns',
  steps: [
    {
      target: 'returns-add-btn',
      title: '+ New Return',
      purpose: 'Records material coming back into a store — unused/rejected material, optionally against a prior Material Issue.',
      after: 'Takes you to a separate Create Return page — its own guided tour covers every field there.',
    },
    {
      target: 'returns-table',
      title: 'Return rows',
      purpose: 'Click anywhere on a row to open that return\'s detail page. Shows "No material returns yet" until one is created.',
    },
  ],
}

export default config
