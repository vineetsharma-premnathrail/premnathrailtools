import { TourConfig } from '../types'

// The "Apply for leave" form — shown as a popup on My Leave after "+ Apply Leave",
// and on HR's Leave page after "+ Apply on behalf" + picking the employee.
const config: TourConfig = {
  id: 'hr-leave-apply-form',
  pageTitle: 'Apply for Leave',
  steps: [
    {
      target: 'hr-leave-form-type',
      title: 'Leave type',
      purpose: 'Which kind of leave this is. The list comes from HR Masters (for example Casual, Sick, Earned / Privilege, Leave Without Pay).',
      whatToEnter: 'Pick the leave type that matches the reason. Types marked "— unpaid" do not use any balance, but the days are unpaid.',
      required: true,
      options: [
        { value: 'Paid types (CL, SL, EL…)', meaning: 'Deducted from the yearly balance. You cannot take more days than the available balance.' },
        { value: '… — unpaid (e.g. LWP)', meaning: 'No balance needed, but the days are marked as unpaid leave for payroll.' },
      ],
      why: 'Each leave type has its own yearly quota and rules (half day allowed, notice needed, document needed after N days). Picking the right one keeps the balance and payroll correct.',
    },
    {
      target: 'hr-leave-form-from',
      title: 'From date',
      purpose: 'The first day away from work.',
      whatToEnter: 'Pick the first day of leave (DD-MM-YYYY).',
      required: true,
      validExample: '14-10-2026',
      after: 'As soon as a date is picked, the system works out how many working days this is (see the Days & Balance panel on the right of the popup).',
    },
    {
      target: 'hr-leave-form-from-session',
      title: 'Session (half day)',
      purpose: 'Lets you take only half a day.',
      options: [
        { value: 'Full day', meaning: 'Away the whole day.' },
        { value: 'First half', meaning: 'Away only in the morning half (single-day leave only).' },
        { value: 'Second half / From second half', meaning: 'Away from the afternoon — for a multi-day leave, you work the morning of the first day.' },
      ],
      why: 'Half days count as 0.5, so a doctor visit does not cost a full day of balance. Some leave types do not allow half days — then only Full day is offered.',
    },
    {
      target: 'hr-leave-form-to',
      title: 'To date',
      purpose: 'The last day of leave. Leave it blank for a single-day leave.',
      whatToEnter: 'Pick the last day away (same as or after the From date).',
      validExample: 'From 14-10-2026 to 16-10-2026',
      invalidExample: 'A To date before the From date',
    },
    {
      target: 'hr-leave-form-to-session',
      title: 'End session',
      purpose: 'Shown only for a multi-day leave. Choose "Till first half" if you come back to work in the afternoon of the last day.',
      options: [
        { value: 'Full day', meaning: 'Away the whole last day.' },
        { value: 'Till first half', meaning: 'Away only the morning of the last day; back at work in the afternoon.' },
      ],
    },
    {
      target: 'hr-leave-form-reason',
      title: 'Reason',
      purpose: 'Tells the approver why the leave is needed.',
      whatToEnter: 'A short, clear reason.',
      required: true,
      validExample: 'Family function in hometown',
      invalidExample: 'personal (too vague for the approver to judge)',
    },
    {
      target: 'hr-leave-form-contact',
      title: 'Contact during leave',
      purpose: 'Optional phone or email where the team can reach you in an emergency while you are away.',
      validExample: '98765 43210',
    },
    {
      target: 'hr-leave-form-document',
      title: 'Supporting document',
      purpose: 'Attach proof when the leave type asks for it — e.g. a medical certificate for sick leave longer than a few days. Images, PDF or Word.',
      why: 'Becomes mandatory (marked *) only when the leave type rule says so; otherwise optional.',
    },
    {
      target: 'hr-leave-form-preview',
      title: 'Day count preview',
      purpose: 'Shows how many leave days this request uses, the available balance, who will approve it, and which days in the range are not counted (weekly offs and plant holidays).',
      after: 'Any rule that is broken (not enough balance, overlapping leave, too little notice, document missing) is listed here in red, and Submit stays disabled until it is fixed.',
      why: 'Weekly offs and holidays are never deducted, so a Friday-to-Monday leave may cost only 2 days.',
    },
    {
      target: 'hr-leave-form-submit',
      title: 'Submit request',
      purpose: 'Sends the request for approval.',
      after: 'The request is saved as Pending and sent to the employee\'s reporting manager (or HR if no manager is set). The days show as "pending" in the balance until a decision is made. Approved leave is deducted from the balance and marked on the attendance register; a rejected request deducts nothing.',
    },
  ],
}

export default config
