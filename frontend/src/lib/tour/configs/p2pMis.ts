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
      target: 'p2p-mis-period-tabs',
      title: 'Period',
      purpose: 'Choose the time window the report covers. The exact date range appears under the page title.',
      options: [
        { value: 'Daily', meaning: 'Today only.' },
        { value: 'Weekly', meaning: 'The current week (default).' },
        { value: 'Monthly', meaning: 'The current month.' },
        { value: 'Yearly', meaning: 'The current year.' },
        { value: 'Custom', meaning: 'Pick your own From and To dates.' },
      ],
    },
    {
      target: 'mis-custom-range',
      title: 'Custom From / To',
      purpose: 'Shown only for the Custom period. Both dates are needed before the report loads.',
      whatToEnter: 'A From date and a To date.',
      required: true,
      validExample: 'From 01-Apr-2026, To 30-Sep-2026',
      invalidExample: 'From 30-Sep-2026, To 01-Apr-2026 — From must be on or before To.',
    },
    {
      target: 'p2p-mis-export-btn',
      title: 'Export Excel',
      purpose: 'Downloads the same report for the selected period as an Excel file.',
      after: 'Your browser saves it as P2P_MIS_<period>_<from>_to_<to>.xlsx.',
    },
    {
      target: 'p2p-mis-kpis',
      title: 'KPI tiles',
      purpose: 'Counts for the period: PRs Created, Approved, Rejected, PRs Pending Approval, POs Raised, POs Approved and POs Pending Approval.',
      why: 'A large "Pending Approval" number compared to "Created" means approvals are the bottleneck, not the purchase team.',
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
