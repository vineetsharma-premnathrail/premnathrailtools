import { TourConfig } from '../types'

export const HR_TRAVEL_STATUS_OPTIONS = [
  { value: 'Pending', meaning: 'Raised and waiting for the reporting manager (or HR) to decide.' },
  { value: 'Approved', meaning: 'Trip allowed — tickets / stay / advance can be arranged.' },
  { value: 'Rejected', meaning: 'Not allowed; the reason is shown under the approver.' },
  { value: 'Cancelled', meaning: 'Withdrawn by the employee before travelling.' },
  { value: 'Completed', meaning: 'Trip is over and closed. It can still be linked to an expense claim.' },
]

export const HR_CLAIM_STATUS_OPTIONS = [
  { value: 'Draft', meaning: 'Being prepared by the employee — private to them until submitted.' },
  { value: 'Submitted', meaning: 'Sent for approval; waiting for the manager (or HR).' },
  { value: 'Approved', meaning: 'Amount accepted — now owed to the employee, waiting for payment.' },
  { value: 'Rejected', meaning: 'Sent back with a reason; the employee can correct and resubmit.' },
  { value: 'Paid', meaning: 'Money paid to the employee; the payment reference is recorded.' },
  { value: 'Cancelled', meaning: 'Withdrawn by the employee.' },
]

const config: TourConfig = {
  id: 'hr-travel-admin',
  pageTitle: 'Travel & Claims (HR)',
  steps: [
    {
      target: 'hr-travel-tab-travel',
      title: 'Travel requests tab',
      purpose: 'Every employee\'s business-trip requests. Managers also see their own team\'s requests under Approvals.',
      autoActivate: true,
      why: 'Approving travel before the trip controls cost — tickets and advances are only arranged for approved trips.',
    },
    {
      target: 'hr-travel-search',
      title: 'Search',
      purpose: 'On Travel: finds by request number, employee, city or purpose. On Claims: by claim number, employee, title or payment reference.',
    },
    {
      target: 'hr-travel-status-filter',
      title: 'Travel status',
      options: HR_TRAVEL_STATUS_OPTIONS,
    },
    {
      target: 'hr-travel-date-from',
      title: 'From date',
      purpose: 'On Travel this filters by departure date; on Claims by claim date.',
    },
    {
      target: 'hr-travel-date-to',
      title: 'To date',
      purpose: 'End of the date range. "Clear filters" resets everything.',
    },
    {
      target: 'hr-travel-table',
      title: 'Travel requests',
      purpose: 'Request number, employee, route and purpose, dates, travel mode (with "+ stay" if a hotel is needed), estimated cost and advance asked, approver (or who decided, with remarks) and status.',
      why: '"HR (no manager)" means the employee has no reporting manager — any HR user decides. Set the manager in the employee record to route future requests properly.',
    },
    {
      target: 'hr-travel-status-badge',
      title: 'Travel status',
      options: HR_TRAVEL_STATUS_OPTIONS,
    },
    {
      target: 'hr-travel-row-actions',
      title: 'Approve / Reject / Mark completed',
      purpose: 'Approve and Reject appear only where you may decide (reject needs a reason so they can re-plan). "Mark completed" closes an approved trip once it is over.',
      after: 'The employee is notified of the decision.',
    },
    {
      target: 'hr-travel-tab-claims',
      title: 'Expense claims tab',
      purpose: 'Every submitted expense claim — money employees spent on company work and want reimbursed. Drafts stay private until submitted.',
      autoActivate: true,
    },
    {
      target: 'hr-claims-status-filter',
      title: 'Claim status',
      options: HR_CLAIM_STATUS_OPTIONS.filter((o) => o.value !== 'Draft'),
    },
    {
      target: 'hr-claims-stats',
      title: 'Totals',
      purpose: 'Money awaiting approval, approved but not yet paid (what the company owes employees), and already paid — for the claims currently listed.',
      why: '"Approved — to pay" is a liability: accounts should clear it regularly so employees are not out of pocket.',
    },
    {
      target: 'hr-claims-table',
      title: 'Claims',
      purpose: 'Claim number, employee, title and number of lines, claim date, linked trip, amount, approver and status. Click a row to open the claim.',
    },
    {
      target: 'hr-claims-status-badge',
      title: 'Claim status',
      purpose: 'Paid claims also show the payment reference underneath.',
      options: HR_CLAIM_STATUS_OPTIONS,
    },
    {
      target: 'hr-claims-open-link',
      title: 'View / Review / Record payment',
      purpose: '"Review" when you can approve or reject it, "Record payment" when it is approved and waiting to be paid, otherwise "View".',
    },
  ],
}

export default config
