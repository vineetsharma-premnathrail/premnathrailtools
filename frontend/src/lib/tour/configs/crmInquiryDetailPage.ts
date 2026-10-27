import { TourConfig, TourStep } from '../types'
import quotationConfig from './crmQuotationForm'
import activityConfig from './crmActivityForm'
import momExportConfig from './crmMomExport'
import torDialogConfig from './crmTorDialog'
import { followUpListSteps } from './crmFollowUpList'

// The Inquiry detail page has six tabs (Info, Discussion, Documents,
// Quotations, Follow Ups, Timeline) all on one route. Each tab step below has `autoActivate:
// true`, so the tour switches tabs on the page's own behalf as it reaches
// them — otherwise a tab's content only exists once a user manually clicks
// it, and every one of its steps would silently auto-skip first.
const steps: TourStep[] = [
  {
    target: 'inq-stage-progress',
    title: 'Stage progress',
    purpose: 'Shows where this inquiry sits in the sales pipeline — click to expand the full stage list and move it to a later stage. Moving a stage needs the Move pipeline stage permission in your role.',
    why: 'Stages only move forward, with a confirmation, and each move is recorded on the Timeline. Only an admin can move a stage back, and must give a reason. Once a sales order is raised from it, the stage is locked until that order is cancelled in Sales.',
    options: [{ value: 'Green circle', meaning: 'Completed stage' }, { value: 'Orange circle', meaning: 'Current stage' }, { value: 'Grey circle', meaning: 'Upcoming stage' }],
  },
  {
    target: 'inquiry-tab-Info',
    title: 'Info',
    purpose: 'A read-only summary of the inquiry\'s customer organization/contact, lead info, and full product requirement — click Edit (top right) to change any of it. The Customer Organization & contact card and money values (Expected Value) show only if your role includes them.',
    autoActivate: true,
  },
  {
    target: 'inq-revision-selector',
    title: 'Revision (Current ▾)',
    purpose: 'Only appears once the product requirement has been edited at least once. Switch between "Current" and a past revision to see the requirement exactly as it was at that point, plus what changed.',
  },
  {
    target: 'inq-info-view',
    title: 'Customer Organization / Lead Info / Product Requirement',
    purpose: 'Every field entered when this inquiry was created/edited, laid out for quick reference. If a spec revision is selected (via the badge next to the Info tab), a "What changed" summary appears at the top.',
  },
  {
    target: 'inq-info-current-status',
    title: 'Current Status',
    purpose: 'A free-text running note on where things stand right now — separate from the fixed Status/Priority values below.',
    after: 'Edit it from the Edit form (top right) or the New Inquiry form — every change is recorded on the Timeline.',
  },
  {
    target: 'inq-info-status',
    title: 'Status (quick edit)',
    purpose: 'Change the inquiry\'s status directly from here without opening the full Edit form.',
    why: 'This is a quick lead-info toggle — changing it does not count as editing the requirement, so it won\'t re-arm the "Send Technical Requirement" button.',
  },
  {
    target: 'inq-info-priority',
    title: 'Customer Requirement Priority (quick edit)',
    purpose: 'Change the inquiry\'s priority directly from here without opening the full Edit form.',
  },
  ...quotationConfig.steps,
  {
    target: 'inquiry-tab-Discussion',
    title: 'Discussion',
    purpose: 'A chat shared with the R&D team about this requirement — the tab appears only after you click "Send Technical Requirement to R&D". Type @ (or use Tag people) to tag someone — they get a notification; attach files that both teams can open. "Attach files" asks whether to upload a new file or pick a Client / Internal document already uploaded on this record. The Files view lists every file shared, who sent it and when. Your role decides whether you see this tab and whether you can post (Discussion with R&D › Create); without posting you can only read.',
    autoActivate: true,
  },
  {
    target: 'inquiry-tab-Documents',
    title: 'Documents',
    purpose: 'Files attached to this inquiry, split into Client Documents (received from the customer) and Internal Documents (your own working files). Shown only if your role includes Inquiries & Tenders › Documents.',
    autoActivate: true,
  },
  {
    target: 'inq-docs-client',
    title: 'Client Documents',
    purpose: 'Documents the customer sent — RFQs, drawings, specifications.',
    after: 'Pick a category, then choose a file to upload — large files (up to 100 GB) stream straight to SharePoint with progress shown; click a filename to open it (very large files open via a direct SharePoint link). Deleting is admin-only.',
  },
  {
    target: 'inq-docs-internal',
    title: 'Internal Documents',
    purpose: 'Your own working files for this inquiry — internal notes, calculations, draft quotations.',
    after: 'Pick a category, then choose a file to upload — large files (up to 100 GB) stream straight to SharePoint with progress shown; click a filename to open it (very large files open via a direct SharePoint link). Deleting is admin-only.',
  },
  // Follow Ups: the tab, then the existing rows and the MOM export while the
  // add form is still closed (rows are hidden while it is open), then
  // "+ Add Follow Up" and the form's own fields.
  activityConfig.steps[0],
  ...followUpListSteps('inquiry'),
  ...momExportConfig.steps,
  ...activityConfig.steps.slice(1),
  {
    target: 'inquiry-tab-Timeline',
    title: 'Timeline',
    purpose: 'A merged, chronological history of everything that happened to this inquiry — creation, field edits, stage changes, follow-ups, quotations, and Technical Offer emails — all in one feed. Shown only if your role includes Inquiries & Tenders › Timeline.',
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
    title: 'Send Technical Requirement to R&D',
    purpose: 'Emails R&D a PDF summarizing the Customer Organization, Project, and Product Requirement details, and puts it in the R&D team queue with a Response Due Date and your remarks — any R&D user can answer. Shown only to roles with Send Technical Requirement (TOR) to R&D.',
    why: 'Blocked until Product and at least one of Specification/Requirement Description are filled in — otherwise R&D would get an effectively empty document. Disabled once already sent, until the requirement is edited again.',
    after: 'Click it yourself: first create the Technical Offer Word document, then set the due date, remarks and reference documents and send — the tour won\'t open it for you. If you open it now, press Next for a walkthrough of the dialog.',
  },
  ...torDialogConfig.steps,
  {
    // Only rendered for Sales-app users on an inquiry at stage Order Received (or one with an SO) — the tour skips it otherwise.
    target: 'inq-create-so-btn',
    title: 'Create Sales Order',
    purpose: 'Hands the won inquiry over to Sales: opens a new Sales Order pre-filled with this customer and the accepted quotation\'s lines, prices and payment terms. Once an order exists, this becomes a green chip showing the SO number and status — click it to open the order.',
    why: 'One live sales order per inquiry, so the same customer PO can\'t be booked twice. Shown only to people with the Sales app, and only once the inquiry is at stage "Order Received" — never before, and never on "Closed – Not Ordered".',
    after: 'When Sales confirms the order (after its approvals), this inquiry is automatically set to Status "Closed - Ordered" and Stage "Order Received", and the timeline records which SO closed it.',
  },
  {
    target: 'inq-back-btn',
    title: '← Back',
    purpose: 'Returns to the page you came from: the Inquiries & Tenders list, or the customer organization\'s page if you opened this inquiry from there.',
  },
  {
    target: 'inq-delete-btn',
    title: 'Delete',
    purpose: 'Deletes this inquiry — only its creator or an admin can, and only while no sales order or R&D work (offer request, tasks, R&D project) is linked to it.',
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
    purpose: 'Switches the Info tab into the full Inquiry form, pre-filled with this inquiry\'s current values. Once the inquiry is sent to Sales (a sales order is raised from it) Edit, Delete and Send to R&D disappear for everyone — the order is now the reference; cancel it in Sales to change the inquiry.',
    after: 'Click it yourself, then start the tour again for a field-by-field walkthrough of the edit form.',
  },
]

const config: TourConfig = {
  id: 'crm-inquiry-detail-page',
  pageTitle: 'Inquiry Detail',
  steps,
}

export default config
