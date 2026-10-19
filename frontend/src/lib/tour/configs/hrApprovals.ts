import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-approvals',
  pageTitle: 'Approvals',
  steps: [
    {
      target: 'hr-appr-header',
      title: 'Your approvals inbox',
      purpose: 'Everything waiting for YOUR decision in one place: leave, attendance corrections, travel requests, expense claims, and joining/exit checklist tasks assigned to you. Sections with nothing pending are hidden, so an empty page means you are all caught up.',
      why: 'Requests go to the employee\'s reporting manager. If an employee has no manager set, the request comes to HR instead (marked "No reporting manager — HR decides").',
    },
    {
      target: 'hr-appr-leave-section',
      title: 'Leave requests',
      purpose: 'Leave applied by your team: employee, leave type and request number, dates (with half-day marks), number of days, reason, contact number during leave, and any attachment such as a medical certificate.',
    },
    {
      target: 'hr-appr-leave-approve',
      title: 'Approve leave',
      purpose: 'Grants the leave. You can add optional remarks.',
      after: 'The days are deducted from the employee\'s balance, the dates show as "On leave" in attendance, and the employee is notified.',
    },
    {
      target: 'hr-appr-leave-reject',
      title: 'Reject leave',
      purpose: 'Refuses the leave. A reason is required so the employee knows what to change.',
      after: 'The held days return to their balance and the employee is notified with your reason.',
    },
    {
      target: 'hr-appr-reg-section',
      title: 'Attendance corrections',
      purpose: 'Requests to correct a day\'s attendance (forgot to punch, was on duty outside): date, what is recorded now, what they ask for, times and reason.',
    },
    {
      target: 'hr-appr-reg-approve',
      title: 'Approve / Reject correction',
      purpose: 'Approve overwrites that day\'s attendance with the requested status and times. Reject needs a reason and leaves attendance unchanged.',
      why: 'Attendance drives the payroll figures, so the employee cannot change it alone — a manager confirms it.',
    },
    {
      target: 'hr-appr-travel-section',
      title: 'Travel requests',
      purpose: 'Business trips your team wants to make: route, dates, purpose, mode of travel and estimated cost / advance asked.',
    },
    {
      target: 'hr-appr-travel-approve',
      title: 'Approve / Reject trip',
      purpose: 'Approve lets the trip go ahead (HR / admin then books tickets and pays any advance). Reject needs a reason so they can re-plan.',
    },
    {
      target: 'hr-appr-expense-section',
      title: 'Expense claims',
      purpose: 'Money your team spent on company work and wants back: claim title, number of lines, linked trip if any, and total amount. The header shows the total pending value.',
    },
    {
      target: 'hr-appr-expense-lines',
      title: 'Show lines & receipts',
      purpose: 'Opens each expense line — date, category, description, amount — with a link to view its receipt. Lines marked "Missing" need a receipt but have none.',
      why: 'Check receipts before approving: a claim without bills is the most common audit finding.',
    },
    {
      target: 'hr-appr-expense-approve',
      title: 'Approve / Reject claim',
      purpose: 'Approve confirms the amount is genuine. Reject asks for corrections (reason required) — the employee can fix and resubmit.',
      after: 'Approving does not pay the employee. HR records the payment separately after the money is actually paid.',
    },
    {
      target: 'hr-appr-checklist-section',
      title: 'Onboarding / offboarding tasks',
      purpose: 'Checklist tasks assigned to you for someone joining, leaving or transferring (e.g. create email ID, issue laptop, collect ID card). "Open" shows the full lifecycle event; "✓ Mark done" closes your task.',
    },
  ],
}

export default config
