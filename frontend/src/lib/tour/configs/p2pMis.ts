import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-mis',
  pageTitle: 'M.I.S Report',
  steps: [
    {
      target: 'p2p-nav-chart',
      title: 'M.I.S Report',
      purpose: 'Management Information System report for procurement — how many requisitions and orders moved through the system in a period, and where they are stuck.',
      why: 'Management uses this to see purchase workload and approval delays at a glance, without opening each PR.',
    },
    {
      target: 'p2p-mis-kpis',
      title: 'Counters',
      purpose: 'Small counters for the chosen period: PRs created, approved, rejected and pending approval, and POs raised, approved and pending approval.',
      why: 'A large "pending approval" number compared to "created" means approvals are the bottleneck, not the purchase team.',
    },
    {
      target: 'p2p-mis-filter-btn',
      title: 'Filters',
      purpose: 'Opens the Filters popup where you choose the period the report covers, then press Apply Filters. The exact date range is shown at the left of this row. Clear resets to the current week.',
      options: [
        { value: 'Daily', meaning: 'Today only.' },
        { value: 'Weekly', meaning: 'The current week (default).' },
        { value: 'Monthly', meaning: 'The current month.' },
        { value: 'Yearly', meaning: 'The current year.' },
        { value: 'Custom', meaning: 'Pick your own From and To dates. Both are needed, and From must be on or before To.' },
      ],
    },
    {
      target: 'p2p-mis-export-btn',
      title: 'Export',
      purpose: 'Downloads the same report for the selected period as an Excel file.',
      after: 'Your browser saves it as P2P_MIS_<period>_<from>_to_<to>.xlsx.',
    },
    {
      target: 'p2p-mis-charts',
      title: 'Charts',
      purpose: 'The trend chart compares PRs created vs approved vs PO raised across the period; the category chart shows which purchase categories most PRs were raised for.',
    },
    {
      target: 'p2p-mis-approver-pending',
      title: 'Pending Approval — By Approver',
      purpose: 'Each approver, their role on the PR/PO, and how many items are waiting on them right now.',
      why: 'Shows exactly whom to remind when purchases are delayed in approval.',
    },
  ],
}

export default config
