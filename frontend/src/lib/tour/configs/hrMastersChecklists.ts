import { TourConfig } from '../types'
import { HR_MASTERS_INTRO } from './hrMastersShared'

const config: TourConfig = {
  id: 'hr-masters-checklists',
  pageTitle: 'HR Masters — Checklist Templates',
  steps: [
    ...HR_MASTERS_INTRO,
    {
      target: 'hr-mst-cl-types',
      title: 'Event type',
      purpose: 'Each lifecycle event type has its own template. Pick the type to see and edit its items.',
      options: [
        { value: 'Joining', meaning: 'Onboarding tasks, such as creating the email ID, issuing the ID card and PPE, induction, and PF/ESIC forms.' },
        { value: 'Confirmation', meaning: 'Tasks such as the probation review and the confirmation letter.' },
        { value: 'Transfer', meaning: 'Tasks such as changing access rights, handing over work, and moving the seat or plant.' },
        { value: 'Promotion', meaning: 'Tasks such as the promotion letter and new approval rights.' },
        { value: 'Exit', meaning: 'Offboarding tasks, such as returning the laptop and ID card, cutting email access, and the F&F settlement.' },
      ],
    },
    {
      target: 'hr-mst-cl-add-btn',
      title: '+ Add item',
      purpose: 'Adds a task to the template of the selected type.',
      after: 'A popup form opens. The next steps walk through it.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-mst-cl-category',
      title: 'Category',
      purpose: 'The team that owns the task. Items are grouped by category on each event.',
      options: [
        { value: 'HR', meaning: 'HR paperwork and letters.' },
        { value: 'IT', meaning: 'Email, laptop and system access.' },
        { value: 'Admin', meaning: 'ID card, seat, canteen and transport.' },
        { value: 'Finance', meaning: 'Bank account, advances and final settlement.' },
        { value: 'Manager', meaning: 'Tasks for the employee\'s manager. With no fixed owner, the task goes to the employee\'s (new) manager automatically.' },
        { value: 'Store', meaning: 'Tools, PPE and uniform issue or return.' },
      ],
    },
    {
      target: 'hr-mst-cl-title',
      title: 'Title',
      required: true,
      whatToEnter: 'A short action that starts with a verb.',
      validExample: 'Return ID / access card',
      invalidExample: 'ID card',
    },
    {
      target: 'hr-mst-cl-owner',
      title: 'Default owner',
      purpose: 'The person who normally does this task, for example the IT administrator for "Create email ID".',
      whatToEnter: 'Pick a person, or leave "No fixed owner" (HR then assigns the task on each event).',
      after: 'The owner is notified when an event starts and sees the task under "My checklist tasks".',
    },
    {
      target: 'hr-mst-cl-order',
      title: 'Order',
      purpose: 'The position in the checklist. Lower numbers show first. Leave it blank to add the item at the end.',
    },
    {
      target: 'hr-mst-cl-description',
      title: 'Description',
      purpose: 'Optional. Exactly what has to be checked.',
      validExample: 'Collect laptop, charger and bag; check the serial number against the asset register',
    },
    {
      target: 'hr-mst-cl-active',
      title: 'Active',
      purpose: 'Only active items are copied onto new events.',
    },
    {
      target: 'hr-mst-cl-save-btn',
      title: 'Save',
      purpose: 'Saves the template item.',
      after: 'Every new event of this type gets the item. Events already raised keep their own copy and are not changed.',
      why: 'Freezing a copy on each event keeps the history honest. Changing today\'s exit checklist does not rewrite last year\'s exits.',
    },
    {
      target: 'hr-mst-cl-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the popup without saving.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-mst-cl-table',
      title: 'Template items',
      purpose: 'The items for the selected event type in order, showing the category, title, default owner and status (Active or Inactive).',
    },
    {
      target: 'hr-mst-cl-row-actions',
      title: 'Row actions',
      purpose: 'Edit the item, Deactivate it to pause it without losing it, or Delete it.',
      after: 'Deleting only affects new events. Events already raised keep their copy.',
    },
  ],
}

export default config
