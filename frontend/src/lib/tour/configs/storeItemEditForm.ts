import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-item-edit-form',
  pageTitle: 'Edit Item',
  steps: [
    {
      target: 'item-edit-save-btn',
      title: 'Save Changes',
      purpose: 'Saves every field on this form. Item Name is required — everything else is optional.',
      after: 'Returns to the item\'s read-only detail view with the updated values.',
    },
    {
      target: 'item-edit-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards any changes made on this form and returns to the read-only detail view.',
    },
  ],
}

export default config
