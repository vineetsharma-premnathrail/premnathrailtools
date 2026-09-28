import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-return-detail',
  pageTitle: 'Material Return Detail',
  steps: [
    {
      target: 'return-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the Material Returns list.',
    },
    {
      target: 'return-detail-summary',
      title: 'Return Summary',
      purpose: 'Warehouse, source (a prior Material Issue or free text), reason, and who recorded it.',
    },
    {
      target: 'return-detail-items',
      title: 'Items',
      purpose: 'Every item, quantity, and condition on this return. Only "Good" condition lines actually added stock back — Damaged/Rejected lines are recorded here but weren\'t added to usable stock.',
    },
  ],
}

export default config
