import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-bom-detail',
  pageTitle: 'Bill of Materials',
  steps: [
    {
      target: 'design-bom-header',
      title: 'BOM number, title and status',
      purpose: 'The BOM number and title with its overall status. Underneath: the controlled (released) revision and any revision in progress.',
      options: [
        { value: 'Draft', meaning: 'Being prepared by the author.' },
        { value: 'In check', meaning: 'With the checker.' },
        { value: 'Awaiting release', meaning: 'Checked; with the approver to release.' },
        { value: 'Released', meaning: 'Approved — Store and Purchase work from this revision.' },
        { value: 'Released · revising', meaning: 'Released revision in use while the next is prepared.' },
        { value: 'Superseded', meaning: 'Older revision replaced by a newer one — history only.' },
        { value: 'Obsolete', meaning: 'Withdrawn — not for use.' },
      ],
    },
    {
      target: 'design-bom-back-btn',
      title: '← Back',
      purpose: 'Returns to the BOM list.',
    },
    {
      target: 'design-bom-actions',
      title: 'Workflow actions',
      purpose: 'Only the actions you can take right now are shown — they depend on the revision status and your role.',
      why: 'Draft → Check → Release, each signed by a different person, so a wrong quantity is caught before material is bought.',
    },
    {
      target: 'design-bom-submit-btn',
      title: 'Submit for Check',
      purpose: 'Opens a popup to name the checker and approver and send the draft for check.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'design-bom-submit-checker',
      title: 'Checked by',
      required: true,
      purpose: 'Who checks the lines. Cannot be you.',
    },
    {
      target: 'design-bom-submit-approver',
      title: 'Approved (released) by',
      required: true,
      purpose: 'Who releases the BOM. Cannot be you, and should differ from the checker.',
    },
    {
      target: 'design-bom-submit-note',
      title: 'Note to the checker',
      whatToEnter: 'Optional — anything the checker should look at specially.',
    },
    {
      target: 'design-bom-submit-confirm-btn',
      title: 'Submit for Check',
      purpose: 'Sends the revision. Lines are locked until it is released or returned.',
      after: 'The checker is notified and it appears in their My Work.',
    },
    {
      target: 'design-bom-submit-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the submit popup without sending.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'design-bom-check-btn',
      title: 'Check',
      purpose: 'For the checker: opens the check popup with the BOM checklist (if set up in the Library).',
      autoActivateOnAdvance: true,
    },
    {
      target: 'design-bom-check-remarks',
      title: 'Check remarks',
      purpose: 'Answer every checklist item OK / Not OK / N/A above, then write your remarks. Remarks are required when returning.',
    },
    {
      target: 'design-bom-check-pass-btn',
      title: 'Pass Check',
      purpose: 'Confirms the lines are correct. Not allowed if any checklist item is "Not OK".',
      after: 'Moves to the approver for release.',
    },
    {
      target: 'design-bom-check-return-btn',
      title: 'Return to Author',
      purpose: 'Sends the revision back to draft with your remarks.',
    },
    {
      target: 'design-bom-check-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the check popup without deciding.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'design-bom-release-btn',
      title: 'Release',
      purpose: 'For the approver: opens a popup for optional release remarks, then releases the revision. Blocked while any line has a release blocker (new item without a code, unreleased drawing).',
      after: 'This revision becomes the controlled BOM and the previous one is superseded.',
    },
    {
      target: 'design-bom-approve-return-btn',
      title: 'Return to Author',
      purpose: 'For the approver: opens a popup to say what needs fixing (required), then sends the revision back to draft.',
    },
    {
      target: 'design-bom-recall-btn',
      title: 'Recall to Draft',
      purpose: 'For the author: pulls a submitted revision back to draft.',
    },
    {
      target: 'design-bom-new-rev-btn',
      title: '+ New Revision',
      purpose: 'Opens a popup to start the next revision. It begins as a copy of the released lines.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'design-bom-newrev-summary',
      title: 'Change summary',
      required: true,
      whatToEnter: 'What changes and why.',
      validExample: 'Fastener changed M12 → M16 per ECN-2026-0007',
      invalidExample: 'changes',
    },
    {
      target: 'design-bom-newrev-checker',
      title: 'Checked by',
      purpose: 'Who checks this revision (can be set later).',
    },
    {
      target: 'design-bom-newrev-approver',
      title: 'Approved by',
      purpose: 'Who releases this revision (can be set later).',
    },
    {
      target: 'design-bom-newrev-ecn',
      title: 'Under change notice',
      purpose: 'The approved ECN authorising this change. Only ECNs that list this BOM are offered.',
    },
    {
      target: 'design-bom-newrev-start-btn',
      title: 'Start Revision',
      purpose: 'Creates the draft revision.',
      after: 'Use "Edit revision & lines" to change the lines, then submit for check.',
    },
    {
      target: 'design-bom-newrev-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the popup without starting a revision.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'design-bom-discard-btn',
      title: 'Discard revision',
      purpose: 'Deletes the draft revision. The released revision stays in use.',
    },
    {
      target: 'design-bom-export-btn',
      title: 'Export (CSV)',
      purpose: 'Downloads the selected revision\'s lines as a CSV file (opens in Excel).',
    },
    {
      target: 'design-bom-raise-ecr-btn',
      title: 'Raise Change Request',
      purpose: 'Ask for a change to the released BOM through an ECR.',
    },
    {
      target: 'design-bom-obsolete-btn',
      title: 'Mark Obsolete',
      purpose: 'Opens a popup for the reason (required), then withdraws the BOM from use.',
    },
    {
      target: 'design-bom-reactivate-btn',
      title: 'Reactivate',
      purpose: 'Brings an obsolete BOM back into use.',
    },
    {
      target: 'design-bom-delete-btn',
      title: 'Delete BOM',
      purpose: 'Only possible for a BOM that was never released.',
    },
    {
      target: 'design-bom-rev-chips',
      title: 'Revision selector',
      purpose: 'Click a revision chip to see its lines and sign-offs.',
    },
    {
      target: 'design-bom-edit-rev-btn',
      title: 'Edit revision & lines',
      purpose: 'Opens the draft revision for editing — summary, signatories and the lines table.',
      after: 'Press the Tour button again while editing for help on each line column.',
    },
    {
      target: 'design-bom-rev-info',
      title: 'Sign-offs',
      purpose: 'Who prepared, checked and released this revision, and their remarks.',
    },
    {
      target: 'design-bom-lines',
      title: 'Lines',
      purpose: 'Every part with position, quantity per assembly, unit, drawing, make/buy, approved makes and sub-assembly BOM. A red ⚠ line blocks release and says why.',
      why: 'Approved makes tell Purchase which brands are acceptable; the sub-assembly link lets you drill into a multi-level product.',
    },
    {
      target: 'design-bom-explosion-btn',
      title: 'Multi-level explosion',
      purpose: 'Shows the full tree including sub-assemblies, with total quantity of each part per one top assembly.',
      why: 'Total quantity is what Purchase and Store actually need to plan for one machine.',
    },
    {
      target: 'design-bom-history',
      title: 'Revision history',
      purpose: 'All revisions with status, change summary, line count and sign-offs. Click a row to view it.',
    },
    {
      target: 'design-bom-details',
      title: 'Details',
      purpose: 'Product item, GA drawing, owner, project, machine, design request and open change notices.',
    },
    {
      target: 'design-bom-details-edit-btn',
      title: 'Edit details',
      purpose: 'Opens a popup to edit title, description, drawing, owner, project, machine and request. The product item cannot change.',
    },
    {
      target: 'design-bom-where-used',
      title: 'Where used',
      purpose: 'Other BOMs that use this product as a line (i.e. this is a sub-assembly of them).',
    },
    {
      target: 'design-bom-comment',
      title: 'Timeline & comments',
      purpose: 'Every action is logged here. Add a comment and press Enter or Post.',
    },
  ],
}

export default config
