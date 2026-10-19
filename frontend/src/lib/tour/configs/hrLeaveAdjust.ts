import { TourConfig } from '../types'

// "Adjust leave balance" modal on HR Leave → Balances.
const config: TourConfig = {
  id: 'hr-leave-adjust',
  pageTitle: 'Adjust Leave Balance',
  steps: [
    {
      target: 'hr-leave-adjust-employee',
      title: 'Employee',
      purpose: 'Whose balance to change. (Hidden when you opened the adjustment from a specific balance row.)',
      required: true,
    },
    {
      target: 'hr-leave-adjust-type',
      title: 'Leave type',
      purpose: 'Which balance to change.',
      required: true,
    },
    {
      target: 'hr-leave-adjust-year',
      title: 'Year',
      purpose: 'The leave year of the balance.',
    },
    {
      target: 'hr-leave-adjust-days',
      title: 'Days (+/-)',
      purpose: 'Days to add (positive) or take away (negative). Half days allowed.',
      required: true,
      validExample: '1 (comp-off granted) or -0.5 (correction)',
      invalidExample: '0',
      why: 'Adjustments are kept separate from the allotted quota, so re-running "Allot" never wipes them out.',
    },
    {
      target: 'hr-leave-adjust-reason',
      title: 'Reason',
      purpose: 'Why the balance is being changed.',
      required: true,
      validExample: 'Comp-off for Sunday dispatch work on 05-10-2026',
      why: 'The reason goes to the audit log and to the employee, so every manual change to leave can be explained later.',
    },
    {
      target: 'hr-leave-adjust-save',
      title: 'Save adjustment',
      purpose: 'Applies the change.',
      after: 'The employee\'s available balance changes immediately and they are notified with your reason.',
    },
  ],
}

export default config
