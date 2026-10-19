import { TourConfig } from '../types'

const WO_TYPES = [
  { value: 'Breakdown', meaning: 'Repair after the machine stopped. Counts in breakdown, MTTR and MTBF figures.' },
  { value: 'Preventive', meaning: 'Planned routine maintenance, normally raised automatically from a PM plan.' },
  { value: 'Corrective', meaning: 'Fixing a defect found before it caused a stop.' },
  { value: 'Calibration', meaning: 'Checking/adjusting a gauge or instrument against a standard.' },
  { value: 'Improvement', meaning: 'Modifying the machine to make it better, safer or more reliable.' },
  { value: 'Inspection', meaning: 'Checking condition only.' },
]

const config: TourConfig = {
  id: 'maintenance-work-orders-list',
  pageTitle: 'Work Orders',
  steps: [
    {
      target: 'maintenance-nav-wrench',
      title: 'Work Orders',
      purpose: 'Every maintenance job — breakdown repairs, preventive jobs, calibrations, improvements.',
    },
    {
      target: 'maint-wo-new-btn',
      title: '+ New Work Order',
      purpose: 'Create a job directly — for planned work maintenance itself decides on (an overhaul, an improvement, a one-off inspection).',
      after: 'Opens the New Work Order form.',
      why: 'For a breakdown someone reported, open their request and use "Create Work Order" there instead, so downtime and the requester\'s sign-off link up.',
    },
    {
      target: 'maint-wo-search',
      title: 'Search',
      purpose: 'Find a job by work order number, title or asset.',
      validExample: 'MWO-2026-0045 · bearing · PRESS-03',
    },
    {
      target: 'maint-wo-type-filter',
      title: 'Type filter',
      purpose: 'Show only one kind of job.',
      options: WO_TYPES,
    },
    {
      target: 'maint-wo-status-filter',
      title: 'Status filter',
      purpose: 'Show jobs in one stage of their life.',
      options: [
        { value: 'Draft', meaning: 'Created but no technician assigned yet.' },
        { value: 'Assigned', meaning: 'A technician is assigned; work has not started.' },
        { value: 'In Progress', meaning: 'The technician has started — labour and spares are being recorded.' },
        { value: 'On Hold', meaning: 'Paused — waiting for spares, an outside vendor or a production window. The reason is recorded.' },
        { value: 'Completed', meaning: 'Technician says the work is done; waiting for requester confirmation and supervisor close.' },
        { value: 'Closed', meaning: 'Verified and closed. Cost and downtime are final.' },
        { value: 'Cancelled', meaning: 'Job dropped before work started (reason recorded).' },
      ],
    },
    {
      target: 'maint-wo-hide-closed',
      title: 'Hide closed',
      purpose: 'Ticked by default: shows open and completed jobs, hides Closed and Cancelled ones. Untick to see history. Hidden when a specific status is picked.',
    },
    {
      target: 'maint-wo-mine',
      title: 'My jobs',
      purpose: 'Show only jobs assigned to you.',
    },
    {
      target: 'maint-wo-table',
      title: 'Work order list',
      purpose: 'Number, asset, title, type, priority, technician, planned date, downtime (machine time lost), cost (spares + labour + external) and status.',
      after: 'Click a row to open the job and move it through its stages.',
    },
  ],
}

export default config
