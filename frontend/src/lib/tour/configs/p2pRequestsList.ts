import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-requests-list',
  pageTitle: 'Purchase Requisitions',
  steps: [
    {
      target: 'p2p-new-btn',
      title: '+ New Purchase Requisition',
      purpose: 'Opens the form to raise a brand-new Purchase Requisition (PR).',
      after: 'Takes you to a separate New Purchase Requisition page — its own guided tour covers every field there.',
    },
    {
      target: 'p2p-list-table',
      title: 'Purchase Requisition Number / Category / Project / Required Date / Priority / Status',
      purpose: 'Every PR you have raised, with its category, linked project, required date, priority, and current status at a glance.',
    },
    {
      target: 'p2p-list-view',
      title: 'View',
      purpose: 'Click View — or anywhere else on the row — to open that PR\'s full detail page: approval status, item list, linked RFQ/PO, and any attachments.',
    },
  ],
}

export default config
