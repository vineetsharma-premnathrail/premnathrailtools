import { TourConfig } from '../types'
import { PROJECT_STATUS_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-all-list',
  pageTitle: 'All Projects',
  steps: [
    {
      target: 'pm-nav-grid',
      title: 'All Projects',
      purpose: 'Every project in the company — one project per customer order — whatever its status.',
    },
    {
      target: 'pm-all-new-btn',
      title: '+ New Project',
      purpose: 'Creates a new project for a customer order. Only shown to authorised management (Partners, Directors, or users given "All Projects › Create").',
      after: 'Opens the New Project form — its own tour explains every field.',
    },
    {
      target: 'pm-all-search',
      title: 'Search',
      purpose: 'Finds projects by project code, name or customer.',
      whatToEnter: 'Any part of the code, name or customer — the list refreshes as you type.',
      validExample: 'PEW-39  or  IRCON',
    },
    {
      target: 'pm-all-status-filter',
      title: 'Status filter',
      purpose: 'Shows only projects in one stage of their life.',
      options: [{ value: 'All statuses', meaning: 'No filter.' }, ...PROJECT_STATUS_OPTIONS],
    },
    {
      target: 'pm-all-table',
      title: 'Project rows',
      purpose: 'Code, name, customer, status, project manager and target handover date.',
      after: 'Click a row to open the project — its Overview, Documents and History.',
    },
  ],
}

export default config
