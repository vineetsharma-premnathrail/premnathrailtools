import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-org-chart',
  pageTitle: 'Org Chart',
  steps: [
    {
      target: 'hr-nav-org_chart',
      title: 'Org Chart tab',
      purpose: 'The company\'s reporting tree: who reports to whom. Every logged-in user can see it. It shows no personal data, only names, designations, departments and plants.',
      why: 'The tree is built from each person\'s Reporting Manager. That same field decides who approves their leave, attendance corrections and claims, so the chart is the easiest way to check that approvals will reach the right person.',
    },
    {
      target: 'hr-org-manage-btn',
      title: 'Manage Employees',
      purpose: 'HR only. Opens the Employees list, where you fix someone\'s Reporting Manager on their HR profile.',
    },
    {
      target: 'hr-org-search',
      title: 'Find a person',
      purpose: 'Highlights everyone whose name, designation or department matches, and opens the chain of managers above them.',
      whatToEnter: 'Any part of a name, title or department.',
      validExample: 'welder or "sharma"',
      after: 'Matches are highlighted in orange and a match count appears.',
    },
    {
      target: 'hr-org-dept-filter',
      title: 'Department filter',
      purpose: 'Shows only one department\'s people, together with the managers they report up to.',
    },
    {
      target: 'hr-org-expand-all',
      title: 'Expand all',
      purpose: 'Opens every team so the whole tree is visible.',
    },
    {
      target: 'hr-org-collapse-all',
      title: 'Collapse all',
      purpose: 'Folds the tree back to the top leaders only.',
    },
    {
      target: 'hr-org-clear',
      title: 'Clear',
      purpose: 'Shown while searching or filtering. Removes the search and the department filter.',
    },
    {
      target: 'hr-org-tree',
      title: 'Reporting tree',
      purpose: 'Each card is a person, showing their designation, department and plant. Click ▸ to open or ▾ to close their team. Your own card is tinted blue and marked "You".',
      after: 'HR users can click a name to open that person\'s employee record.',
    },
    {
      target: 'hr-org-team-count',
      title: 'Team size',
      purpose: '"5 direct" is the number of people reporting straight to this person. "· 23 total" includes everyone below them at every level.',
      why: 'Span of control (direct reports per manager) is a basic org-design check. One manager with 30 direct reports cannot approve everything on time.',
    },
    {
      target: 'hr-org-standalone',
      title: 'No reporting line',
      purpose: 'People who have no reporting manager and nobody reporting to them.',
      why: 'Their leave and claim approvals have no manager to go to. HR should set a Reporting Manager for each of them.',
    },
    {
      target: 'hr-org-standalone-toggle',
      title: 'Show / Hide',
      purpose: 'Shows or hides the list of people without a reporting line.',
    },
  ],
}

export default config
