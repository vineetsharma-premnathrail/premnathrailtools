import { TourConfig } from '../types'
import { RND_PRIORITY_OPTIONS, RND_STAGE_OPTIONS, RND_STATUS_OPTIONS } from './rndShared'

const config: TourConfig = {
  id: 'rnd-projects-list',
  pageTitle: 'R&D Projects',
  steps: [
    {
      target: 'rnd-nav-projects',
      title: 'Prototype / Research',
      purpose: 'Every R&D project, from idea to handover.',
    },
    {
      target: 'rnd-proj-new-btn',
      title: '+ New Project',
      purpose: 'Opens the form to start a new R&D project.',
    },
    {
      target: 'rnd-proj-search',
      title: 'Search',
      purpose: 'Type part of a project number, title or objective — the list filters as you type.',
      validExample: 'bogie',
    },
    {
      target: 'rnd-proj-stage-filter',
      title: 'Stage filter',
      purpose: 'Show only projects in one stage. Clicking a stage on the R&D Dashboard opens this list already filtered.',
      options: [{ value: 'All stages', meaning: 'No stage filter.' }, ...RND_STAGE_OPTIONS],
    },
    {
      target: 'rnd-proj-status-filter',
      title: 'Status filter',
      options: [{ value: 'All statuses', meaning: 'No status filter.' }, ...RND_STATUS_OPTIONS],
    },
    {
      target: 'rnd-proj-priority-filter',
      title: 'Priority filter',
      options: [{ value: 'All priorities', meaning: 'No priority filter.' }, ...RND_PRIORITY_OPTIONS],
    },
    {
      target: 'rnd-proj-table',
      title: 'Project list',
      purpose: 'Project No., title, priority and status badges, lead and target end date. Click any row (or View) to open the project.',
    },
  ],
}

export default config
