import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-department',
  pageTitle: 'Department',
  steps: [
    {
      target: 'org-dept-add-btn',
      title: '+ Add Department',
      purpose: 'Manually create a department that Azure AD sync didn\'t already populate — most departments are auto-created from Azure AD on sign-in and admin Azure sync.',
      after: 'Opens the Add Department dialog (the tour opens it for you when you click Next).',
      autoActivateOnAdvance: true,
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
      why: 'Departments drive approvals and reporting — the Head of Department is who the department\'s requests escalate to.',
    },
    {
      target: 'org-dept-cancel',
      title: 'Cancel',
      purpose: 'Closes the dialog without creating anything. (The tour closes it for you when you click Next, so the table behind it is visible.)',
      autoActivateOnAdvance: true,
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
      after: 'Expands to show a member list with the head marked "Head", plus an Add member button. The tour expands the first row for you when you click Next.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'org-dept-add-member',
      title: '+ Add member',
      purpose: 'Opens the Add member popup: search by name or email and click a match to link that user to this department.',
      after: 'Each person you click is saved at once and appears in the member list; click Done to close the popup. Non-head members can be removed with the "Remove" link next to their name.',
    },
  ],
}

export default config
