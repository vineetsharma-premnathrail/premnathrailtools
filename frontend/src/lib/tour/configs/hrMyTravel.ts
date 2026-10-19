import { TourConfig } from '../types'

export const HR_TRAVEL_STATUS_OPTIONS = [
  { value: 'Pending', meaning: 'Waiting for the reporting manager (or HR). The traveller can still edit or cancel it.' },
  { value: 'Approved', meaning: 'Trip is approved — book tickets and travel. Expenses can now be claimed against it.' },
  { value: 'Rejected', meaning: 'Not approved; the approver\'s remark explains why.' },
  { value: 'Cancelled', meaning: 'Withdrawn before or after approval; the approver is told.' },
  { value: 'Completed', meaning: 'Trip is over and closed by HR. Expenses can still be claimed against it.' },
]

const config: TourConfig = {
  id: 'hr-my-travel',
  pageTitle: 'My Travel',
  steps: [
    {
      target: 'hr-me-tab-travel',
      title: 'Travel tab',
      purpose: 'Your business-trip requests. Approval comes before the trip; the money you spend is claimed afterwards under Expense Claims.',
      why: 'Pre-approval controls travel cost before it is spent (and lets accounts plan any advance), instead of finding out only when the bills arrive.',
    },
    {
      target: 'hr-mytravel-new-btn',
      title: '+ New Travel Request',
      purpose: 'Opens the travel request form: purpose, from / to city, dates, mode, estimated cost, advance needed, project reference and whether you need a hotel.',
      after: 'The request goes to your reporting manager (or HR if you have none) as Pending. Start the tour again while the form is open for a field-by-field guide.',
    },
    {
      target: 'hr-mytravel-status-filter',
      title: 'Status filter',
      purpose: 'Shows only requests in one status.',
      options: HR_TRAVEL_STATUS_OPTIONS,
    },
    {
      target: 'hr-mytravel-table',
      title: 'My travel requests',
      purpose: 'Each request with its route and purpose, dates, mode, estimated cost and advance, approver (with their remark) and status.',
      after: 'Row actions: "Edit" while it is still pending; "Claim expenses" once approved or completed (takes you to Expense Claims, where you link the claim to this trip); "Cancel" to withdraw it with an optional reason.',
    },
  ],
}

export default config
