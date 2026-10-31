import { TourConfig, TourStep } from '../types'
import activityConfig from './crmActivityForm'
import momExportConfig from './crmMomExport'
import torDialogConfig from './crmTorDialog'
import { followUpListSteps } from './crmFollowUpList'

const steps: TourStep[] = [
  {
    target: 'tender-stage-progress',
    title: 'Stage progress',
    purpose: 'Shows where this tender sits in the bidding pipeline — click to expand the full stage list and move it to a later stage. Moving a stage needs the Move pipeline stage permission in your role.',
    why: 'Stages only move forward, with a confirmation, and each move is recorded on the Timeline. Only an admin can move a stage back, and must give a reason.',
    options: [{ value: 'Green circle', meaning: 'Completed stage' }, { value: 'Orange circle', meaning: 'Current stage' }, { value: 'Grey circle', meaning: 'Upcoming stage' }],
  },
  {
    target: 'tender-tab-Info',
    title: 'Info',
    purpose: 'Read-only summary of the tender\'s core details and its linked customer organization — click Edit (top right) to change any of it. The Customer Organization / Contact Person cards and the Tender Value show only if your role includes them.',
    autoActivate: true,
  },
  {
    target: 'tender-revision-selector',
    title: 'Revision (Current ▾)',
    purpose: 'Only appears once the tender\'s details have been edited at least once. Switch between "Current" and a past revision to see the details exactly as they were at that point, plus what changed.',
  },
  {
    target: 'tender-info-view',
    title: 'Tender Details / Customer Organization',
    purpose: 'Every core field entered when this tender was created/edited, laid out for quick reference.',
  },
  {
    target: 'tnd-info-current-status',
    title: 'Current Status',
    purpose: 'A free-text running note on where things stand right now — separate from the fixed Status value below.',
    after: 'Edit it from the Edit form (top right) or the New Tender form — every change is recorded on the Timeline.',
  },
  {
    target: 'tnd-info-status',
    title: 'Status (quick edit)',
    purpose: 'Change the tender\'s status directly from here without opening the full Edit form.',
    why: 'This is a quick lead-info toggle — changing it does not count as editing the requirement, so it won\'t re-arm the "Send Technical Requirement" button. Every status change is recorded on the Timeline.',
  },
  {
    target: 'tender-tab-Dates',
    title: 'Dates',
    purpose: 'Every milestone date for this tender — publish, document download, pre-bid meeting, submission, technical/financial opening, expected award — in one table. Shown only if your role includes Inquiries & Tenders › Tender dates.',
    autoActivate: true,
  },
  {
    target: 'tender-dates-table',
    title: 'Milestone dates',
    purpose: 'A dash means that date hasn\'t been entered yet — edit the tender to fill it in.',
  },
  {
    target: 'tender-rnd-status',
    title: 'R&D ID, revision and status',
    purpose: 'Appears once the requirement has been sent to R&D: its R&D ID (RDR-year-number), the current revision (R0, R1, …) and where R&D\'s review stands — Awaiting R&D review, Accepted, R&D asked for details (the question is shown on the card — update the requirement and send it again), Responded or Superseded (older requirements may also show Returned to BD).',
    why: 'Each send is a new revision with its own ID. There is no Discussion channel any more — the return reason is how R&D asks for corrections.',
  },
  {
    target: 'crm-rnd-resend-btn',
    title: 'Re-send to R&D',
    purpose: 'Shown on the card when R&D returned the requirement. Opens the same send dialog as "Send Technical Requirement to R&D"; your re-send becomes the next revision and goes back to R&D for review. Never opened by the tour.',
    why: 'Available as soon as R&D has returned it, even before you edit the tender, because the fix may be in a document.',
  },
  {
    target: 'tender-tab-Technical Offers',
    title: 'Technical Offers',
    purpose: 'The offers you can quote: the ones R&D released, and the ones you upload yourself. Shown only if your role includes Inquiries & Tenders › Technical Offers (BD upload).',
    autoActivate: true,
  },
  {
    target: 'crm-bd-offer-upload-btn',
    title: 'Upload Technical Offer (BD)',
    purpose: 'Upload your own offer — a Word (.docx) or PDF file with a title and an offer date. It needs no R&D requirement and is quotable at once; the quotation shows "Uploaded by BD, not reviewed by R&D".',
    whatToEnter: 'Title, offer date, optional notes, and the file. Only .docx or .pdf.',
    after: 'You can delete a BD offer only while no quotation uses it.',
  },
  {
    target: 'crm-bd-offers-table',
    title: 'Offer list',
    purpose: 'Offer number, title, who it is from (R&D released or BD upload), date, file, and the quotations that use it.',
  },
  {
    target: 'tender-tab-Documents',
    title: 'Documents',
    purpose: 'Files attached to this tender, split into Client Documents (received from the tendering authority) and Internal Documents (your own working files). Shown only if your role includes Inquiries & Tenders › Documents.',
    autoActivate: true,
  },
  {
    target: 'tender-docs-client',
    title: 'Client Documents',
    purpose: 'Documents the tendering authority issued — the tender notice, corrigenda, etc.',
    after: 'Pick a category, then choose a file to upload — large files (up to 100 GB) stream straight to SharePoint with progress shown; click a filename to open it (very large files open via a direct SharePoint link). Deleting is admin-only.',
  },
  {
    target: 'tender-docs-internal',
    title: 'Internal Documents',
    purpose: 'Your own working files for this tender — draft bids, internal notes, calculations.',
    after: 'Pick a category, then choose a file to upload — large files (up to 100 GB) stream straight to SharePoint with progress shown; click a filename to open it (very large files open via a direct SharePoint link). Deleting is admin-only.',
  },
  {
    target: 'tender-tab-Follow Ups',
    title: 'Follow Ups',
    purpose: 'Every call, email, meeting or site visit logged against this tender, most recent first. Log new ones here with "+ Add Follow Up". Shown only if your role includes Inquiries & Tenders › Follow-ups.',
    why: 'A tender is won by steady follow-up with the tendering authority: pre-bid queries, clarifications, document submission. A logged trail means nothing is forgotten when people change.',
    autoActivate: true,
  },
  // Existing rows and the MOM export first (rows are hidden while the add
  // form is open), then "+ Add Follow Up" and the shared form field steps.
  ...followUpListSteps('tender'),
  ...momExportConfig.steps,
  ...activityConfig.steps.slice(1),
  {
    target: 'tender-tab-Timeline',
    title: 'Timeline',
    purpose: 'A merged, chronological history of everything that happened to this tender — creation, field edits, stage changes, follow-ups, and Technical Offer emails — all in one feed. Shown only if your role includes Inquiries & Tenders › Timeline.',
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
    title: 'Send Technical Requirement to R&D',
    purpose: 'Sends R&D the Customer Organization, Project, and Product Requirement details, and puts it in the R&D team queue with a Response Due Date and your remarks. The first send creates the R&D ID and revision R0; every later send is the next revision. Shown only to roles with Send Technical Requirement (TOR) to R&D.',
    why: 'Disabled once already sent — you\'d need to edit the tender before sending again (or R&D to return it), to avoid firing off duplicate requests for the same version of the details.',
    after: 'Click it yourself: set the due date, remarks and reference documents and send — the tour won\'t open it for you. If you open it now, press Next for a walkthrough of the dialog.',
  },
  ...torDialogConfig.steps,
  {
    target: 'tender-back-btn',
    title: '← Back',
    purpose: 'Returns to the page you came from: the Inquiries & Tenders list, or the customer organization\'s page if you opened this tender from there.',
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
