import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-dashboard',
  pageTitle: 'HR Dashboard',
  steps: [
    {
      target: 'hr-nav-dashboard',
      title: 'HR module',
      purpose: 'The HR & Administration module. These tabs cover the whole employee journey, from joining to exit. This Dashboard is the HR team\'s daily overview.',
      why: 'The portal handles HR operations: employee records, leave, attendance, lifecycle events and admin services. Salary processing stays in ADP. The portal supplies ADP with clean attendance and leave data.',
    },
    {
      target: 'hr-nav-me',
      title: 'My HR',
      purpose: 'Self-service for every employee: their own profile, leave balance and applications, attendance, travel, claims and assets.',
    },
    {
      target: 'hr-nav-approvals',
      title: 'Approvals',
      purpose: 'Requests waiting for your decision as a manager or as HR: leave, attendance corrections, travel and expense claims. Your lifecycle checklist tasks also appear here.',
    },
    {
      target: 'hr-nav-employees',
      title: 'Employees',
      purpose: 'The employee master: one HR profile per person, with code, department, designation, grade, plant, shift and manager.',
    },
    {
      target: 'hr-nav-org_chart',
      title: 'Org Chart',
      purpose: 'The reporting tree, built from each person\'s Reporting Manager.',
    },
    {
      target: 'hr-nav-lifecycle',
      title: 'Lifecycle',
      purpose: 'Joining, Confirmation, Transfer, Promotion and Exit events, each with its checklist.',
    },
    {
      target: 'hr-nav-leave',
      title: 'Leave',
      purpose: 'HR\'s leave administration: the yearly allotment, balances and every leave request.',
    },
    {
      target: 'hr-nav-attendance',
      title: 'Attendance',
      purpose: 'The daily attendance register and attendance corrections (regularisation).',
    },
    {
      target: 'hr-nav-holidays',
      title: 'Holidays',
      purpose: 'The holiday calendar for each plant.',
    },
    {
      target: 'hr-nav-assets',
      title: 'Assets',
      purpose: 'Company assets issued to employees, such as laptops, phones, tools and SIMs.',
    },
    {
      target: 'hr-nav-visitors',
      title: 'Visitors',
      purpose: 'The gate visitor register: expected visitors, check-in and check-out, and badges.',
    },
    {
      target: 'hr-nav-travel',
      title: 'Travel & Claims',
      purpose: 'Travel requests and expense claims, from approval through to payment.',
    },
    {
      target: 'hr-nav-masters',
      title: 'Masters',
      purpose: 'HR reference lists: designations, grades, shifts, leave types and checklist templates.',
    },
    {
      target: 'hr-nav-bell',
      title: 'Notifications',
      purpose: 'HR alerts such as new requests, approvals and checklist tasks assigned to you.',
    },
    {
      target: 'hr-dash-refresh-btn',
      title: '↻ Refresh',
      purpose: 'Reloads every number on this page. The figures are as of the moment the page loaded (IST).',
    },
    {
      target: 'hr-dash-missing-profiles',
      title: 'Missing HR profiles warning',
      purpose: 'Shown when some people can log in but have no HR profile yet.',
      why: 'Without a profile their department, plant, shift and probation are not tracked, so their leave and attendance cannot be handled properly.',
      after: 'Use the Create profiles button to open Employees and create the missing profiles.',
    },
    {
      target: 'hr-dash-kpis',
      title: 'Key numbers',
      purpose: 'The numbers that need action first: pending approvals, attendance today, expiring documents and probation ending. A tile is tinted only when its number needs action (amber soon, red now).',
      after: 'Click a tile to open the screen behind the number.',
    },
    {
      target: 'hr-dash-tile-headcount',
      title: 'Headcount',
      purpose: 'Active employees who have not exited.',
    },
    {
      target: 'hr-dash-tile-attendance',
      title: 'Attendance today',
      purpose: 'Present out of headcount, with the number absent and the number not yet marked.',
      why: 'The tile turns amber while some people are "not marked". Every day must be closed (present, absent, leave or holiday) before the month\'s attendance goes to ADP payroll.',
    },
    {
      target: 'hr-dash-tile-approvals',
      title: 'Pending approvals',
      purpose: 'All open leave, attendance-correction, travel and expense requests. "No manager, HR decides" counts requests from people without a reporting manager, which come to HR.',
    },
    {
      target: 'hr-dash-tile-documents',
      title: 'Documents expiring',
      purpose: 'Employee documents (such as a driving licence, passport or medical fitness certificate) that expire within 30 days, plus any already expired.',
      why: 'An expired licence or fitness certificate can make it illegal for that person to do their job, for example driving or crane operation.',
    },
    {
      target: 'hr-dash-tile-probation',
      title: 'Probation ending',
      purpose: 'Probation periods ending in the next 30 days. The tile turns red when some are already past their end date.',
      why: 'Every probationer needs a decision on time: confirm them or extend probation. An overdue probation leaves the employee\'s status unclear.',
    },
    {
      target: 'hr-dash-more-toggle',
      title: 'More numbers',
      purpose: 'Opens the less urgent numbers: joiners and exits this month, on leave today, open lifecycle tasks, assets issued, visitors inside and claims to pay.',
    },
    {
      target: 'hr-dash-card-approvals',
      title: 'Pending approvals by type',
      purpose: 'Pending count for each request type. The red number is requests waiting on HR because the employee has no manager.',
      after: 'Click "View" to go to that queue.',
    },
    {
      target: 'hr-dash-card-on-leave',
      title: 'On leave today',
      purpose: 'Who is on approved leave today. Click a row to open the employee.',
    },
    {
      target: 'hr-dash-card-attendance',
      title: 'Today\'s attendance',
      purpose: 'Today\'s attendance split by status: Present, Absent, Half day, On leave, Holiday, Weekly off, On duty, WFH and Not marked.',
    },
    {
      target: 'hr-dash-card-lifecycle',
      title: 'Open lifecycle events',
      purpose: 'Each open event with its due date and checklist progress (done / total). Click a row to open it.',
    },
    {
      target: 'hr-dash-card-movements',
      title: 'Joiners and exits this month',
      purpose: 'Names behind the joiner and exit counts. "Joining (pending)" and "Exit scheduled" mean the event is not completed yet.',
    },
    {
      target: 'hr-dash-card-status',
      title: 'Headcount by status',
      purpose: 'Active employees split by employment status.',
      options: [
        { value: 'Onboarding', meaning: 'Joining in progress.' },
        { value: 'Probation', meaning: 'Joined, not yet confirmed.' },
        { value: 'Active', meaning: 'Confirmed employee.' },
        { value: 'On notice', meaning: 'Resigned or notice served; exit scheduled.' },
        { value: 'No HR profile', meaning: 'Has a login but no HR record yet.' },
      ],
    },
    {
      target: 'hr-dash-card-dept',
      title: 'Headcount by department',
      purpose: 'How many people each department has, largest first.',
    },
    {
      target: 'hr-dash-card-plant',
      title: 'Headcount by plant',
      purpose: 'How many people are posted at each plant.',
    },
    {
      target: 'hr-dash-card-probation',
      title: 'Probation ending list',
      purpose: 'Who is due for confirmation and how many days are left. Red means overdue.',
      after: 'Record a Confirmation event under Lifecycle, or extend the end date on the profile.',
    },
    {
      target: 'hr-dash-card-documents',
      title: 'Documents expiring list',
      purpose: 'Which document of which employee expires, and when.',
      after: 'Open the employee and upload the renewed copy in their Documents tab.',
    },
    {
      target: 'hr-dash-card-visitors',
      title: 'Visitors inside now',
      purpose: 'Visitors currently checked in, with their host, check-in time and badge number.',
      why: 'In an emergency evacuation this is the list used to make sure every visitor is out.',
    },
    {
      target: 'hr-dash-card-assets',
      title: 'Assets',
      purpose: 'Assets by status: Issued, In stock, Under repair, Lost or Retired. A red note warns when exited or deactivated people still hold company assets.',
    },
  ],
}

export default config
