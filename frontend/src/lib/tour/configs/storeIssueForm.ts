import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-issue-form',
  pageTitle: 'New Material Issue',
  steps: [
    {
      target: 'issue-back-btn',
      title: '← Back',
      purpose: 'Returns to the Material Issues list without saving.',
    },
    {
      target: 'issue-location',
      title: 'Warehouse',
      required: true,
      purpose: 'Which warehouse the material is issued out of.',
    },
    {
      target: 'issue-department',
      title: 'Department',
      purpose: 'Which department requested/received this material.',
    },
    {
      target: 'issue-project',
      title: 'Project / Work Order',
      purpose: 'Free-text reference to the project or production work order this material is for.',
    },
    {
      target: 'issue-item',
      title: 'Item',
      required: true,
      purpose: 'Which Item Master record to issue.',
    },
    {
      target: 'issue-quantity',
      title: 'Quantity',
      required: true,
      why: 'Rejected if it exceeds what\'s currently available at the selected warehouse.',
    },
    {
      target: 'issue-add-item-btn',
      title: '+ Add Item',
      purpose: 'Adds another line so several items can be issued in one Material Issue document.',
    },
    {
      target: 'issue-save-btn',
      title: 'Issue Material',
      purpose: 'Creates the issue and deducts stock from the warehouse immediately — no separate approval step.',
      after: 'Takes you to the new issue\'s detail page.',
    },
  ],
}

export default config
