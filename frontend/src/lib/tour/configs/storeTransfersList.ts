import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-transfers-list',
  pageTitle: 'Stock Transfers',
  steps: [
    {
      target: 'transfers-add-btn',
      title: '+ New Transfer',
      purpose: 'Moves stock from one store to another (e.g. Main Store to a plant or site store) — posts a paired out/in movement immediately.',
      why: 'Total company stock does not change, but each store\'s balance does. Recording transfers keeps every store\'s on-hand figure true, so people do not go looking for material in the wrong place.',
      after: 'Takes you to a separate Create Transfer page — its own guided tour covers every field there.',
    },
    {
      target: 'transfers-table',
      title: 'Transfer rows',
      purpose: 'One row per transfer: number, From store, To store, date and number of items. Click a row (or View) to open its detail page. Shows "No stock transfers yet" until one is created.',
    },
  ],
}

export default config
