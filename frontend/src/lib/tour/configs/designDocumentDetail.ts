import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-document-detail',
  pageTitle: 'Document',
  steps: [
    {
      target: 'design-doc-header',
      title: 'Document number, title and status',
      purpose: 'The document number, its title and the overall status badge. Underneath: the controlled (released) revision and any revision in progress.',
      options: [
        { value: 'Draft', meaning: 'Being prepared; only the Design team can see it.' },
        { value: 'In Review', meaning: 'With the checker.' },
        { value: 'In Approval', meaning: 'Checked; with the approver.' },
        { value: 'Approved · awaiting customer', meaning: 'Approved internally, waiting for customer approval on a submission.' },
        { value: 'Released', meaning: 'Controlled revision — the one to build from.' },
        { value: 'Released · Revising', meaning: 'A released revision is in use while the next one is being prepared.' },
        { value: 'Customer rejected', meaning: 'The customer rejected the revision; start a new revision addressing their comments.' },
        { value: 'Superseded', meaning: 'An older revision replaced by a newer released one — kept for traceability only.' },
        { value: 'Obsolete', meaning: 'Withdrawn — not for use.' },
      ],
    },
    {
      target: 'design-doc-back-btn',
      title: '← Back',
      purpose: 'Returns to the Document Register.',
    },
    {
      target: 'design-doc-actions',
      title: 'Workflow actions',
      purpose: 'Only the buttons you are allowed to use right now are shown — they depend on the revision status and your role (author, checker, approver, Design head).',
      why: 'The workflow is Draft → Check → Approval → (Customer) → Released. Each step is signed by a different person, which is what makes the drawing "controlled".',
    },
    {
      target: 'design-doc-submit-btn',
      title: 'Submit for Check',
      purpose: 'Sends the draft revision to the named checker. Files are locked while it is in check/approval.',
      after: 'The checker is notified and the revision moves to "In Review".',
    },
    {
      target: 'design-doc-checklist-btn',
      title: 'Check against Checklist',
      purpose: 'For the checker: opens the review checklist for this document type. Every item must be answered OK / Not OK / N/A.',
      why: 'A checklist makes checking consistent — the same points (title block, tolerances, material, weld symbols…) are checked every time.',
    },
    {
      target: 'design-doc-pass-check-btn',
      title: 'Pass Check',
      purpose: 'For the checker: confirms the revision is correct.',
      after: 'The revision moves to the approver.',
    },
    {
      target: 'design-doc-review-return-btn',
      title: 'Return to Author (check)',
      purpose: 'For the checker: sends the revision back to draft with a comment saying exactly what to fix.',
    },
    {
      target: 'design-doc-approve-btn',
      title: 'Approve & Release / Approve for Customer',
      purpose: 'For the approver: final internal sign-off.',
      after: 'If no customer approval is needed, the revision is released and the previous one is superseded. If customer approval is required, it becomes "Approved · awaiting customer".',
    },
    {
      target: 'design-doc-release-btn',
      title: 'Release',
      purpose: 'Appears after the customer has approved the revision on a submission. Releasing makes it the controlled revision.',
    },
    {
      target: 'design-doc-approve-return-btn',
      title: 'Return to Author (approval)',
      purpose: 'For the approver: sends the revision back to draft with a comment.',
    },
    {
      target: 'design-doc-recall-btn',
      title: 'Recall to Draft',
      purpose: 'For the author: pulls a submitted revision back to draft (e.g. you spotted a mistake). The checker/approver is told no action is needed.',
    },
    {
      target: 'design-doc-new-rev-btn',
      title: '+ New Revision',
      purpose: 'Opens the Start revision popup for the next revision of a released document. The released revision stays in use until the new one is released.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'design-doc-newrev-summary',
      title: 'Change summary',
      required: true,
      whatToEnter: 'What changes and why — this is printed in the revision history.',
      validExample: 'Gusset plate thickened 10 → 12 mm after FEA review',
      invalidExample: 'updated',
    },
    {
      target: 'design-doc-newrev-checker',
      title: 'Checked by',
      purpose: 'Who will check this revision. Can be decided later, but must be set before submitting.',
    },
    {
      target: 'design-doc-newrev-approver',
      title: 'Approved by',
      purpose: 'Who will approve this revision. Must be different from the checker.',
    },
    {
      target: 'design-doc-newrev-ecn',
      title: 'Under change notice',
      purpose: 'The approved ECN that authorises this change. Only ECNs that list this document are offered.',
      why: 'Linking the revision to its ECN gives a full trail: why it changed (ECR), who approved the change (ECN) and the resulting drawing.',
    },
    {
      target: 'design-doc-newrev-start-btn',
      title: 'Start Revision',
      purpose: 'Creates the new draft revision.',
      after: 'Upload its files, then submit it for check.',
    },
    {
      target: 'design-doc-newrev-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the Start revision popup without creating anything.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'design-doc-discard-btn',
      title: 'Discard revision',
      purpose: 'Deletes the draft revision and its files. The released revision stays as it is.',
    },
    {
      target: 'design-doc-obsolete-btn',
      title: 'Mark Obsolete',
      purpose: 'Withdraws the whole document from use (needs a reason, e.g. "replaced by DWG-2026-0042"). History stays on record.',
    },
    {
      target: 'design-doc-reactivate-btn',
      title: 'Reactivate',
      purpose: 'Brings an obsolete document back into use so it can be revised.',
    },
    {
      target: 'design-doc-delete-btn',
      title: 'Delete Document',
      purpose: 'Only for documents that were never released — removes them completely.',
    },
    {
      target: 'design-doc-raise-ecr-btn',
      title: 'Raise ECR',
      purpose: 'Anyone (Production, Quality, Purchase…) can request a change to a released drawing with an Engineering Change Request.',
      after: 'Opens the ECR form with this document pre-filled.',
    },
    {
      target: 'design-doc-rev-chips',
      title: 'Revision selector',
      purpose: 'Each chip is one revision (R0, R1…). Click to see that revision\'s sign-offs and files.',
    },
    {
      target: 'design-doc-edit-rev-btn',
      title: 'Edit revision',
      purpose: 'Opens a popup to change the summary, checker, approver or ECN of the open revision before it is submitted.',
    },
    {
      target: 'design-doc-rev-info',
      title: 'Sign-offs',
      purpose: 'Who prepared, checked and approved the revision, and when — with their remarks.',
    },
    {
      target: 'design-doc-files',
      title: 'Files',
      purpose: 'The revision\'s files — Open to view, Download to save. Remove is only available on a draft.',
    },
    {
      target: 'design-doc-upload',
      title: '+ Upload files',
      purpose: 'Opens the upload popup for the open draft revision: pick the role, drop or browse the files, then press Upload.',
      options: [
        { value: 'Controlled print (PDF)', meaning: 'The official print used on the shop floor.' },
        { value: 'Native / CAD source', meaning: 'The editable CAD file.' },
        { value: 'Supporting', meaning: 'Calculations, reference material.' },
      ],
    },
    {
      target: 'design-doc-history',
      title: 'Revision history',
      purpose: 'All revisions with status, change summary and sign-offs. "Checklist" shows the checker\'s answers per check cycle — click to expand.',
    },
    {
      target: 'design-doc-submissions',
      title: 'Customer submissions',
      purpose: 'Every transmittal this document was sent on, and the customer\'s response (Pending, Approved, Approved with comments, Rejected).',
    },
    {
      target: 'design-doc-where-used',
      title: 'Where used',
      purpose: 'BOMs that include this drawing on a line.',
      why: 'Before changing a drawing, check where it is used — every BOM listed here is affected.',
    },
    {
      target: 'design-doc-details',
      title: 'Details',
      purpose: 'Owner, project, machine, store item, department, customer, standard, design request and legacy number.',
    },
    {
      target: 'design-doc-details-edit-btn',
      title: 'Edit details',
      purpose: 'Edit the document details. The type and number cannot be changed.',
      after: 'The Edit document details popup opens — press the Tour button again for help on its fields.',
    },
    {
      target: 'design-doc-comment',
      title: 'Timeline & comments',
      purpose: 'Every action on the document is logged below. Type a comment and press Enter or Post — it is tied to the revision selected.',
    },
  ],
}

export default config
