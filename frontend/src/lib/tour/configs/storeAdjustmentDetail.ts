import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-adjustment-detail',
  pageTitle: 'Stock Adjustment Detail',
  steps: [
    {
      target: 'adjustment-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the Stock Adjustments list.',
    },
    {
      target: 'adjustment-detail-summary',
      title: 'Adjustment Summary',
      purpose: 'Store, date, who approved it, and who recorded it.',
    },
    {
      target: 'adjustment-detail-items',
      title: 'Items',
      purpose: 'Each item\'s Existing (system) quantity, Actual (counted) quantity, and the Difference that was posted to stock — green for an increase, red for a decrease.',
    },
  ],
}

export default config
