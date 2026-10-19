import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-schedule-list',
  pageTitle: 'PM Schedule',
  steps: [
    {
      target: 'maintenance-nav-calendar',
      title: 'PM Schedule',
      purpose: 'Preventive Maintenance (PM) — routine servicing planned in advance: lubrication, inspections, filter changes, calibration.',
      why: 'Fixing a machine before it fails costs a fraction of a breakdown — no lost production, no rush-buying spares. PM compliance (jobs done on time ÷ jobs due) is a key maintenance KPI on the Reports page.',
    },
    {
      target: 'maint-pm-new-btn',
      title: '+ New PM Plan',
      purpose: 'Create a plan: which machine, what to do, how often.',
      after: 'Every morning the system raises the plan\'s work order a few days (lead days) before it falls due, so nobody has to remember.',
    },
    {
      target: 'maint-pm-view-plans',
      title: 'Plans view',
      purpose: 'The list of PM plans with their next due date and state.',
      autoActivate: true,
    },
    {
      target: 'maint-pm-plant-filter',
      title: 'Plant filter',
      purpose: 'Show only one plant\'s plans (works in both views).',
    },
    {
      target: 'maint-pm-search',
      title: 'Search',
      purpose: 'Find a plan by plan code, title or asset.',
      validExample: 'PM-0012 · lubrication · CNC-01',
    },
    {
      target: 'maint-pm-active-filter',
      title: 'Active filter',
      purpose: 'Active plans raise jobs; Inactive plans are switched off. "All plans" shows both.',
    },
    {
      target: 'maint-pm-due-filter',
      title: 'Due filter',
      purpose: 'Narrow by due date.',
      options: [
        { value: 'Any due date', meaning: 'No filter.' },
        { value: 'Overdue', meaning: 'Due date has passed and the job is not done.' },
        { value: 'Due within 7 days', meaning: 'Coming up this week.' },
        { value: 'Due within 30 days', meaning: 'Coming up this month — useful for planning shutdowns and spares.' },
      ],
    },
    {
      target: 'maint-pm-table',
      title: 'Plan list',
      purpose: 'Plan code, asset, title, job type, frequency, next due date (red if overdue), last done, default technician, the current open job (click to open it) and state.',
      options: [
        { value: 'Overdue', meaning: 'Past due, not done.' },
        { value: 'Due soon', meaning: 'Within the lead time — job raised or about to be.' },
        { value: 'Scheduled', meaning: 'Active, next due date further away.' },
        { value: 'Inactive', meaning: 'Plan switched off.' },
      ],
      after: 'Click a row to open the plan.',
    },
    {
      target: 'maint-pm-view-upcoming',
      title: 'Upcoming view',
      purpose: 'A week-by-week calendar of PM jobs: overdue first, then this week, then each following week.',
      autoActivate: true,
    },
    {
      target: 'maint-pm-weeks',
      title: 'Window',
      purpose: 'How far ahead to look: next 4 weeks, 8 weeks, 3 months or 6 months.',
      why: 'Looking 1–3 months ahead lets you group jobs needing a machine stop into one planned shutdown and order spares in time.',
    },
    {
      target: 'maint-pm-upcoming',
      title: 'Upcoming jobs',
      purpose: 'Each line: due date, asset, task, plan code and type, the work order number (or "Not raised yet") with technician, and state — Overdue, Due (job raised soon), Upcoming, or the work order\'s own status.',
      after: 'Click a line to open its work order, or the plan if no job exists yet.',
    },
  ],
}

export default config
