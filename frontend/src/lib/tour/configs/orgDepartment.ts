import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-department',
  pageTitle: 'Department',
  steps: [
    {
      target: 'org-dept-add-btn',
      title: '+ Add Department',
      purpose: 'Manually create a department that Azure AD sync didn\'t already populate — most departments are auto-created from Azure AD on sign-in and admin Azure sync.',
      after: 'Opens the Add Department dialog.',
    },
    {
      target: 'org-dept-name',
      title: 'Name',
      required: true,
      purpose: 'The department name, e.g. Accounts, Engineering, Stores — shown wherever staff are grouped by department across the portal.',
      validExample: 'Accounts',
    },
    {
      target: 'org-dept-branch',
      title: 'Branch',
      purpose: 'Which branch/plant this department belongs to. Leave unselected for a department that spans all branches.',
    },
    {
      target: 'org-dept-heads',
      title: 'Head of Department',
      purpose: 'One or more people who head this department. The first one picked becomes the primary head, the second the secondary head, and any further ones are recorded as additional heads.',
      whatToEnter: 'Search by name or email, then click a match to add it as a chip. Click the × on a chip to remove it.',
    },
    {
      target: 'org-dept-save',
      title: 'Save Department',
      purpose: 'Creates the department. It then appears in the table below and is available wherever department is picked elsewhere in the app.',
    },
    {
      target: 'org-dept-branch-filter',
      title: 'Branch column filter',
      purpose: 'Click the Branch column header to filter the table down to departments in a single branch, or back to All Branches.',
    },
    {
      target: 'org-dept-table',
      title: 'Departments table',
      purpose: 'Every department, with its code, branch, and head of department. Shows "No departments yet — sign in or run Azure sync to populate this" until at least one exists.',
    },
    {
      target: 'org-dept-row',
      title: 'Department row',
      purpose: 'Click any row to expand it and see the members linked to that department.',
      after: 'Expands to show a member list with the head marked "Head", plus a search box to add more members.',
    },
    {
      target: 'org-dept-add-member',
      title: '+ Add member',
      purpose: 'Search by name or email and click a match to link that user to this department.',
      after: 'The user appears immediately in the member list above. Non-head members can be removed with the "Remove" link next to their name.',
    },
  ],
}

export default config
