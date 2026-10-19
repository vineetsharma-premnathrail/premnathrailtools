import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-spares',
  pageTitle: 'Spares',
  steps: [
    {
      target: 'maintenance-nav-box',
      title: 'Spares',
      purpose: 'Every spare part linked to an asset, with live Store stock. Spares are ordinary Store items — stock, minimum and reorder level come from Store. Add spares to an asset from its Spares tab.',
    },
    {
      target: 'maint-spares-pr-selected-btn',
      title: 'Raise PR for selected',
      purpose: 'Shown to users with Purchase (P2P) access. Tick spares in the list, then click to open a new Purchase Request already filled with those items and suggested quantities.',
      after: 'You land on the P2P new request form — check quantities and submit it for approval there.',
      why: 'Reordering critical spares before they run out is what keeps a breakdown from turning into days of downtime.',
    },
    {
      target: 'maint-spares-search',
      title: 'Search',
      purpose: 'Find a spare by item code, name or part number.',
      validExample: '6205 · bearing · SKF',
    },
    {
      target: 'maint-spares-plant-filter',
      title: 'Plant filter',
      purpose: 'Shown when there are several plants. Counts only stock in that plant\'s stores.',
    },
    {
      target: 'maint-spares-below-min',
      title: 'Below minimum only',
      purpose: 'Shows only spares whose stock is below the Store minimum — your reorder list.',
    },
    {
      target: 'maint-spares-critical',
      title: 'Critical only',
      purpose: 'Shows only spares marked critical on at least one asset.',
    },
    {
      target: 'maint-spares-table',
      title: 'Spares list',
      purpose: 'Item (with a red Critical tag), how many assets use it, on hand across stores, minimum / reorder level, stock badge, and quantity used in the last 90 days. Tick boxes select spares for a PR; the header box selects every below-minimum spare. A "Raise PR" button on a below-minimum row orders just that item.',
      options: [
        { value: 'OK', meaning: 'Stock above minimum.' },
        { value: 'At reorder', meaning: 'Stock has reached the reorder level — order now.' },
        { value: 'Below min', meaning: 'Stock below minimum — risk of not having it at a breakdown.' },
        { value: 'No min set', meaning: 'Store has no minimum for this item — set one in Store → Items.' },
      ],
      after: 'Click a row to expand it: stock by store location (with reserved quantity) and the assets it is used on (click one to open it).',
      why: '"Used (90d)" shows real consumption — use it to set sensible minimum levels in Store.',
    },
  ],
}

export default config
