import { TourConfig, TourStep } from '../types'
import quotationConfig from './crmQuotationForm'
import activityConfig from './crmActivityForm'

// The Inquiry detail page has five tabs (Info, Quotations, Documents, Follow
// Ups, Timeline) all on one route. Each tab step below has `autoActivate:
// true`, so the tour switches tabs on the page's own behalf as it reaches
// them — otherwise a tab's content only exists once a user manually clicks
// it, and every one of its steps would silently auto-skip first.
const steps: TourStep[] = [
  {
    target: 'inq-stage-progress',
    title: 'Stage progress',
    purpose: 'Shows where this inquiry sits in the sales pipeline — click to expand the full stage list and jump to a different stage.',
    why: 'Moving to a stage other than the current one asks for confirmation first, and is recorded on the Timeline.',
    options: [{ value: 'Green circle', meaning: 'Completed stage' }, { value: 'Orange circle', meaning: 'Current stage' }, { value: 'Grey circle', meaning: 'Upcoming stage' }],
  },
  {
    target: 'inquiry-tab-Info',
    title: 'Info',
    purpose: 'A read-only summary of the inquiry\'s organization/contact, lead info, and full product requirement — click Edit (top right) to change any of it.',
    autoActivate: true,
  },
  {
    target: 'inq-revision-selector',
    title: 'Revision (Current ▾)',
    purpose: 'Only appears once the product requirement has been edited at least once. Switch between "Current" and a past revision to see the requirement exactly as it was at that point, plus what changed.',
  },
  {
    target: 'inq-info-view',
    title: 'Organization / Lead Info / Product Requirement',
    purpose: 'Every field entered when this inquiry was created/edited, laid out for quick reference. If a spec revision is selected (via the badge next to the Info tab), a "What changed" summary appears at the top.',
  },
  {
    target: 'inq-info-status',
    title: 'Status (quick edit)',
    purpose: 'Change the inquiry\'s status directly from here without opening the full Edit form.',
    why: 'This is a quick lead-info toggle — changing it does not count as editing the requirement, so it won\'t re-arm the "Send Technical Offer Request" button.',
  },
  {
    target: 'inq-info-priority',
    title: 'Priority (quick edit)',
    purpose: 'Change the inquiry\'s priority directly from here without opening the full Edit form.',
  },
  ...quotationConfig.steps,
  {
    target: 'inquiry-tab-Documents',
    title: 'Documents',
    purpose: 'Files attached to this inquiry, split into Client Documents (received from the customer) and Internal Documents (your own working files).',
    autoActivate: true,
  },
  {
    target: 'inq-docs-client',
    title: 'Client Documents',
    purpose: 'Documents the customer sent — RFQs, drawings, specifications.',
    after: 'Pick a category, then choose a file to upload; click a filename to open it. Deleting is admin-only.',
  },
  {
    target: 'inq-docs-internal',
    title: 'Internal Documents',
    purpose: 'Your own working files for this inquiry — internal notes, calculations, draft quotations.',
    after: 'Pick a category, then choose a file to upload; click a filename to open it. Deleting is admin-only.',
  },
  ...activityConfig.steps,
  {
    target: 'inquiry-tab-Timeline',
    title: 'Timeline',
    purpose: 'A merged, chronological history of everything that happened to this inquiry — creation, field edits, stage changes, follow-ups, quotations, and Technical Offer emails — all in one feed.',
    autoActivate: true,
  },
  {
    target: 'inq-timeline-list',
    title: 'Timeline entries',
    purpose: 'Each entry is tagged (Created, Updated, Stage, Follow Up, Quotation, Email Sent, etc.) with who did it and when.',
  },
  {
    // Unlike "+ Add Contact"/"+ Add Inquiry" etc., this button is a real,
    // consequential send action (emails R&D), not just a toggle that reveals
    // an inline section — so the tour never clicks it, on arrival or on
    // advance. It only opens a picker dialog (the actual email only goes out
    // once the user picks documents and clicks Send inside it themselves),
    // but that distinction isn't obvious from outside, and the user should
    // always be the one who decides to open it.
    target: 'inq-tor-btn',
    title: 'Send Technical Offer Request to R&D',
    purpose: 'Emails R&D a PDF summarizing the Organization, Project, and Product Requirement details, so they can prepare a technical offer.',
    why: 'Blocked if Product, Category, Quantity, or a Specification/Requirement isn\'t filled in yet — otherwise R&D would get an effectively empty document. Disabled once already sent, until the requirement is edited again.',
    after: 'Click it yourself to see the reference-document picker and Send/Cancel options — the tour won\'t open it for you.',
  },
  {
    target: 'inq-delete-btn',
    title: 'Delete',
    purpose: 'Admin-only. Permanently deletes this inquiry.',
    why: 'This cannot be undone — a confirmation dialog appears before anything is actually deleted.',
  },
  {
    // Kept as a plain informational step, not autoActivateOnAdvance — this
    // tour is view-only. Clicking Edit switches the Info tab into the full
    // Inquiry form, which has its own separate tour (start the tour again
    // once the form is open) rather than continuing this one, so a viewer
    // who never opens the form never sees steps for fields they can't see.
    target: 'inq-edit-btn',
    title: 'Edit',
    purpose: 'Switches the Info tab into the full Inquiry form, pre-filled with this inquiry\'s current values.',
    after: 'Click it yourself, then start the tour again for a field-by-field walkthrough of the edit form.',
  },
]

const config: TourConfig = {
  id: 'crm-inquiry-detail-page',
  pageTitle: 'Inquiry Detail',
  steps,
}

export default config
