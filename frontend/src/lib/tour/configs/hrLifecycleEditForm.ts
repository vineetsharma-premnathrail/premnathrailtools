import { TourConfig } from '../types'

// "Edit details" popup of a lifecycle event (same URL as the detail
// view; loaded when the edit popup's Save button is on screen).
const config: TourConfig = {
  id: 'hr-lifecycle-edit-form',
  pageTitle: 'Edit Lifecycle Event',
  steps: [
    {
      target: 'hr-lcd-edit-sheet',
      title: 'Editing the event',
      purpose: 'The event\'s details are open for correction. Only fields that apply to this event type are shown.',
      why: 'Fix mistakes here before the event is completed. Once completed, the values are applied to the profile and the event is locked.',
    },
    {
      target: 'hr-lcd-edit-candidate-name',
      title: 'Full name',
      purpose: 'Only for a Joining that is not yet linked to a portal user. Correct the joiner\'s name here.',
      validExample: 'Rakesh Kumar Yadav',
    },
    {
      target: 'hr-lcd-edit-candidate-email',
      title: 'Work email',
      purpose: 'The company email used later by "Find by email" to link the portal account.',
      validExample: 'rakesh.yadav@premnathrail.com',
    },
    {
      target: 'hr-lce-effective-date',
      title: 'Effective date',
      purpose: 'The date of joining, confirmation date, or effective-from date of the transfer or promotion.',
      whatToEnter: 'Pick the date from the calendar. It must match the letter issued to the employee.',
    },
    {
      target: 'hr-lce-department',
      title: 'Department',
      purpose: 'The new department, or "No change".',
    },
    {
      target: 'hr-lce-plant',
      title: 'Plant',
      purpose: 'The new plant or branch, or "No change".',
    },
    {
      target: 'hr-lce-designation',
      title: 'Designation',
      purpose: 'The new job title, or "No change".',
    },
    {
      target: 'hr-lce-grade',
      title: 'Grade',
      purpose: 'The new pay or seniority band, or "No change".',
    },
    {
      target: 'hr-lce-manager',
      title: 'Reporting manager',
      purpose: 'The new manager, or "No change".',
      why: 'The manager approves leave, attendance corrections and claims.',
    },
    {
      target: 'hr-lce-successor',
      title: 'Successor',
      purpose: 'Who takes over the old head slot or pending approvals when the event is completed. Leave it on "None" if not needed.',
    },
    {
      target: 'hr-lce-exit-type',
      title: 'Exit type',
      purpose: 'Resignation, Termination, Retirement, Absconding, Contract end or Death.',
    },
    {
      target: 'hr-lce-resignation-date',
      title: 'Resignation date',
      purpose: 'The date the resignation was submitted.',
    },
    {
      target: 'hr-lce-last-working-day',
      title: 'Last working day',
      purpose: 'The final working day.',
      required: true,
    },
    {
      target: 'hr-lce-notice-days',
      title: 'Notice (days)',
      purpose: 'The notice period in whole days.',
      validExample: '30',
    },
    {
      target: 'hr-lce-handover',
      title: 'Handover to',
      purpose: 'The successor who receives the leaver\'s work. It can also be chosen at completion.',
    },
    {
      target: 'hr-lce-exit-reason',
      title: 'Exit reason',
      purpose: 'Detailed reason for leaving. Only HR can see it.',
    },
    {
      target: 'hr-lce-remarks',
      title: 'Remarks',
      purpose: 'Internal notes about the event. Only HR can see them.',
    },
    {
      target: 'hr-lcd-edit-discard-btn',
      title: 'Discard',
      purpose: 'Closes the form without saving any changes.',
    },
    {
      target: 'hr-lcd-edit-save-btn',
      title: 'Save changes',
      purpose: 'Saves the corrected details.',
      after: 'The page returns to view mode with the new values. Nothing is applied to the employee profile until the event is completed.',
    },
  ],
}

export default config
