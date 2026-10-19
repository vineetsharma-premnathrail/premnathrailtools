import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'sales-delivery',
  pageTitle: 'Delivery Schedule',
  steps: [
    {
      target: 'sales-nav-truck',
      title: 'Delivery tab',
      purpose: 'Every open vehicle across all confirmed orders, grouped by the month it is due.',
    },
    {
      target: 'sales-delivery-filters',
      title: 'Filters',
      purpose: 'Show only vehicles at risk / overdue, a production stage, or one due month.',
    },
    {
      target: 'sales-delivery-board',
      title: 'Schedule board',
      purpose: 'One row per vehicle: the current contractual date (after DP extensions), its RRV build and stage, risk, and LD accrued so far / forecast from the build’s target date. Click a row to open its order.',
      why: 'LD is computed and shown here, never posted — Finance books it only when the customer actually deducts it.',
    },
    {
      target: 'sales-delivery-extensions',
      title: 'Open DP extensions',
      purpose: 'Extensions requested from the customer that are still waiting for their letter. Record the decision on the order’s Delivery Schedule tab.',
    },
  ],
}

export default config
