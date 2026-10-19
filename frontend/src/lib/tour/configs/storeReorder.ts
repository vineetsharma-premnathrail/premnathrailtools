import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-reorder',
  pageTitle: 'Reorder',
  steps: [
    {
      target: 'store-reorder-filters',
      title: 'Filters',
      purpose: 'Narrow the list to one category, or untick "Only items due" to see every item that has a reorder level or minimum stock.',
    },
    {
      target: 'store-reorder-table',
      title: 'Reorder list',
      purpose: 'Available = free stock minus reservations, summed over all stores. On order = open requisitions not yet on a PO plus open PO quantity not yet received. Projected = available + on order. An item is due when projected stock is at or below its reorder level (or below its minimum stock when no reorder level is set).',
      why: 'Counting what is already on order stops the same shortage from being ordered twice.',
    },
    {
      target: 'store-reorder-raise-pr',
      title: 'Raise PR for selected',
      purpose: 'Tick the items to buy and adjust Order qty if needed, then open a new purchase requisition pre-filled with those Item Master items. Nothing is raised until you submit the requisition.',
      after: 'Once the PR is submitted, the items show its quantity as On order and drop off the due list.',
      validExample: 'Suggested quantity tops up to maximum stock, else the reorder quantity, else the shortfall — rounded up to the minimum order quantity.',
    },
  ],
}

export default config
