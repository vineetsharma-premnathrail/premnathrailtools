import { TourStep } from '../types'

// Steps for the follow-up list rows on the Inquiry and Tender detail pages'
// "Follow Ups" tab. The row buttons share data-tour names (only one detail
// panel is ever on screen); the list and Change Status targets differ.
export function followUpListSteps(kind: 'inquiry' | 'tender'): TourStep[] {
  const listTarget = kind === 'inquiry' ? 'inq-followups-list' : 'tender-followups-list'
  const statusTarget = kind === 'inquiry' ? 'inq-followup-change-status-btn' : 'tender-followup-change-status-btn'
  return [
    {
      target: listTarget,
      title: 'Follow-up entries',
      purpose: `Every call, email, meeting or site visit logged against this ${kind}, newest first. Each row shows the type, contact person, remarks and the next follow-up due date ("To Be Decided" if none was set).`,
    },
    {
      target: 'activity-row-view-btn',
      title: 'View',
      purpose: 'Opens the full follow-up (remarks, action plan, attachments) in a read-only popup.',
    },
    {
      target: 'activity-row-edit-btn',
      title: 'Edit',
      purpose: 'Opens this follow-up in the form above so you can correct or add to it.',
    },
    {
      target: statusTarget,
      title: 'Change Status',
      purpose: 'Sets this follow-up\'s own status directly from the list.',
      options: [
        { value: 'Open', meaning: 'Still needs action. It counts in the Open/Overdue figures on the CRM Dashboard and Follow-ups page.' },
        { value: 'Closed', meaning: 'Done. Nothing more is expected from this follow-up.' },
        { value: 'Hold', meaning: 'Paused, for example while the customer is waiting on their own approval. It is not counted as open.' },
      ],
      why: 'Closing finished follow-ups keeps the overdue list honest, so the team chases only what is really pending.',
    },
    {
      target: 'activity-row-export-mom-btn',
      title: 'Export MoM (single)',
      purpose: 'Downloads a Minutes of Meeting document for just this one follow-up.',
    },
    {
      target: 'activity-row-delete-btn',
      title: 'Delete',
      purpose: 'Shown only to admins and to the person who logged the follow-up. Deletes it after a confirmation dialog.',
      why: 'This cannot be undone. Prefer setting the status to Closed so the history is kept.',
    },
  ]
}
