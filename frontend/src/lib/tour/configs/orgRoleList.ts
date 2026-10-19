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
      target: 'org-roles-filter',
      title: 'Which roles',
      purpose: 'Switch between your own roles and the built-in presets.',
      options: [
        { value: 'Custom roles', meaning: 'Roles your company made (editable). Includes the "Standard access (migrated)" roles created when roles were introduced — tighten or replace them.' },
        { value: 'Built-in presets', meaning: 'Per module: Full Access and View Only. Assignable, not editable — Copy one to start a custom role.' },
        { value: 'All', meaning: 'Both.' },
      ],
    },
    {
      target: 'org-roles-table',
      title: 'Roles',
      purpose: 'Every role with its description, type and how many users hold it. Click a row to open it.',
      after: '"Everyone" roles apply to every user automatically (e.g. Employee self-service).',
    },
  ],
}

export default config
