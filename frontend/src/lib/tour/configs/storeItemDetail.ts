import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-item-detail',
  pageTitle: 'Item Detail',
  steps: [
    {
      target: 'item-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the Item Master list.',
    },
    {
      target: 'item-detail-edit-btn',
      title: 'Edit',
      purpose: 'Switches every field on this page into an editable form — Item Code stays fixed, everything else can be changed.',
      after: 'Opens the same page as an edit form, with its own guided tour.',
    },
    {
      target: 'item-detail-delete-btn',
      title: 'Delete',
      purpose: 'Permanently removes this item from the Item Master.',
      why: 'There is no undo — a confirmation dialog asks before it actually deletes.',
    },
  ],
}

export default config
