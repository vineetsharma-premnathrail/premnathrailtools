import { TourConfig } from '../types'

// HR's "employee · date" attendance edit modal (Daily register / Employee month).
const config: TourConfig = {
  id: 'hr-attendance-edit',
  pageTitle: 'Edit Attendance Day',
  steps: [
    {
      target: 'hr-att-edit-status',
      title: 'Status',
      purpose: 'What the employee\'s day was.',
      required: true,
      options: [
        { value: 'Present', meaning: 'Worked the full day.' },
        { value: 'Absent', meaning: 'Did not come and has no approved leave — unpaid day.' },
        { value: 'Half day', meaning: 'Worked only half the day.' },
        { value: 'On duty', meaning: 'Working outside the office (site, customer, vendor) — counts as present.' },
        { value: 'Work from home', meaning: 'Worked remotely — counts as present.' },
        { value: 'Holiday', meaning: 'Plant holiday for this employee.' },
        { value: 'Weekly off', meaning: 'Employee\'s weekly off day.' },
      ],
      why: 'Leave days cannot be set here — they come only from approved leave requests, so leave balances and attendance never disagree.',
    },
    {
      target: 'hr-att-edit-in',
      title: 'Check-in',
      purpose: 'Arrival time. Used for late marks against the employee\'s shift.',
      validExample: '09:12',
    },
    {
      target: 'hr-att-edit-out',
      title: 'Check-out',
      purpose: 'Leaving time.',
      validExample: '18:05',
    },
    {
      target: 'hr-att-edit-remarks',
      title: 'Remarks',
      purpose: 'Why HR changed or marked this day.',
      validExample: 'Biometric down; confirmed by supervisor',
    },
    {
      target: 'hr-att-edit-clear',
      title: 'Clear entry',
      purpose: 'Deletes the stored record for that day, so it goes back to "Not marked". Asks for confirmation.',
    },
    {
      target: 'hr-att-edit-save',
      title: 'Save',
      purpose: 'Stores the day as a manual HR entry.',
      after: 'The register and the employee\'s My Attendance calendar update straight away, and the monthly summary is recalculated.',
    },
  ],
}

export default config
