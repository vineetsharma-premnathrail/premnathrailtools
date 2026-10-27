import { TourConfig } from '../types'
import { RND_STATUS_OPTIONS } from './rndShared'

const config: TourConfig = {
  id: 'rnd-dashboard',
  pageTitle: 'R&D Dashboard',
  steps: [
    {
      target: 'rnd-nav-grid',
      title: 'Dashboard',
      purpose: 'Overview of R&D work: requirements, ongoing projects and your tasks.',
    },
    {
      target: 'rnd-nav-pm-work',
      title: 'Project Work',
      purpose: 'WBS that management has assigned to the R&D department, and the project tasks assigned to you.',
    },
    {
      target: 'rnd-nav-requirements',
      title: 'Requirements',
      purpose: 'Engineering work requested from R&D by other modules (for example a CRM inquiry or tender that needs R&D input).',
    },
    {
      target: 'rnd-nav-projects',
      title: 'Prototype / Research',
      purpose: 'All R&D projects with filters; open one to move it through its stages, record feasibility and hand it over.',
    },
    {
      target: 'rnd-nav-tools',
      title: 'Engineering Tools',
      purpose: 'The engineering calculators — Braking, Hydraulic, Qmax, Load Distribution, Tractive Effort, Vehicle Performance and Spline.',
    },
    {
      target: 'rnd-nav-history',
      title: 'History',
      purpose: 'Every calculation run from the Engineering Tools is saved here automatically, so you can reopen or re-download it.',
    },
    {
      target: 'rnd-nav-bell',
      title: 'Notifications',
      purpose: 'Alerts for R&D work assigned to you or waiting on your action.',
    },
    {
      target: 'rnd-dash-stats',
      title: 'Requirements, Projects, Tasks',
      purpose: 'Requirements: every requirement the business team sent to R&D that you can see; Awaiting R&D: how many still need a response from R&D. Ongoing projects: active projects not yet closed; On hold: paused projects. My open tasks: requirement and project tasks assigned to you; Overdue: those past their due date. Click a counter to open its list.',
      options: RND_STATUS_OPTIONS,
    },
    {
      target: 'rnd-dash-requirements',
      title: 'Recently Received Requirements',
      purpose: 'The latest requirements sent to R&D, with the customer, product, date received and whether R&D has responded. Click one to open it.',
    },
    {
      target: 'rnd-dash-recent',
      title: 'Ongoing Projects',
      purpose: 'Active projects most recently worked on, with the project lead and current stage. Click one to open it, or "View all" for the full list.',
    },
  ],
}

export default config
