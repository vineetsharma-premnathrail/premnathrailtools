import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-adjustments-list',
  pageTitle: 'Stock Adjustments',
  steps: [
    {
      target: 'adjustments-add-btn',
      title: '+ New Adjustment',
      purpose: 'Corrects system stock after a physical count — captures the existing (system) quantity, the actual (counted) quantity, and posts the difference.',
      after: 'Takes you to a separate Create Adjustment page — its own guided tour covers every field there.',
    },
    {
      target: 'adjustments-table',
      title: 'Adjustment rows',
      purpose: 'Click anywhere on a row to open that adjustment\'s detail page. Shows "No stock adjustments yet" until one is created.',
    },
  ],
}

export default config
