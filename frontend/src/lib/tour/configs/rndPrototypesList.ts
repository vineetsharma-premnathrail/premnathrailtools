import { TourConfig } from '../types'
import { RND_PROTO_STATUS_OPTIONS } from './rndShared'

const config: TourConfig = {
  id: 'rnd-prototypes-list',
  pageTitle: 'Prototypes',
  steps: [
    {
      target: 'rnd-proto-new-btn',
      title: '+ New Prototype',
      purpose: 'Records a new prototype (a physical trial build) with its BOM. If a project filter is set, that project is pre-selected.',
    },
    {
      target: 'rnd-proto-search',
      title: 'Search',
      purpose: 'Find by prototype number, name or version.',
    },
    {
      target: 'rnd-proto-project-filter',
      title: 'Project filter',
      purpose: 'Show only one R&D project’s prototypes.',
    },
    {
      target: 'rnd-proto-status-filter',
      title: 'Status filter',
      options: [{ value: 'All statuses', meaning: 'No filter.' }, ...RND_PROTO_STATUS_OPTIONS],
    },
    {
      target: 'rnd-proto-table',
      title: 'Prototype list',
      purpose: 'Number, name, version, project, status badge, BOM cost (sum of its parts) and number of experiments run on it. Click a row to open it.',
      why: 'BOM cost of all prototypes is what the project’s "Actual" spend is made of — compare it with the budget.',
    },
  ],
}

export default config
