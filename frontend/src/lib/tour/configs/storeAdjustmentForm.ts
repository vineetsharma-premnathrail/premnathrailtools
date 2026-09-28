import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-adjustment-form',
  pageTitle: 'New Stock Adjustment',
  steps: [
    {
      target: 'adjustment-back-btn',
      title: '← Back',
      purpose: 'Returns to the Stock Adjustments list without saving.',
    },
    {
      target: 'adjustment-location',
      title: 'Warehouse',
      required: true,
      purpose: 'Which warehouse this physical count applies to. Selecting it loads the current system quantity for every item below.',
    },
    {
      target: 'adjustment-approver',
      title: 'Approved By',
      required: true,
      purpose: 'Who approved this correction — searchable by name or email.',
    },
    {
      target: 'adjustment-item',
      title: 'Item',
      required: true,
      why: 'Only enabled once a Warehouse is selected above.',
    },
    {
      target: 'adjustment-existing-qty',
      title: 'Existing Qty',
      purpose: 'The system\'s current on-hand quantity for this item at this warehouse — read-only, filled in automatically once the item is picked.',
    },
    {
      target: 'adjustment-actual-qty',
      title: 'Actual Qty',
      required: true,
      purpose: 'The quantity actually counted during the physical stock check.',
      after: 'The difference (Actual − Existing) shows live next to this field, and determines whether an increase or decrease is posted.',
    },
    {
      target: 'adjustment-add-item-btn',
      title: '+ Add Item',
      purpose: 'Adds another line so several items can be corrected in one adjustment document.',
    },
    {
      target: 'adjustment-save-btn',
      title: 'Post Adjustment',
      purpose: 'Creates the adjustment and updates on-hand stock immediately by the computed difference for each line.',
      after: 'Takes you to the new adjustment\'s detail page.',
    },
  ],
}

export default config
