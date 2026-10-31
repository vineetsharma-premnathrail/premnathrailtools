import { TourConfig, TourStep } from '../types'
import quotationConfig from './crmQuotationForm'
import activityConfig from './crmActivityForm'
import momExportConfig from './crmMomExport'
import torDialogConfig from './crmTorDialog'
import { followUpListSteps } from './crmFollowUpList'

// The Inquiry detail page has six tabs (Info, Documents, Technical Offers,
// Quotations, Follow Ups, Timeline) all on one route. Each tab step below has `autoActivate:
// true`, so the tour switches tabs on the page's own behalf as it reaches
// them — otherwise a tab's content only exists once a user manually clicks
// it, and every one of its steps would silently auto-skip first.
const steps: TourStep[] = [
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
  {
    target: 'inq-rnd-status',
    title: 'R&D ID, revision and status',
    purpose: 'Appears once the requirement has been sent to R&D: its R&D ID (RDR-year-number), the current revision (R0, R1, …) and where R&D\'s review stands — Awaiting R&D review, Accepted, R&D asked for details (the question is shown on the card — update the requirement and send it again), Responded or Superseded (older requirements may also show Returned to BD).',
    why: 'Each send is a new revision with its own ID, so you and R&D always talk about the same version.',
  },
  {
    target: 'crm-rnd-returned',
    title: 'Returned by R&D',
    purpose: 'Shown only when R&D sent the revision back: "Returned by R&D: <reason>". It says what you must fix — edit the inquiry or its documents, then send it again.',
    after: 'There is no Discussion channel any more; the return reason is how R&D asks for corrections.',
  },
  {
    target: 'crm-rnd-resend-btn',
    title: 'Re-send to R&D',
    purpose: 'Opens the same send dialog as "Send Technical Requirement to R&D". Your re-send becomes the next revision (R1, R2, …) and goes back to R&D for review. Never opened by the tour — you decide when to send.',
    why: 'Available as soon as R&D has returned it, even before you edit the record, because the fix may be in a document.',
  },
  {
    target: 'inquiry-tab-Technical Offers',
    title: 'Technical Offers',
    purpose: 'The offers you can quote: the ones R&D released, and the ones you upload yourself. Shown only if your role includes Inquiries & Tenders › Technical Offers (BD upload).',
    autoActivate: true,
  },
  {
    target: 'crm-bd-offer-upload-btn',
    title: 'Upload Technical Offer (BD)',
    purpose: 'Upload your own offer — a Word (.docx) or PDF file with a title and an offer date. It needs no R&D requirement, is quotable at once, and the quotation shows "Uploaded by BD, not reviewed by R&D".',
    whatToEnter: 'Title, offer date, optional notes, and the file. Only .docx or .pdf.',
    after: 'You can delete a BD offer only while no quotation uses it ("Used by quotation … — remove it from the quotation first").',
  },
  {
    target: 'crm-bd-offers-table',
    title: 'Offer list',
    purpose: 'Offer number, title, who it is from (R&D released or BD upload), date, file, and the quotations that use it. Download opens the file; Delete appears for your own uploads.',
  },
  ...quotationConfig.steps,
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
    purpose: 'Sends R&D the requirement — customer, its type and region, every product with its specification, and the project background (no GST, address, contact person or prices) — and puts it in the R&D team queue with a Response Due Date and your remarks. The first send creates the R&D ID and revision R0; every later send is the next revision. Shown only to roles with Send Technical Requirement (TOR) to R&D.',
    why: 'Blocked until Product and Specification are filled in — otherwise R&D would get an empty requirement. Disabled once already sent, until the requirement is edited again (or R&D returns it).',
    after: 'Click it yourself: set the due date, remarks and reference documents and send — the tour won\'t open it for you. If you open it now, press Next for a walkthrough of the dialog.',
  },
  ...torDialogConfig.steps,
  {
    target: 'inq-back-btn',
    title: '← Back',
    purpose: 'Returns to the page you came from: the Inquiries & Tenders list, or the customer organization\'s page if you opened this inquiry from there.',
  },
  {
    target: 'inq-delete-btn',
    title: 'Delete',
    purpose: 'Deletes this inquiry — only its creator or an admin can, and only while no R&D work (offer request, tasks, R&D project) or Project Management project is linked to it.',
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
