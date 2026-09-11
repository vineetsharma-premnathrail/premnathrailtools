import { TourConfig, TourStep } from '../types'

const steps: TourStep[] = [
  {
    target: 'tender-stage-progress',
    title: 'Stage progress',
    purpose: 'Shows where this tender sits in the bidding pipeline — click to expand the full stage list and jump to a different stage.',
    why: 'Moving to a stage other than the current one asks for confirmation first, and is recorded on the Timeline.',
    options: [{ value: 'Green circle', meaning: 'Completed stage' }, { value: 'Orange circle', meaning: 'Current stage' }, { value: 'Grey circle', meaning: 'Upcoming stage' }],
  },
  {
    target: 'tender-tab-Info',
    title: 'Info',
    purpose: 'Read-only summary of the tender\'s core details and its linked organization — click Edit (top right) to change any of it.',
    autoActivate: true,
  },
  {
    target: 'tender-revision-selector',
    title: 'Revision (Current ▾)',
    purpose: 'Only appears once the tender\'s details have been edited at least once. Switch between "Current" and a past revision to see the details exactly as they were at that point, plus what changed.',
  },
  {
    target: 'tender-info-view',
    title: 'Tender Details / Organization',
    purpose: 'Every core field entered when this tender was created/edited, laid out for quick reference.',
  },
  {
    target: 'tender-tab-Dates',
    title: 'Dates',
    purpose: 'Every milestone date for this tender — publish, document download, pre-bid meeting, submission, technical/financial opening, expected award — in one table.',
    autoActivate: true,
  },
  {
    target: 'tender-dates-table',
    title: 'Milestone dates',
    purpose: 'A dash means that date hasn\'t been entered yet — edit the tender to fill it in.',
  },
  {
    target: 'tender-tab-Documents',
    title: 'Documents',
    purpose: 'Files attached to this tender, split into Client Documents (received from the tendering authority) and Internal Documents (your own working files).',
    autoActivate: true,
  },
  {
    target: 'tender-docs-client',
    title: 'Client Documents',
    purpose: 'Documents the tendering authority issued — the tender notice, corrigenda, etc.',
    after: 'Pick a category, then choose a file to upload; click a filename to open it. Deleting is admin-only.',
  },
  {
    target: 'tender-docs-internal',
    title: 'Internal Documents',
    purpose: 'Your own working files for this tender — draft bids, internal notes, calculations.',
    after: 'Pick a category, then choose a file to upload; click a filename to open it. Deleting is admin-only.',
  },
  {
    target: 'tender-tab-Follow Ups',
    title: 'Follow Ups',
    purpose: 'Every call, email, or site visit logged against this tender, most recent first. This list is view-only here — follow-ups for a tender are logged from elsewhere, not added on this page.',
    autoActivate: true,
  },
  {
    target: 'tender-followups-list',
    title: 'Follow-up entries',
    purpose: 'Click "View" on any entry to see its full remarks and details in a popup.',
  },
  {
    target: 'tender-followup-change-status-btn',
    title: 'Change Status',
    purpose: 'Set this follow-up\'s own status — Open, Closed, or Hold — directly from the list, without opening Edit.',
    why: 'Only a follow-up left as "Open" counts toward the "Open/Overdue Follow-ups" figures on the CRM Dashboard and the Follow-ups page\'s "Open" bucket.',
  },
  {
    target: 'tender-tab-Timeline',
    title: 'Timeline',
    purpose: 'A merged, chronological history of everything that happened to this tender — creation, field edits, stage changes, follow-ups, and Technical Offer emails — all in one feed.',
    autoActivate: true,
  },
  {
    target: 'tender-timeline-list',
    title: 'Timeline entries',
    purpose: 'Each entry is tagged (Created, Updated, Stage, Follow Up, Email Sent, etc.) with who did it and when.',
  },
  {
    // Unlike "+ Add Contact"/"+ Add Inquiry" etc., this button is a real,
    // consequential send action (emails R&D), not just a toggle that reveals
    // an inline section — so the tour never clicks it, on arrival or on
    // advance. It only opens a picker dialog (the actual email only goes out
    // once the user picks documents and clicks Send inside it themselves),
    // but that distinction isn't obvious from outside, and the user should
    // always be the one who decides to open it.
    target: 'tender-tor-btn',
    title: 'Send Technical Offer Request to R&D',
    purpose: 'Emails R&D a PDF summarizing the Organization, Project, and Product Requirement details, so they can prepare a technical offer.',
    why: 'Disabled once already sent — you\'d need to edit the tender before sending again, to avoid firing off duplicate requests for the same version of the details.',
    after: 'Click it yourself to see the reference-document picker and Send/Cancel options — the tour won\'t open it for you.',
  },
  {
    target: 'tender-delete-btn',
    title: 'Delete',
    purpose: 'Admin-only. Permanently deletes this tender.',
    why: 'This cannot be undone — a confirmation dialog appears before anything is actually deleted.',
  },
  {
    // Kept as a plain informational step, not autoActivateOnAdvance — this
    // tour is view-only. Clicking Edit switches the Info tab into the full
    // Tender form, which has its own separate tour (start the tour again
    // once the form is open) rather than continuing this one, so a viewer
    // who never opens the form never sees steps for fields they can't see.
    target: 'tender-edit-btn',
    title: 'Edit',
    purpose: 'Switches the Info tab into the full Tender form, pre-filled with this tender\'s current values.',
    after: 'Click it yourself, then start the tour again for a field-by-field walkthrough of the edit form.',
  },
]

const config: TourConfig = {
  id: 'crm-tender-detail',
  pageTitle: 'Tender Detail',
  steps,
}

export default config
