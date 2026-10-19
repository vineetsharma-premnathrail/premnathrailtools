import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-my-attendance',
  pageTitle: 'My Attendance',
  steps: [
    {
      target: 'hr-myatt-today',
      title: 'Today',
      purpose: 'Your attendance for today: status, your shift timing with grace minutes, check-in and check-out times, and whether you were on time or late.',
      why: 'Late marks are counted against your shift start + grace minutes. If no shift is assigned, lateness is not calculated — HR sets the shift in your employee profile.',
    },
    {
      target: 'hr-myatt-punch',
      title: 'Check in / Check out',
      purpose: 'Records the time you start and finish work. Shows "Check in" in the morning, "Check out" once you have checked in, and "Done for today" after both. On approved leave days no button is shown.',
      after: 'The time is saved immediately and today\'s status becomes Present. The month calendar below updates too.',
    },
    {
      target: 'hr-myatt-correction-btn',
      title: 'Request correction',
      purpose: 'Use this when a day is wrong — you forgot to check in, were at a customer or vendor site, or worked from home.',
      after: 'A correction form opens on this page. Start the tour again while it is open for a field-by-field guide.',
      why: 'Employees cannot change their own attendance directly; a correction is a request that your manager approves, so the register stays trustworthy for payroll.',
    },
    {
      target: 'hr-myatt-month',
      title: 'Month and legend',
      purpose: 'Use the arrows to move between months. The legend counts how many days of each kind you have this month.',
      options: [
        { value: 'Present', meaning: 'Checked in (or marked present by HR).' },
        { value: 'Absent', meaning: 'A working day with no attendance and no approved leave.' },
        { value: 'Half day', meaning: 'Worked only half the day.' },
        { value: 'On leave', meaning: 'Covered by an approved leave request.' },
        { value: 'Holiday / Weekly off', meaning: 'Plant holiday or your weekly off — not a working day.' },
        { value: 'On duty', meaning: 'Working outside the office (site visit, vendor, customer) — counts as present.' },
        { value: 'Work from home', meaning: 'Worked remotely — counts as present.' },
        { value: 'Not marked', meaning: 'Nothing recorded yet for that day.' },
      ],
    },
    {
      target: 'hr-myatt-calendar',
      title: 'Month calendar',
      purpose: 'Each day shows its status and times. Click any past day (except leave days) to open a correction request pre-filled for that date.',
    },
    {
      target: 'hr-myatt-regs-table',
      title: 'My correction requests',
      purpose: 'Every correction you asked for, with the date, what you asked for, the times, reason and status.',
      options: [
        { value: 'Pending', meaning: 'Waiting for your manager / HR. You can still cancel it.' },
        { value: 'Approved', meaning: 'Accepted — that day in the register was changed as you asked.' },
        { value: 'Rejected', meaning: 'Not accepted; see the remark under the status. The day stays as it was.' },
        { value: 'Cancelled', meaning: 'You withdrew it.' },
      ],
    },
  ],
}

export default config
