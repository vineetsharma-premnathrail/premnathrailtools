import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'electrical-purchase-requirements',
  pageTitle: 'Electrical Purchase Requirements',
  steps: [
    {
      target: 'electrical-nav-cart',
      title: 'Purchase Req.',
      purpose: 'BOM components across every RRV job that still need buying — the Purchase Requirement stage, seen for all jobs at once.',
      why: 'The buyer and the electrical lead can see in one list what is still unbought, instead of opening each job.',
    },
    {
      target: 'elec-pur-search',
      title: 'Search',
      purpose: 'Finds lines by description, make, part number or job.',
      validExample: 'Schneider',
    },
    {
      target: 'elec-pur-status-filter',
      title: 'Procurement status filter',
      options: [
        { value: 'Still open', meaning: 'Default — To Buy, PR Raised and Ordered: everything not yet in hand.' },
        { value: 'To Buy', meaning: 'Needs purchasing and no PR is linked yet — act on these first.' },
        { value: 'PR Raised', meaning: 'A purchase requisition is linked; waiting for Procurement.' },
        { value: 'Ordered', meaning: 'A purchase order is placed with a supplier.' },
        { value: 'In Stock', meaning: 'Will be drawn from Store; no purchase needed.' },
        { value: 'Received', meaning: 'Material has arrived.' },
        { value: 'Issued', meaning: 'Handed from Store to the electrical team.' },
      ],
    },
    {
      target: 'elec-pur-category-filter',
      title: 'Category filter',
      purpose: 'Shows one component category, e.g. all Relays / Contactors — handy for buying similar parts together.',
    },
    {
      target: 'elec-pur-summary',
      title: 'Totals',
      purpose: 'Lines still "To Buy" (red when any), and how many lines are shown across how many jobs.',
    },
    {
      target: 'elec-pur-table',
      title: 'BOM lines',
      purpose: 'Job, line no., category, description with make / part no., qty, rating, procurement badge and the linked PR with its live status.',
      after: 'Click a row to open the job on its BOM tab — raise or link the PR there.',
    },
  ],
}

export default config
