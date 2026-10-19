import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-leave-admin',
  pageTitle: 'Leave (HR)',
  steps: [
    {
      target: 'hr-leave-tab-requests',
      title: 'Requests tab',
      purpose: 'Every leave request raised by any employee, whether still waiting, approved, rejected or cancelled.',
      autoActivate: true,
    },
    {
      target: 'hr-leave-apply-behalf-btn',
      title: '+ Apply on behalf',
      purpose: 'Raises a leave request for an employee who cannot do it themselves (no login, on the shop floor, sick at home).',
      after: 'A popup with an Employee picker opens. Once you pick the employee, the normal leave form opens in the popup (leave type, dates, half-day, reason, attachment). The request still goes to that employee\'s reporting manager for approval — applying on behalf does not approve it.',
      why: 'Keeps every absence on record even for workers without a computer, so attendance and leave balances stay correct.',
    },
    {
      target: 'hr-leave-search',
      title: 'Search',
      purpose: 'Finds requests by employee name, employee code or request number.',
      validExample: 'LV-2026-0042 or Ramesh',
    },
    {
      target: 'hr-leave-status-filter',
      title: 'Status filter',
      purpose: 'Shows only requests in one status. Opens on Pending so you see what still needs a decision first.',
      options: [
        { value: 'All statuses', meaning: 'Every request regardless of status.' },
        { value: 'Pending', meaning: 'Waiting for the approver\'s decision. Days are held as "Pending" in the balance.' },
        { value: 'Approved', meaning: 'Leave granted — days are deducted from the balance and the dates show as leave in attendance.' },
        { value: 'Rejected', meaning: 'Approver said no; days go back to the balance.' },
        { value: 'Cancelled', meaning: 'Withdrawn by the employee or HR; any held or used days are returned.' },
      ],
    },
    {
      target: 'hr-leave-type-filter',
      title: 'Leave type filter',
      purpose: 'Shows only one kind of leave (e.g. Casual, Sick, Earned). Leave types are set up in HR → Masters.',
    },
    {
      target: 'hr-leave-date-from',
      title: 'From date',
      purpose: 'Shows requests whose leave dates fall on or after this date.',
    },
    {
      target: 'hr-leave-date-to',
      title: 'To date',
      purpose: 'Shows requests whose leave dates fall on or before this date. Use "Clear dates" to remove both.',
    },
    {
      target: 'hr-leave-requests-table',
      title: 'Requests table',
      purpose: 'One row per request: request number and raised date, employee with code and department, leave type and reason, dates (with half-day marks), number of days, status, and who must decide (or who decided, with remarks).',
      why: 'If the Approver column shows "HR (no manager)" the employee has no reporting manager set — fix that in the employee record so future requests route correctly.',
    },
    {
      target: 'hr-leave-status-badge',
      title: 'Status badge',
      options: [
        { value: 'Pending', meaning: 'Waiting for a decision.' },
        { value: 'Approved', meaning: 'Granted and deducted from balance.' },
        { value: 'Rejected', meaning: 'Refused, with the reason in the decision column.' },
        { value: 'Cancelled', meaning: 'Withdrawn; days returned to the balance.' },
      ],
    },
    {
      target: 'hr-leave-row-actions',
      title: 'Row actions',
      purpose: 'File opens the attached document (e.g. medical certificate). Approve / Reject appear only if you are allowed to decide this request. Cancel appears where the request can still be withdrawn.',
      after: 'A dialog asks for remarks. Rejecting needs a reason so the employee knows what to change. Cancelling an approved leave returns the days to the balance. The employee is notified of every decision.',
    },
    {
      target: 'hr-leave-tab-balances',
      title: 'Balances tab',
      purpose: 'How many days of each leave type every employee has for a year.',
      autoActivate: true,
    },
    {
      target: 'hr-leave-allot-btn',
      title: 'Allot year',
      purpose: 'Gives every active employee their annual quota for the chosen year in one go, and brings forward unused days for carry-forward types (up to the type\'s cap).',
      after: 'A dialog asks for the year, which leave types (none ticked = all), and whether to pro-rate for people who join mid-year. After you confirm it shows how many balances were created, updated, unchanged or skipped.',
      why: 'Running it again is safe — manual adjustments and days already used are never touched. Do it once at the start of each year and again after quotas change.',
    },
    {
      target: 'hr-leave-adjust-btn',
      title: 'Adjust balance',
      purpose: 'Adds or deducts days for one employee and one leave type — e.g. a comp-off for Sunday work, or correcting a wrong opening balance.',
      whatToEnter: 'Employee, leave type, year, days (positive to add, negative to deduct, in steps of 0.5) and a reason.',
      validExample: '+1 — Comp-off for Sunday dispatch work',
      invalidExample: '0.3 (only whole or half days allowed)',
      after: 'The reason is kept in the audit log and sent to the employee; the new available balance shows straight away.',
    },
    {
      target: 'hr-leave-bal-year',
      title: 'Year',
      purpose: 'Which calendar year\'s balances to show.',
    },
    {
      target: 'hr-leave-bal-type',
      title: 'Leave type filter',
      purpose: 'Shows balances for one leave type only.',
    },
    {
      target: 'hr-leave-bal-search',
      title: 'Search employee',
      purpose: 'Finds one employee\'s balances by name or code.',
    },
    {
      target: 'hr-leave-balances-table',
      title: 'Balances table',
      purpose: 'Per employee and leave type: Carried (from last year), Allotted (this year\'s quota), Adjusted (manual +/-), Used (approved leave), Pending (requested, not yet decided) and Available = Carried + Allotted + Adjusted − Used − Pending.',
      why: 'Pending days are held back so an employee cannot apply for the same days twice before the first request is decided. Unpaid leave types show "—" because they have no limit.',
    },
    {
      target: 'hr-leave-bal-adjust-link',
      title: 'Adjust (row)',
      purpose: 'Same as "Adjust balance" but with the employee, leave type and year already filled in from this row.',
    },
  ],
}

export default config
