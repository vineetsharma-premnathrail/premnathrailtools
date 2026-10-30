import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-products',
  pageTitle: 'CRM › Products',
  steps: [
    {
      target: 'prod-search',
      title: 'Search products',
      purpose: 'Finds a product by its code, name or model number as you type.',
      whatToEnter: 'Part of the code, name or model.',
      validExample: 'RRB Sanding Vehicle',
    },
    {
      target: 'prod-new-btn',
      title: '+ New Product',
      purpose: 'Opens the form to add a finished product (machine or spare) to the master. Shown only if your role can create products.',
      why: 'Quotation lines, Design, Production and Service all refer to this one master, so a product is entered once.',
      after: 'The product is saved; open it to add country-wise prices in its Pricing section.',
    },
    {
      target: 'prod-table',
      title: 'Products list',
      purpose: 'Every product with code, name, type, model and status, sorted by code. Click a row to see its technical specifications and prices.',
      why: 'Prices and specifications are inside the product (no separate Pricing page). Prices show only to roles that have the Prices switch and CRM › Products › Pricing.',
    },
  ],
}

export default config
