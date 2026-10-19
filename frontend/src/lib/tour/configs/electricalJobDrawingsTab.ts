import { TourConfig } from '../types'

export const DRAWING_TYPE_OPTIONS = [
  { value: 'Electrical Schematic', meaning: 'Circuit diagram showing how every device is connected. Needed (approved) for the Schematics stage.' },
  { value: 'Single Line Diagram', meaning: 'Simplified one-line view of power distribution. Also satisfies the Schematics stage.' },
  { value: 'Wiring Diagram', meaning: 'Terminal-to-terminal wiring for the technicians.' },
  { value: 'Harness Drawing', meaning: 'Layout and make-up of a cable harness.' },
  { value: 'Panel GA', meaning: 'General arrangement — outside dimensions and device layout of a panel.' },
  { value: 'Panel Wiring', meaning: 'Internal wiring of a panel.' },
  { value: 'Cable Schedule', meaning: 'Drawing / sheet form of the cable list.' },
  { value: 'Equipment Layout', meaning: 'Where each electrical item sits on the vehicle.' },
  { value: 'Other', meaning: 'Anything else.' },
]

export const REVISION_STATUS_OPTIONS = [
  { value: 'Draft', meaning: 'Being prepared; the file can still be replaced.' },
  { value: 'Awaiting Approval', meaning: 'Submitted; waiting for someone other than the preparer to approve or reject.' },
  { value: 'Approved', meaning: 'The current valid revision — build from this one.' },
  { value: 'Rejected', meaning: 'Not accepted, with a reason. Raise a new revision to fix it.' },
  { value: 'Superseded', meaning: 'Was approved, replaced by a later approved revision. Kept for history.' },
]

const config: TourConfig = {
  id: 'electrical-job-drawings-tab',
  pageTitle: 'RRV Electrical Job — Drawings',
  steps: [
    {
      target: 'elec-job-tab-drawings',
      title: 'Drawings tab',
      purpose: 'Revision-controlled drawings of this vehicle. Each drawing has revisions R0, R1, R2 … and only one approved revision is valid at a time.',
      autoActivate: true,
      why: 'Revision control makes sure the shop builds from the latest approved drawing, and keeps a history of every change and who approved it.',
      after: 'For a tour of the whole job page, open the Stages tab and start the tour again.',
    },
    {
      target: 'elec-drawings-summary',
      title: 'Drawings summary',
      purpose: 'Total drawings, how many have a revision awaiting approval, and how many as-built drawings are approved.',
      why: 'Schematics stage needs an approved schematic / single line diagram; Drawing Revision stage needs every drawing approved with no open revision; As-Built Records needs approved drawings marked as-built.',
    },
    {
      target: 'elec-drawings-add-btn',
      title: '+ Add Drawing',
      purpose: 'Registers a new drawing.',
      after: 'Press Next and the tour opens the Add Drawing form.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-drawing-title',
      title: 'Title',
      required: true,
      whatToEnter: 'What the drawing shows.',
      validExample: 'Main 24V DC distribution schematic',
      invalidExample: 'Drawing 1',
    },
    {
      target: 'elec-drawing-type',
      title: 'Drawing type',
      required: true,
      options: DRAWING_TYPE_OPTIONS,
    },
    {
      target: 'elec-drawing-number',
      title: 'Drawing number',
      required: false,
      whatToEnter: 'Your drawing number, or leave blank and the system numbers it automatically.',
      validExample: 'PRT-EL-450-001',
    },
    {
      target: 'elec-drawing-as-built',
      title: 'As-built drawing',
      required: false,
      purpose: 'Tick if this drawing records the vehicle exactly as it was finally built (including site changes).',
      why: 'As-built drawings are what maintenance staff will use for years — the As-Built Records stage needs them approved.',
    },
    {
      target: 'elec-drawing-description',
      title: 'Description',
      required: false,
    },
    {
      target: 'elec-drawing-change-summary',
      title: 'R0 change summary',
      required: false,
      whatToEnter: 'What this first revision is. Defaults to "First issue".',
    },
    {
      target: 'elec-drawing-file',
      title: 'File (optional)',
      required: false,
      whatToEnter: 'PDF, DWG, DXF, PNG or JPG of the drawing. Can also be uploaded later.',
      why: 'A revision cannot be submitted for approval until a file is attached.',
    },
    {
      target: 'elec-drawing-form-save',
      title: 'Add Drawing',
      purpose: 'Creates the drawing with revision R0 in Draft.',
    },
    {
      target: 'elec-drawing-form-cancel',
      title: 'Cancel',
      purpose: 'Closes the form without saving. Press Next and the tour closes it for you.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-drawing-row',
      title: 'Drawing row',
      purpose: 'Number, title, type, number of revisions and the currently approved revision ("No approved revision" in red if none yet). Click the row to show its revision history.',
      after: 'Press Next and the tour expands the first drawing for you.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-drawing-status',
      title: 'Latest revision status',
      purpose: 'The latest revision label and its status.',
      options: REVISION_STATUS_OPTIONS,
    },
    {
      target: 'elec-drawing-new-rev-btn',
      title: 'New Revision',
      purpose: 'Starts the next revision (R1, R2 …) when the drawing has to change. Only shown when no revision is already in draft or awaiting approval.',
      whatToEnter: 'In the pop-up: a required change summary ("What changed?") and optionally the new file.',
      after: 'The new revision starts as a Draft. Approving it later supersedes the current approved revision.',
    },
    {
      target: 'elec-drawing-edit-btn',
      title: 'Edit',
      purpose: 'Changes the drawing number, type, title, as-built flag or description (not the files — those belong to revisions).',
    },
    {
      target: 'elec-drawing-as-built-btn',
      title: 'Mark / Unmark as-built',
      purpose: 'Quick toggle of the as-built flag.',
    },
    {
      target: 'elec-drawing-delete-btn',
      title: 'Delete',
      purpose: 'Removes the drawing and all its revisions. Not allowed once any revision has been approved — raise a new revision instead.',
    },
    {
      target: 'elec-drawing-revisions',
      title: 'Revision history',
      purpose: 'Every revision, newest first: status, change summary, file (click to open), who prepared it, when submitted, and who approved / rejected it with their comment.',
    },
    {
      target: 'elec-rev-upload-btn',
      title: 'Upload / Replace file',
      purpose: 'Attaches the drawing file to a Draft revision (or replaces it).',
    },
    {
      target: 'elec-rev-submit-btn',
      title: 'Submit for approval',
      purpose: 'Sends the Draft revision for approval. Disabled until a file is attached.',
      after: 'Status becomes Awaiting Approval and the drawing counts on the dashboard\'s "Drawings to Approve".',
    },
    {
      target: 'elec-rev-approve-btn',
      title: 'Approve',
      purpose: 'Approves a submitted revision, with an optional comment. The person who prepared it cannot approve their own revision (admins excepted).',
      after: 'This revision becomes the approved one; the previously approved revision becomes Superseded.',
      why: 'A second person checking a drawing (maker–checker) catches mistakes before they are built into the vehicle.',
    },
    {
      target: 'elec-rev-reject-btn',
      title: 'Reject',
      purpose: 'Rejects a submitted revision. A reason is required so the author knows what to fix.',
      after: 'The revision is dead; the author raises the next revision with the corrections.',
    },
    {
      target: 'elec-rev-discard-btn',
      title: 'Discard',
      purpose: 'Removes a Draft or Awaiting Approval revision started by mistake. Earlier revisions are untouched.',
    },
  ],
}

export default config
