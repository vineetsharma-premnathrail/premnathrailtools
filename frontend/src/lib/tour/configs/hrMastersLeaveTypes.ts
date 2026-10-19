import { TourConfig } from '../types'
import { HR_MASTERS_INTRO } from './hrMastersShared'

const config: TourConfig = {
  id: 'hr-masters-leave-types',
  pageTitle: 'HR Masters — Leave Types',
  steps: [
    ...HR_MASTERS_INTRO,
    {
      target: 'hr-mst-search',
      title: 'Search',
      purpose: 'Filters leave types by code or name as you type.',
    },
    {
      target: 'hr-mst-show-inactive',
      title: 'Show inactive',
      purpose: 'Includes leave types that are switched off (shown faded).',
    },
    {
      target: 'hr-mst-add-btn',
      title: '+ Add Leave Type',
      purpose: 'Creates a new leave type with its rules.',
      after: 'Opens the leave policy form. The next steps walk through it.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-mst-lt-code',
      title: 'Code',
      required: true,
      whatToEnter: 'A short code, up to 20 characters, converted to capitals.',
      validExample: 'CL, SL, EL, LWP',
    },
    {
      target: 'hr-mst-lt-name',
      title: 'Name',
      required: true,
      validExample: 'Casual Leave',
    },
    {
      target: 'hr-mst-lt-quota',
      title: 'Annual quota',
      purpose: 'How many days each active employee gets per year when HR uses "Allot year" on the Leave page.',
      whatToEnter: '0 to 365, in steps of 0.5. Unpaid leave must be 0.',
      validExample: '12',
      invalidExample: '7.3 (only whole or half days)',
    },
    {
      target: 'hr-mst-lt-order',
      title: 'Order',
      purpose: 'The position of this type in drop-downs and balance cards. Lower numbers show first.',
      validExample: '1',
    },
    {
      target: 'hr-mst-lt-flags',
      title: 'Paid / Half days / Carry forward',
      purpose: 'The core rules of the leave type.',
      options: [
        { value: 'Paid', meaning: 'The employee\'s balance is checked and reduced. Untick it for Leave Without Pay, which needs no balance.' },
        { value: 'Half days allowed', meaning: 'Employees can apply for half a day. Untick it for types taken only in full days.' },
        { value: 'Carry forward', meaning: 'Unused days move to the next year, up to the maximum below. Typical for Earned Leave, not for Casual Leave.' },
      ],
      why: 'These follow the company\'s leave policy and Indian practice: Casual Leave lapses at year end, while Earned or Privilege Leave usually accumulates up to a cap.',
    },
    {
      target: 'hr-mst-lt-max-cf',
      title: 'Max carry forward',
      required: true,
      purpose: 'Shown only when Carry forward is ticked. The most days that can move to the next year.',
      validExample: '30',
      invalidExample: '0 (untick Carry forward instead)',
    },
    {
      target: 'hr-mst-lt-doc-after',
      title: 'Document after (days)',
      purpose: 'A request longer than this many days must have a supporting document attached.',
      whatToEnter: 'A whole number, or leave it blank if no document is ever needed.',
      validExample: '2 → Sick Leave of 3+ days needs a medical certificate',
    },
    {
      target: 'hr-mst-lt-max-stretch',
      title: 'Max days at a stretch',
      purpose: 'The longest single request allowed for this type.',
      whatToEnter: 'A whole number, or blank for no limit.',
      validExample: '3 for Casual Leave',
    },
    {
      target: 'hr-mst-lt-gender',
      title: 'Only for',
      purpose: 'Restricts who can apply for this type.',
      options: [
        { value: 'Everyone', meaning: 'All employees.' },
        { value: 'Female employees', meaning: 'For example, Maternity Leave.' },
        { value: 'Male employees', meaning: 'For example, Paternity Leave.' },
      ],
    },
    {
      target: 'hr-mst-lt-active',
      title: 'Active',
      purpose: 'Inactive types cannot be applied for and are skipped by "Allot year". Existing balances and requests are kept.',
    },
    {
      target: 'hr-mst-lt-save-btn',
      title: 'Save Leave Type',
      purpose: 'Saves the policy.',
      after: 'It applies to new leave requests straight away. Use "Allot year" on the Leave page to give everyone the quota.',
    },
    {
      target: 'hr-mst-lt-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the form without saving.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-mst-lt-table',
      title: 'Leave types list',
      purpose: 'Each type with its yearly quota, Paid or Unpaid, a summary of its rules (carry forward cap, full days only, document after N days, maximum stretch, gender), and status.',
    },
    {
      target: 'hr-mst-lt-row-actions',
      title: 'Row actions',
      purpose: 'Edit the policy, or Deactivate or Activate it. Leave types cannot be deleted, because past leave records refer to them.',
    },
  ],
}

export default config
