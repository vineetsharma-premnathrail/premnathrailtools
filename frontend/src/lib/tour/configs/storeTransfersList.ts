import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-transfers-list',
  pageTitle: 'Stock Transfers',
  steps: [
    {
      target: 'transfers-add-btn',
      title: '+ New Transfer',
      purpose: 'Moves stock between two stores — posts a paired out/in movement immediately.',
      after: 'Takes you to a separate Create Transfer page — its own guided tour covers every field there.',
    },
    {
      target: 'transfers-table',
      title: 'Transfer rows',
      purpose: 'Click anywhere on a row to open that transfer\'s detail page. Shows "No stock transfers yet" until one is created.',
    },
  ],
}

export default config
