import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hyd-spares-list',
  pageTitle: 'Spare Parts',
  steps: [
    {
      target: 'hydraulic-nav-package',
      title: 'Spare Parts tab',
      purpose: 'The spares register — seal kits, filter elements, hoses, valve cartridges and other parts the systems need — with criticality and live stock from Store.',
      why: 'Knowing which spares each machine needs, and keeping the critical ones in stock, is what turns a 3-day breakdown into a 3-hour repair.',
    },
    {
      target: 'hyd-spare-new-btn',
      title: '+ New Spare',
      purpose: 'Adds a spare part to the register.',
    },
    {
      target: 'hyd-spare-search',
      title: 'Search',
      whatToEnter: 'Part code, name, manufacturer or part number.',
    },
    {
      target: 'hyd-spare-category-filter',
      title: 'Category filter',
      purpose: 'Show only one kind of spare, e.g. Seal Kit or Filter Element.',
    },
    {
      target: 'hyd-spare-medium-filter',
      title: 'Medium filter',
      options: [
        { value: 'Hydraulic + Pneumatic', meaning: 'Show all.' },
        { value: 'Hydraulic', meaning: 'Spares for oil systems.' },
        { value: 'Pneumatic', meaning: 'Spares for air systems.' },
      ],
    },
    {
      target: 'hyd-spare-criticality-filter',
      title: 'Criticality filter',
      options: [
        { value: 'Critical', meaning: 'Machine stops without it — must always be in stock.' },
        { value: 'Essential', meaning: 'Needed for normal running.' },
        { value: 'Desirable', meaning: 'Can be bought when needed.' },
      ],
    },
    {
      target: 'hyd-spare-stock-filter',
      title: 'Stock filter',
      options: [
        { value: 'Needs reorder', meaning: 'Low or out of stock — your shopping list.' },
        { value: 'Out of stock', meaning: 'Nothing available.' },
        { value: 'Low', meaning: 'Available but below the minimum stock.' },
        { value: 'OK', meaning: 'At or above minimum.' },
        { value: 'Not linked to Store', meaning: 'No Store item linked, so stock is not tracked — link these.' },
      ],
    },
    {
      target: 'hyd-spare-table',
      title: 'Spares list',
      purpose: 'Each spare with category, the component it fits, criticality, available / minimum quantity (amber = low, red = out), quantity used on service jobs in the last 12 months, lead time and stock badge. Click a row to open it.',
      after: 'To buy spares that need reorder, raise a purchase request in Procurement — this module only reads stock.',
    },
  ],
}

export default config
