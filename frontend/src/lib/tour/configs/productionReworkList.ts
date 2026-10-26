import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-rework-list',
  pageTitle: 'Rework Orders',
  steps: [
    {
      target: 'production-rework-back-btn',
      title: '← Back',
      purpose: 'Returns to the RRV Builds list.',
    },
    {
      target: 'production-rework-status-tabs',
      title: 'Status tabs',
      purpose: 'A rework order is a defect on a vehicle that must be fixed and then verified. It is raised automatically from a failed vehicle test or failed Quality inspection, or manually.',
      options: [
        { value: 'Open', meaning: 'Open, In Progress and Awaiting Verification together — everything not yet closed.' },
        { value: 'Awaiting Verification', meaning: 'The fitter marked it done; QC/manager must verify the fix (after a passing retest).' },
        { value: 'Verified', meaning: 'Fix confirmed — closed.' },
        { value: 'Cancelled', meaning: 'Raised by mistake; closed without verification.' },
        { value: 'All', meaning: 'Every rework order.' },
      ],
      why: 'Separating "done" from "verified" means the person who fixed the defect is not the one who signs it off.',
    },
    {
      target: 'production-rework-mine-filter',
      title: 'Assigned to me',
      purpose: 'Tick to see only rework assigned to you.',
    },
    {
      target: 'production-rework-table',
      title: 'Rework list',
      purpose: 'Each rework with its build, what needs fixing, source (test / inspection / manual), who it is assigned to, due date and status. Click a row to open the vehicle — its Rework tab is where rework is started, marked done and verified.',
    },
  ],
}

export default config
