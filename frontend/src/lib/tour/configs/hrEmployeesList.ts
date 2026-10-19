import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-employees-list',
  pageTitle: 'Employees',
  steps: [
    {
      target: 'hr-nav-employees',
      title: 'Employees tab',
      purpose: 'The employee master — every person who has a portal account, together with their HR profile (code, department, designation, plant, manager, joining date, status).',
      why: 'In an ERP the employee record is the single source every other HR process reads from: leave balances, attendance shifts, approvals routing (via reporting manager) and asset issue all depend on it being correct.',
    },
    {
      target: 'hr-emp-orgchart-btn',
      title: 'View Org Chart',
      purpose: 'Opens the reporting tree built from each employee\'s Reporting Manager field.',
      why: 'A quick way to spot people with the wrong manager — wrong managers mean leave and expense approvals go to the wrong person.',
    },
    {
      target: 'hr-emp-stats',
      title: 'Headcount cards',
      purpose: 'Active people = every active portal account. With HR profile = people whose HR record has been created. Profile missing = people who can log in but have no HR record yet.',
      after: 'Click a card to filter the list: "Profile missing" lists exactly the people HR still needs to set up.',
      why: 'Someone without an HR profile has no department, shift, manager or leave policy, so their leave/attendance cannot be processed properly.',
    },
    {
      target: 'hr-emp-search',
      title: 'Search',
      purpose: 'Finds people by name, email or employee code.',
      whatToEnter: 'Any part of the name, email or code. The list refreshes a moment after you stop typing.',
      validExample: 'PRT-0042 or "sharma"',
    },
    {
      target: 'hr-emp-dept-filter',
      title: 'Department filter',
      purpose: 'Shows only employees of one department (type to search the list).',
    },
    {
      target: 'hr-emp-desig-filter',
      title: 'Designation filter',
      purpose: 'Shows only employees holding one job title. Inactive designations are still listed (marked "inactive") so you can find people still carrying an old title.',
    },
    {
      target: 'hr-emp-plant-filter',
      title: 'Plant filter',
      purpose: 'Shows only employees posted at one plant / branch.',
    },
    {
      target: 'hr-emp-status-filter',
      title: 'Employment status filter',
      purpose: 'Filters by where the person is in their employment life.',
      options: [
        { value: 'Onboarding', meaning: 'Joining is in progress — documents, IT access and induction not yet complete.' },
        { value: 'Probation', meaning: 'Joined and working, but not yet confirmed. Usually 3–6 months.' },
        { value: 'Active', meaning: 'Confirmed, regular employee.' },
        { value: 'On Notice', meaning: 'Has resigned or been served notice; an exit is scheduled.' },
        { value: 'Exited', meaning: 'Has left the company. Record kept for history.' },
      ],
    },
    {
      target: 'hr-emp-type-filter',
      title: 'Employment type filter',
      purpose: 'Filters by the kind of contract the person is on.',
      options: [
        { value: 'Permanent', meaning: 'Regular on-roll employee.' },
        { value: 'Probation', meaning: 'On-roll, hired on probation terms.' },
        { value: 'Contract', meaning: 'Fixed-term or through a contractor.' },
        { value: 'Trainee', meaning: 'Under a training scheme (e.g. apprentice / GET).' },
        { value: 'Intern', meaning: 'Short-term student internship.' },
        { value: 'Consultant', meaning: 'External professional engaged on fees, not salary.' },
      ],
    },
    {
      target: 'hr-emp-profile-filter',
      title: 'Profile filter',
      purpose: 'Shows only people who have (or are missing) an HR profile.',
      options: [
        { value: 'Profile: any', meaning: 'Everyone.' },
        { value: 'Has HR profile', meaning: 'HR record already created.' },
        { value: 'Profile missing', meaning: 'Can log in but HR record not created yet — your to-do list.' },
      ],
    },
    {
      target: 'hr-emp-account-filter',
      title: 'Account filter',
      purpose: 'Portal login status of the person.',
      options: [
        { value: 'Active accounts', meaning: 'People who can currently log in (default).' },
        { value: 'Deactivated accounts', meaning: 'Logins switched off — usually people who have left. Shown faded in the list.' },
        { value: 'All accounts', meaning: 'Both of the above.' },
      ],
    },
    {
      target: 'hr-emp-clear-filters',
      title: 'Clear filters',
      purpose: 'Resets every filter and the search box back to the default view (active accounts, everyone).',
    },
    {
      target: 'hr-emp-table',
      title: 'Employee list',
      purpose: 'One row per person. Click a column heading (Employee, Code, Department, Designation, Plant, Joined, Status) to sort by it; click again to reverse the order. Click a row to open that employee\'s record.',
      after: 'Opens the employee page with Profile, Documents, Leave, Attendance, Assets and Lifecycle tabs.',
    },
    {
      target: 'hr-emp-status-badge',
      title: 'Status badge',
      purpose: 'The person\'s current employment status (Onboarding, Probation, Active, On Notice, Exited). "No HR profile" (orange) means HR has not created their record yet. "Account deactivated" underneath means they can no longer log in.',
      why: 'Status is not typed in by hand — it moves automatically when lifecycle events are completed (Joining → Probation, Confirmation → Active, Exit → Exited), so the history always explains the current status.',
    },
    {
      target: 'hr-emp-row-action',
      title: 'View / Create profile',
      purpose: '"View" opens the employee record. "Create profile" appears for people without an HR record and opens the profile form directly.',
    },
    {
      target: 'hr-emp-pagination',
      title: 'Pages',
      purpose: 'The list shows 50 people per page. Use Prev / Next to move between pages.',
    },
  ],
}

export default config
