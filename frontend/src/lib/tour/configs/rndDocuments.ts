import { TourConfig } from '../types'
import { RND_DOC_TYPE_OPTIONS, rndDocPanelSteps } from './rndShared'

const config: TourConfig = {
  id: 'rnd-documents',
  pageTitle: 'R&D Documents',
  steps: [
    {
      target: 'rnd-docs-search',
      title: 'Search',
      purpose: 'Find a document by its title or file name.',
      validExample: 'load test',
    },
    {
      target: 'rnd-docs-project-filter',
      title: 'Project filter',
      purpose: 'Show documents of one R&D project, or All projects.',
    },
    {
      target: 'rnd-docs-type-filter',
      title: 'Type filter',
      options: [{ value: 'All types', meaning: 'No type filter.' }, ...RND_DOC_TYPE_OPTIONS],
    },
    ...rndDocPanelSteps({ withProject: true }),
  ],
}

export default config
