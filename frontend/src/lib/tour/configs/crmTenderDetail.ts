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
    why: 'Stages only move forward, with a confirmation, and each move is recorded on the Timeline. Only an admin can move a stage back, and must give a reason. Once a sales order is raised from it, the stage is locked until that order is cancelled in Sales.',
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
    target: 'tender-tab-Discussion',
    title: 'Discussion',
    purpose: 'A chat shared with the R&D team about this requirement — the tab appears only after you click "Send Technical Requirement to R&D". Type @ (or use Tag people) to tag someone — they get a notification; attach files that both teams can open. "Attach files" asks whether to upload a new file or pick a Client / Internal document already uploaded on this record. The Files view lists every file shared, who sent it and when. Your role decides whether you see this tab and whether you can post (Discussion with R&D › Create).',
    autoActivate: true,
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
    purpose: 'Emails R&D a PDF summarizing the Customer Organization, Project, and Product Requirement details, and puts it in the R&D team queue with a Response Due Date and your remarks — any R&D user can answer. Shown only to roles with Send Technical Requirement (TOR) to R&D.',
    why: 'Disabled once already sent — you\'d need to edit the tender before sending again, to avoid firing off duplicate requests for the same version of the details.',
    after: 'Click it yourself: first create the Technical Offer Word document, then set the due date, remarks and reference documents and send — the tour won\'t open it for you. If you open it now, press Next for a walkthrough of the dialog.',
  },
  ...torDialogConfig.steps,
  {
    // Only rendered for Sales-app users on a tender with LOA / Order Received (or one with an SO) — the tour skips it otherwise.
    target: 'tender-create-so-btn',
    title: 'Create Sales Order',
    purpose: 'Hands the awarded tender over to Sales: opens a new Sales Order pre-filled with this customer, the LOA number (entered as the PO number), the purchase person name and the contract value. Once an order exists, this becomes a green chip showing the SO number and status — click it to open the order.',
    why: 'One live sales order per tender, so the same LOA can\'t be booked twice. Shown only to people with the Sales app, and only once the tender status is "LOA / Order Received".',
    after: 'When Sales confirms the order (after its approvals), this tender is automatically set to Status "Closed – Ordered" and Stage "Awarded / Lost", and the timeline records which SO closed it.',
  },
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
