import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-boms-list',
  pageTitle: 'Bills of Materials',
  steps: [
    {
      target: 'design-nav-layers',
      title: 'BOMs tab',
      purpose: 'Engineering Bills of Material — one per product item, listing every part and quantity needed to make it.',
      why: 'A released BOM is what Store issues against and Purchase buys against, so it must be checked and approved like a drawing.',
    },
    {
      target: 'design-boms-new-btn',
      title: '+ New BOM',
      purpose: 'Creates a BOM for a product item. Not shown to viewers.',
      after: 'Opens the New BOM form.',
    },
    {
      target: 'design-boms-new-items',
      title: 'New item codes requested',
      purpose: 'BOM lines for parts that do not yet exist in the Item Master. Store must create the item code before the BOM can be released. Click to expand.',
      why: 'Every part on a released BOM needs a real item code, otherwise Store and Purchase cannot act on it.',
    },
    {
      target: 'design-boms-status-tabs',
      title: 'Status tabs',
      options: [
        { value: 'Active', meaning: 'Everything except obsolete.' },
        { value: 'Released', meaning: 'Has an approved revision in use (including ones being revised).' },
        { value: 'In Workflow', meaning: 'A revision is in check or awaiting release.' },
        { value: 'Draft', meaning: 'Being prepared, not yet submitted.' },
        { value: 'Obsolete', meaning: 'Withdrawn from use.' },
        { value: 'All', meaning: 'Every BOM.' },
      ],
    },
    {
      target: 'design-boms-search',
      title: 'Search',
      whatToEnter: 'BOM number, title or product item code/name.',
      validExample: 'BOM-0007 or RRV-ENGINE',
    },
    {
      target: 'design-boms-table',
      title: 'BOM rows',
      purpose: '"Released Rev" is the BOM revision in use; "Work in Progress" is a newer revision being prepared or checked. Click a row to open the BOM.',
      options: [
        { value: 'Draft', meaning: 'Being prepared.' },
        { value: 'In check', meaning: 'With the checker.' },
        { value: 'Awaiting release', meaning: 'Checked, with the approver.' },
        { value: 'Released', meaning: 'Approved and in use.' },
        { value: 'Released · revising', meaning: 'In use while the next revision is prepared.' },
        { value: 'Superseded / Obsolete', meaning: 'Replaced or withdrawn — not for use.' },
      ],
    },
    {
      target: 'design-boms-where-used',
      title: 'Where used',
      purpose: 'Find every BOM that uses a given item or drawing.',
      why: 'Before changing or stopping a part, you need to know every product it affects.',
    },
    {
      target: 'design-boms-wu-kind',
      title: 'Search by',
      options: [
        { value: 'Item', meaning: 'An Item Master part.' },
        { value: 'Drawing', meaning: 'A controlled document.' },
      ],
    },
    {
      target: 'design-boms-wu-pick',
      title: 'Pick item / drawing',
      purpose: 'Choose the item or drawing.',
      after: 'Shows the BOMs it is used in, its own BOM if it is a sub-assembly, related drawings and projects.',
    },
    {
      target: 'design-boms-wu-search',
      title: 'Not listed? Search',
      purpose: 'The picker shows a short list; type here and press Enter (or Search) to load more matches.',
    },
  ],
}

export default config
