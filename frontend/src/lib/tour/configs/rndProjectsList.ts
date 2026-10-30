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
      title: '+ New R&D Project',
      purpose: 'Opens the form to start a new Prototype / Research project.',
    },
    {
      target: 'rnd-proj-search',
      title: 'Search',
      purpose: 'Type part of a project number, title or objective — the list filters as you type.',
      validExample: 'bogie',
    },
    {
      target: 'rnd-proj-filter-btn',
      title: 'Filters',
      purpose: 'Opens the filters popup: Stage, Status, Priority and Origin. Press Apply to filter the list; the number on the button shows how many filters are on, and Clear removes them. Clicking a stage on the R&D Dashboard opens this list already filtered by that stage.',
      options: [
        { value: 'Stage', meaning: 'All stages, or one of: ' + RND_STAGE_OPTIONS.map((o) => o.value).join(', ') + '.' },
        { value: 'Status', meaning: 'All statuses, or one of: ' + RND_STATUS_OPTIONS.map((o) => o.value).join(', ') + '.' },
        { value: 'Priority', meaning: 'All priorities, or one of: ' + RND_PRIORITY_OPTIONS.map((o) => o.value).join(', ') + '.' },
        { value: 'Origin', meaning: 'Why the project exists: Existing Projects (improve a project / machine we already built) or New Project.' },
      ],
    },
    {
      target: 'rnd-proj-table',
      title: 'Project list',
      purpose: 'Project No. (ascending), title, origin, priority (Standard / Urgent) and status badges, lead and target end date. Click any row to open the project.',
    },
  ],
}

export default config
