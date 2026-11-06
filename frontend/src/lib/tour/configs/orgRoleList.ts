import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-role-list',
  pageTitle: 'Role & Permissions',
  steps: [
    {
      target: 'org-roles-new',
      title: '+ New Role',
      purpose: 'Create a role for a job — e.g. "Store Keeper": which modules, tabs and actions it allows.',
      why: 'Access is set once per job, then given to people. When the job changes, edit the role and everyone holding it follows.',
    },
    { target: 'org-roles-search', title: 'Search', purpose: 'Filters roles by name or description.', validExample: 'store' },
    {
      target: 'org-roles-table',
      title: 'Roles',
      purpose: 'Every role with its description and how many users hold it. Click a row to open it.',
      after: '"Everyone" roles apply to every user automatically (e.g. Employee self-service).',
    },
  ],
}

export default config
