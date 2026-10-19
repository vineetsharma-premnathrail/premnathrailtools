import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hyd-plans-list',
  pageTitle: 'Maintenance Plans',
  steps: [
    {
      target: 'hydraulic-nav-calendar',
      title: 'Maintenance tab',
      purpose: 'Preventive maintenance (PM) plans — recurring tasks such as oil change, filter change or hose inspection, due by calendar days and/or running hours.',
      why: 'Planned maintenance is cheaper than breakdowns. Most hydraulic failures come from dirty oil, clogged filters and worn seals — all things a PM plan catches early.',
    },
    {
      target: 'hyd-plan-new-btn',
      title: '+ New Plan',
      purpose: 'Creates a new recurring maintenance task for a system.',
    },
    {
      target: 'hyd-plan-search',
      title: 'Search',
      whatToEnter: 'Plan number or title.',
    },
    {
      target: 'hyd-plan-medium-filter',
      title: 'Medium filter',
      options: [
        { value: 'Hydraulic + Pneumatic', meaning: 'Show both.' },
        { value: 'Hydraulic', meaning: 'Plans on oil systems only.' },
        { value: 'Pneumatic', meaning: 'Plans on air systems only.' },
      ],
    },
    {
      target: 'hyd-plan-type-filter',
      title: 'Maintenance type filter',
      purpose: 'Show only one kind of task, e.g. Oil Change or Filter Change.',
    },
    {
      target: 'hyd-plan-due-filter',
      title: 'Due status filter',
      options: [
        { value: 'Overdue', meaning: 'Past its due date or running hours — do it now.' },
        { value: 'Due Soon', meaning: 'Coming due shortly — schedule it.' },
        { value: 'On Track', meaning: 'Not due yet.' },
        { value: 'Inactive', meaning: 'Paused plans (not tracked).' },
      ],
    },
    {
      target: 'hyd-plan-inactive-toggle',
      title: 'Show inactive',
      purpose: 'Also lists paused plans, which are hidden by default.',
    },
    {
      target: 'hyd-plan-table',
      title: 'Plans list',
      purpose: 'Most urgent first. Shows the frequency, when it was last done (date and hours), next due, who it is assigned to and the due badge (red Overdue, amber Due Soon, green On Track, grey Inactive).',
      after: 'Job column: "Raise job" creates a service job for this plan; "Open job" goes to the job already raised and not yet completed. Click a row or "View" to open the plan.',
    },
  ],
}

export default config
