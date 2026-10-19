import { TourConfig } from '../types'
import { hydSpareFormSteps } from './hydSpareFormSteps'

const config: TourConfig = {
  id: 'hyd-spare-detail',
  pageTitle: 'Spare Part',
  steps: [
    {
      target: 'hyd-spared-delete-btn',
      title: 'Delete',
      purpose: 'Removes the spare from the list and pickers (asks for confirmation). Completed service jobs keep their history; the Store item is not touched.',
    },
    {
      target: 'hyd-spared-back-btn',
      title: '← Back',
      purpose: 'Returns to the spares list.',
    },
    {
      target: 'hyd-spared-badges',
      title: 'Criticality and stock badges',
      purpose: 'Criticality: Critical (red), Essential (amber), Desirable (grey). Stock: In Stock, Low (below minimum), Out of Stock, or Not Linked (no Store item, so stock is not tracked).',
    },
    {
      target: 'hyd-spared-stock',
      title: 'Stock',
      purpose: 'When linked to a Store item: on hand, available (on hand less reserved), minimum, reorder quantity and quantity used on service jobs in the last 12 months — summed over every Store location.',
      why: 'Comparing "Used (12 m)" with the minimum stock tells you whether the minimum is set right.',
    },
    {
      target: 'hyd-spared-used-in',
      title: 'Used in Systems',
      purpose: 'Systems whose released BOM carries the component this spare fits, and how many of that component each has. Click one to open the system.',
    },
    ...hydSpareFormSteps(true),
  ],
}

export default config
