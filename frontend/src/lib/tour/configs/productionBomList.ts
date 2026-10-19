import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-bom-list',
  pageTitle: 'BOM & Routing',
  steps: [
    {
      target: 'production-nav-layers',
      title: 'BOM & Routing tab',
      purpose: 'The recipe for every product you make.',
      why: 'A BOM (Bill of Material) lists the parts and quantities; the Routing lists the operations, workstation and hours. Together they let a work order know exactly what material to draw from Store and what steps to put on the shop floor — and what the product should cost.',
    },
    {
      target: 'production-bom-new-btn',
      title: '+ New BOM',
      purpose: 'Creates a new BOM (with its routing) for a product.',
      after: 'Opens the BOM form. The new BOM starts as a Draft.',
    },
    {
      target: 'production-bom-search',
      title: 'Search',
      purpose: 'Find a BOM by its number or the product code/name.',
    },
    {
      target: 'production-bom-status-filter',
      title: 'Status filter',
      options: [
        { value: 'Draft', meaning: 'Being prepared — editable, cannot be used for work orders yet.' },
        { value: 'Active', meaning: 'The current approved version for the product — new work orders use it. Locked for editing. Only one active version per product.' },
        { value: 'Obsolete', meaning: 'Replaced or withdrawn — kept for history; existing work orders are unaffected.' },
      ],
    },
    {
      target: 'production-bom-table',
      title: 'BOM list',
      purpose: 'Each BOM with its version, product, component and operation counts, standard cost and status. Click a row to open it.',
    },
  ],
}

export default config
