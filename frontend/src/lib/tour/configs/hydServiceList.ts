import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hyd-service-list',
  pageTitle: 'Service Records',
  steps: [
    {
      target: 'hydraulic-nav-wrench',
      title: 'Service Records tab',
      purpose: 'Every service job on a hydraulic / pneumatic system — breakdowns, repairs, planned PM, overhauls — with spares used, cost and downtime.',
      why: 'This is the system\'s maintenance history. It shows which machines break down most, what it costs, and whether PM is working.',
    },
    {
      target: 'hyd-svc-new-btn',
      title: '+ New Service Job',
      purpose: 'Raises a new job — e.g. when a machine breaks down. (PM jobs are usually raised from the maintenance plan with "Raise job".)',
    },
    {
      target: 'hyd-svc-search',
      title: 'Search',
      whatToEnter: 'Record number, words from the problem or work done, or the agency name.',
    },
    {
      target: 'hyd-svc-type-filter',
      title: 'Service type filter',
      purpose: 'Show only one kind of job, e.g. Breakdown — useful to review how often machines fail.',
    },
    {
      target: 'hyd-svc-status-filter',
      title: 'Status filter',
      options: [
        { value: 'Open', meaning: 'Raised, work not started.' },
        { value: 'In Progress', meaning: 'Work started.' },
        { value: 'Completed', meaning: 'Work done and closed — locked, part of the history.' },
        { value: 'Cancelled', meaning: 'Called off, with a reason kept on record.' },
      ],
    },
    {
      target: 'hyd-svc-date-from',
      title: 'From date',
      purpose: 'Show jobs with a service date on or after this date.',
    },
    {
      target: 'hyd-svc-date-to',
      title: 'To date',
      purpose: 'Show jobs up to this date. "Clear dates" appears once a date is set.',
    },
    {
      target: 'hyd-svc-table',
      title: 'Jobs list',
      purpose: 'Each job with its date, system, type, the plan it came from, who did it (or the outside agency), downtime hours, total cost and status badge. Click a row to open it.',
    },
  ],
}

export default config
