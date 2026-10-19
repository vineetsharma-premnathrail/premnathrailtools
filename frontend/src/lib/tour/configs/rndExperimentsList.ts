import { TourConfig } from '../types'
import { RND_EXP_RESULT_OPTIONS, RND_EXP_STATUS_OPTIONS, RND_EXP_TYPE_OPTIONS } from './rndShared'

const config: TourConfig = {
  id: 'rnd-experiments-list',
  pageTitle: 'Experiments & Tests',
  steps: [
    {
      target: 'rnd-exp-new-btn',
      title: '+ New Experiment',
      purpose: 'Records a new experiment or test. If a project filter is set, the new experiment starts with that project already chosen.',
    },
    {
      target: 'rnd-exp-search',
      title: 'Search',
      purpose: 'Find by experiment number or title.',
    },
    {
      target: 'rnd-exp-project-filter',
      title: 'Project filter',
      purpose: 'Show only one R&D project’s experiments.',
    },
    {
      target: 'rnd-exp-type-filter',
      title: 'Type filter',
      options: [{ value: 'All types', meaning: 'No filter.' }, ...RND_EXP_TYPE_OPTIONS],
    },
    {
      target: 'rnd-exp-status-filter',
      title: 'Status filter',
      options: [{ value: 'All statuses', meaning: 'No filter.' }, ...RND_EXP_STATUS_OPTIONS],
    },
    {
      target: 'rnd-exp-result-filter',
      title: 'Result filter',
      options: [{ value: 'All results', meaning: 'No filter.' }, ...RND_EXP_RESULT_OPTIONS],
    },
    {
      target: 'rnd-exp-table',
      title: 'Experiment list',
      purpose: 'Number, title, project, type, status badge, result badge and date. Click a row to open and update it.',
    },
  ],
}

export default config
