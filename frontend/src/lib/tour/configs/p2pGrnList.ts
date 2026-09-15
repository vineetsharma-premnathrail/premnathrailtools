import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-grn-list',
  pageTitle: 'Goods Receipt (GRN)',
  steps: [
    {
      target: 'grn-new-btn',
      title: '+ New Goods Receipt',
      purpose: 'Opens the form to record goods received against a Purchase Order.',
      after: 'Takes you to a separate Record Goods Receipt page — its own guided tour covers every field there.',
    },
    {
      target: 'grn-list-table',
      title: 'GRN Number / PO Number / PR Number / Vendor / Received Date / Status',
      purpose: 'Every goods receipt recorded so far, linked back to its Purchase Order and originating requisition. "Pending Inspection" means quality inspection hasn\'t been completed yet.',
    },
    {
      target: 'grn-list-view',
      title: 'View',
      purpose: 'Click View — or anywhere on the row — to open this GRN: its received items, and quality inspection if still pending.',
    },
  ],
}

export default config
