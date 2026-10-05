import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-transfer-detail',
  pageTitle: 'Stock Transfer Detail',
  steps: [
    {
      target: 'transfer-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the Stock Transfers list.',
    },
    {
      target: 'transfer-detail-summary',
      title: 'Transfer Summary',
      purpose: 'From/To store, reason, and who recorded it.',
    },
    {
      target: 'transfer-detail-items',
      title: 'Items',
      purpose: 'Every item and quantity moved. Each line already decreased the From Store and increased the To Store at the time this transfer was created.',
    },
  ],
}

export default config
