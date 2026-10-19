import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-asset-edit',
  pageTitle: 'Finance — Edit fixed asset',
  steps: [
    {
      target: 'fin-fa-edit-dialog',
      title: 'Edit asset',
      purpose: 'Only descriptive fields can change here.',
      why: 'Cost, dates and method drive depreciation already charged. To correct them, dispose of the asset (or delete it if never depreciated) and register it again.',
    },
    {
      target: 'fin-fa-edit-name',
      title: 'Name',
      required: true,
    },
    {
      target: 'fin-fa-edit-description',
      title: 'Description',
    },
    {
      target: 'fin-fa-edit-location',
      title: 'Location',
      purpose: 'Update when the asset is moved.',
    },
    {
      target: 'fin-fa-edit-cost-center',
      title: 'Cost centre',
      purpose: 'Future depreciation is charged to this cost centre.',
    },
    {
      target: 'fin-fa-edit-save',
      title: 'Save',
      after: 'The dialog closes and the list refreshes.',
    },
    {
      target: 'fin-fa-edit-cancel',
      title: 'Cancel',
      purpose: 'Closes without saving.',
    },
  ],
}

export default config
