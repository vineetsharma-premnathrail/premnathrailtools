import { TourConfig } from '../types'
import { MILESTONE_STATUS_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-board',
  pageTitle: 'Department Board',
  steps: [
    {
      target: 'pm-nav-chart',
      title: 'Department Board',
      purpose: 'Every live project (rows) against every department (columns).',
    },
    {
      target: 'pm-board-grid',
      title: 'Reading the board',
      purpose: 'Each cell shows that department\'s WBS elements on that project: status, % of its tasks done, title and target date. A red border means the WBS is overdue; amber means at risk (a task inside it is blocked or late). "—" means the department has no WBS on that project.',
      options: MILESTONE_STATUS_OPTIONS,
      why: 'In a make-to-order shop an order moves Design → Purchase → Production → Quality → Dispatch. This board shows in one screen which department is holding each order, so review meetings start from facts instead of asking around.',
      after: 'Click a project code to open the project, or a WBS card to open that WBS\'s workspace.',
    },
  ],
}

export default config
