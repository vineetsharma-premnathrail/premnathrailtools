import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-approval-list',
  pageTitle: 'P.R Approval',
  steps: [
    {
      target: 'p2p-stats',
      title: 'Counters',
      purpose: 'Requisitions in the selected segment (Waiting for me, Approved, Rejected or All), split into waiting for approval, in progress and closed. They follow the search and filters.',
    },
    {
      target: 'p2p-list-search',
      title: 'Search',
      purpose: 'Type a PR number, category, project, requester or buyer to narrow the list.',
    },
    {
      target: 'p2p-filter-btn',
      title: 'Filters',
      purpose: 'Opens the Filters popup: status, category, buyer and project. Apply Filters uses your choices; Clear removes them.',
      required: false,
    },
    {
      target: 'p2p-list-table',
      title: 'Purchase Requisition Number / Category / Project / Required Date / Priority / Status',
      purpose: 'Requisitions in the currently selected bucket, with category, project, required date, priority, and status. Click a row to open the full requisition detail, where Approve/Reject actions are available.',
    },
  ],
}

export default config
