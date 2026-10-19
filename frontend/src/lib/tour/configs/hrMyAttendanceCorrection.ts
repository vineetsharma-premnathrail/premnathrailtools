import { TourConfig } from '../types'

// My Attendance with the "Request an attendance correction" popup open.
const config: TourConfig = {
  id: 'hr-my-attendance-correction',
  pageTitle: 'Attendance Correction',
  steps: [
    {
      target: 'hr-myatt-reg-date',
      title: 'Date',
      purpose: 'The day whose attendance is wrong.',
      whatToEnter: 'Pick a date within the last 60 days, not in the future.',
      required: true,
      validExample: '03-10-2026',
      invalidExample: 'A date more than 60 days ago, or tomorrow',
    },
    {
      target: 'hr-myatt-reg-status',
      title: 'Correct status',
      purpose: 'What that day should have been.',
      required: true,
      options: [
        { value: 'Present', meaning: 'You were at work but the punch is missing or wrong.' },
        { value: 'Half day', meaning: 'You worked only half the day.' },
        { value: 'On duty (outside office)', meaning: 'You were working away from the office — site, customer, vendor, bank.' },
        { value: 'Work from home', meaning: 'You worked remotely with approval.' },
      ],
      why: 'Leave is not requested here — for a day off, apply leave from My Leave so the balance is deducted correctly.',
    },
    {
      target: 'hr-myatt-reg-in',
      title: 'Check-in time',
      purpose: 'The time you actually started work.',
      whatToEnter: 'Time in 24-hour or AM/PM format, as your browser shows it.',
      required: true,
      validExample: '09:05',
      why: 'Required for Present and Half day, because late marks are worked out from this time.',
    },
    {
      target: 'hr-myatt-reg-out',
      title: 'Check-out time',
      purpose: 'The time you actually finished work. Optional.',
      validExample: '18:10',
    },
    {
      target: 'hr-myatt-reg-reason',
      title: 'Reason',
      purpose: 'Tells your approver what happened.',
      required: true,
      validExample: 'Forgot to check in; was at vendor site from 9 AM',
      invalidExample: 'correction',
    },
    {
      target: 'hr-myatt-reg-submit',
      title: 'Submit request',
      purpose: 'Sends the correction for approval.',
      after: 'A request number is created and sent to your reporting manager (or HR if none). It appears under "My correction requests" as Pending. Once approved, that day in the register is changed automatically.',
    },
  ],
}

export default config
