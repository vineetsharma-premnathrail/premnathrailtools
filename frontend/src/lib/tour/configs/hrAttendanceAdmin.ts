import { TourConfig } from '../types'

const ATT_STATUS_OPTIONS = [
  { value: 'Present', meaning: 'Came to work for the full shift.' },
  { value: 'Absent', meaning: 'Did not come and has no approved leave — usually a loss-of-pay day for payroll.' },
  { value: 'Half day', meaning: 'Worked half the shift; counts as 0.5 present.' },
  { value: 'On leave', meaning: 'Covered by an approved leave request. Set automatically from Leave — cannot be edited here.' },
  { value: 'Holiday', meaning: 'A company holiday from the Holiday calendar.' },
  { value: 'Weekly off', meaning: 'The employee\'s weekly off day (e.g. Sunday) from their shift.' },
  { value: 'On duty', meaning: 'Working away from the plant on company work (customer site, vendor visit) — counts as present.' },
  { value: 'Work from home', meaning: 'Worked remotely — counts as present.' },
  { value: 'Not marked', meaning: 'Nothing recorded yet for a working day — needs to be marked.' },
]

const config: TourConfig = {
  id: 'hr-attendance-admin',
  pageTitle: 'Attendance (HR)',
  steps: [
    {
      target: 'hr-att-tab-register',
      title: 'Daily register',
      purpose: 'One day, every employee: who is present, absent, on leave or not marked yet.',
      autoActivate: true,
    },
    {
      target: 'hr-att-reg-date',
      title: 'Date',
      purpose: 'Which day the register shows. Defaults to today.',
    },
    {
      target: 'hr-att-plant-filter',
      title: 'Plant',
      purpose: 'Shows only employees of one plant (branch). Changing it resets the department filter.',
    },
    {
      target: 'hr-att-dept-filter',
      title: 'Department',
      purpose: 'Shows only employees of one department.',
    },
    {
      target: 'hr-att-search',
      title: 'Search',
      purpose: 'Finds an employee by name, email or employee code.',
    },
    {
      target: 'hr-att-status-filter',
      title: 'Status filter',
      purpose: 'Shows only employees with one attendance status for the day.',
      options: ATT_STATUS_OPTIONS,
    },
    {
      target: 'hr-att-reg-counts',
      title: 'Day counts',
      purpose: 'How many employees are in each status for this day. Click a chip to filter the table to that status; click again to clear.',
    },
    {
      target: 'hr-att-register-table',
      title: 'Register table',
      purpose: 'Each employee with department/plant, shift, status, check-in and check-out times and the Source of the entry.',
      options: [
        { value: 'Source: HR', meaning: 'Marked by HR on this page.' },
        { value: 'Source: Self', meaning: 'The employee checked in / out themselves.' },
        { value: 'Source: Correction', meaning: 'Set by an approved correction (regularization) request.' },
        { value: 'Source: Leave', meaning: 'Comes from an approved leave request.' },
        { value: 'Source: Import', meaning: 'Loaded from a biometric / CSV import.' },
      ],
      why: '"late Xm" in red means check-in was after the shift start plus grace time — used for discipline and late-coming reports.',
    },
    {
      target: 'hr-att-select-all',
      title: 'Select employees',
      purpose: 'Tick employees (or this box for all visible rows) to mark them in one go.',
      after: 'A bar appears above the table to mark all ticked employees with one status.',
    },
    {
      target: 'hr-att-bulk-bar',
      title: 'Bulk mark',
      purpose: 'Pick a status and press "Apply to N" to set it for every ticked employee on the chosen date. Anything already marked is replaced; employees on approved leave are skipped.',
    },
    {
      target: 'hr-att-status-badge',
      title: 'Status badge',
      purpose: 'A solid badge is a stored entry. A dashed, italic badge is worked out from the calendar (holiday, weekly off, not marked) — nothing is stored for that day yet.',
      options: ATT_STATUS_OPTIONS,
    },
    {
      target: 'hr-att-mark-btn',
      title: 'Mark / Edit',
      purpose: '"Mark" records attendance for a day with nothing stored; "Edit" changes an existing entry. Not shown for leave days — those change only by cancelling the leave.',
      after: 'A dialog opens with Status (required), Check-in and Check-out times (HH:MM) and Remarks. "Clear entry" removes a stored entry so the day falls back to the calendar.',
    },
    {
      target: 'hr-att-tab-month',
      title: 'Employee month',
      purpose: 'One employee\'s whole month as a calendar.',
      autoActivate: true,
    },
    {
      target: 'hr-att-month-employee',
      title: 'Employee',
      purpose: 'Pick whose month to see.',
      whatToEnter: 'Type a few letters of the name or code and choose from the list.',
    },
    {
      target: 'hr-att-month-picker',
      title: 'Month',
      purpose: 'Use ‹ and › to move to the previous or next month.',
    },
    {
      target: 'hr-att-legend',
      title: 'Legend & month counts',
      purpose: 'Colour key for each status, with the number of days in each this month, plus the number of late days.',
    },
    {
      target: 'hr-att-calendar',
      title: 'Calendar',
      purpose: 'Each day shows its status, holiday name and in/out times. Click any day (except leave days) to mark or correct it.',
    },
    {
      target: 'hr-att-tab-summary',
      title: 'Monthly summary',
      purpose: 'Totals per employee for a month — the figures payroll needs.',
      autoActivate: true,
    },
    {
      target: 'hr-att-export-btn',
      title: 'Export CSV',
      purpose: 'Downloads the summary for the selected month and filters as a CSV file.',
      why: 'Payroll is run in ADP, not in this portal — this file is what you hand over for salary processing.',
    },
    {
      target: 'hr-att-summary-table',
      title: 'Summary table',
      purpose: 'Day counts per status for each employee. Click a row to open that employee\'s month calendar.',
      why: '"Present eq." (present equivalent) = Present + On duty + WFH + half of Half days. It is the number of paid working days to share with payroll. "Not marked" days in orange must be fixed before month close.',
    },
    {
      target: 'hr-att-tab-import',
      title: 'Import',
      purpose: 'Loads attendance in bulk from a CSV file, e.g. a biometric machine export.',
      autoActivate: true,
    },
    {
      target: 'hr-att-import-template-btn',
      title: 'Download template',
      purpose: 'Gets a CSV with the correct column headings to fill in.',
      whatToEnter: 'Columns: email or employee_code, date (YYYY-MM-DD or DD-MM-YYYY), status (present/absent/half_day/on_duty/work_from_home/holiday/weekly_off or P, A, HD, OD, WFH, H, WO), optional check_in, check_out (HH:MM) and remarks.',
      validExample: 'E0123, 05-10-2026, P, 09:02, 17:45',
      invalidExample: 'E0123, 5/10, Present (date format and status code not recognised)',
    },
    {
      target: 'hr-att-validate-btn',
      title: 'Validate',
      purpose: 'After choosing the CSV file in the picker next to it, checks every row without saving anything.',
      after: 'Shows how many rows would be created or updated and lists each problem row with the reason, so you can fix the file first.',
    },
    {
      target: 'hr-att-import-btn',
      title: 'Import',
      purpose: 'Saves the file\'s rows. Existing days are overwritten; days on approved leave are never changed.',
      after: 'A message shows how many rows were created and updated; any skipped rows are listed below with the reason.',
    },
    {
      target: 'hr-att-tab-corrections',
      title: 'Corrections',
      purpose: 'Requests from employees to correct a day\'s attendance (forgot to punch, was on duty outside). Also called regularization.',
      autoActivate: true,
    },
    {
      target: 'hr-att-corr-status-filter',
      title: 'Status filter',
      options: [
        { value: 'Pending', meaning: 'Waiting for the approver.' },
        { value: 'Approved', meaning: 'Accepted — the day\'s attendance was updated (source "Correction").' },
        { value: 'Rejected', meaning: 'Refused with a reason; attendance unchanged.' },
        { value: 'Cancelled', meaning: 'Withdrawn by the employee.' },
      ],
    },
    {
      target: 'hr-att-corr-table',
      title: 'Correction requests',
      purpose: 'Each request with the employee and their approver, the date, what is recorded now, what they ask for, times and reason. Approve / Reject appear at the end of the row when you are allowed to decide.',
      why: 'Corrections need approval so attendance (and therefore pay) cannot be changed by the employee alone. Rejecting needs a reason.',
    },
  ],
}

export default config
