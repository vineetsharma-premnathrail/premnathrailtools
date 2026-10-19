import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-ecn-detail',
  pageTitle: 'Change Notice (ECN)',
  steps: [
    {
      target: 'design-ecn-header',
      title: 'ECN number, title and status',
      purpose: 'The status badge shows where this change is. A link under the title opens the change request (ECR) it came from.',
      options: [
        { value: 'Draft', meaning: 'Being written. Can be edited or deleted.' },
        { value: 'Awaiting approval', meaning: 'Submitted; the approver must approve or reject.' },
        { value: 'Open', meaning: 'Approved. Owners are revising each affected drawing/BOM under this ECN.' },
        { value: 'Released', meaning: 'Every affected item has a released new revision. Departments must now acknowledge.' },
        { value: 'Closed', meaning: 'All departments acknowledged — finished.' },
        { value: 'Rejected / Cancelled', meaning: 'Stopped; kept on record with the reason.' },
      ],
    },
    {
      target: 'design-ecn-back-btn',
      title: 'Back',
      purpose: 'Returns to the Change Notices list.',
    },
    {
      target: 'design-ecn-actions',
      title: 'Actions',
      purpose: 'Only the buttons you are allowed to use at the current status are shown.',
    },
    {
      target: 'design-ecn-edit-btn',
      title: 'Edit',
      purpose: 'Opens the full ECN form. Only while the ECN is a draft.',
    },
    {
      target: 'design-ecn-submit-btn',
      title: 'Submit for Approval',
      purpose: 'Sends the draft to the approver.',
      after: 'It cannot be edited after this. The approver is notified.',
    },
    {
      target: 'design-ecn-approve-btn',
      title: 'Approve',
      purpose: 'For the approver: accept the change, with optional remarks.',
      after: 'Status becomes Open and the owners of each affected drawing are asked to start their new revisions under this ECN.',
    },
    {
      target: 'design-ecn-reject-btn',
      title: 'Reject',
      purpose: 'For the approver: refuse the change. A reason is required and the person who raised it sees it. Final.',
    },
    {
      target: 'design-ecn-release-btn',
      title: 'Release ECN',
      purpose: 'Available once every affected drawing and BOM has a released revision under this ECN.',
      after: 'Effectivity and disposition are frozen, and Production, Purchase, Store, Quality and Project are asked to acknowledge.',
    },
    {
      target: 'design-ecn-cancel-btn',
      title: 'Cancel ECN',
      purpose: 'Stop the change. A reason is required; the ECN stays on record as Cancelled.',
    },
    {
      target: 'design-ecn-delete-btn',
      title: 'Delete',
      purpose: 'Deletes a draft that was never submitted.',
    },
    {
      target: 'design-ecn-drawings',
      title: 'Affected drawings',
      purpose: 'Each drawing in this change, what changes in it, its owner, the current controlled revision and the new revision being made under this ECN. Click a row to open the drawing.',
      options: [
        { value: 'No revision yet', meaning: 'The owner has not started the new revision — open the drawing and use "New revision", picking this ECN.' },
        { value: 'Draft / In Review / In Approval', meaning: 'The new revision is moving through check and approval.' },
        { value: 'Awaiting customer', meaning: 'Approved internally, waiting for customer approval.' },
        { value: 'Released', meaning: 'The new revision is now the controlled one.' },
        { value: 'Customer rejected', meaning: 'The customer did not accept it — rework needed.' },
      ],
    },
    {
      target: 'design-ecn-boms',
      title: 'Affected BOMs',
      purpose: 'Same as drawings, for the bills of material. Click a row to open the BOM.',
    },
    {
      target: 'design-ecn-effectivity',
      title: 'Effectivity & disposition',
      purpose: 'When the change takes effect and what happens to old stock and work in progress (use up, rework, scrap).',
      why: 'This is the instruction store and production act on. It can be corrected until the ECN is released, then it is frozen.',
    },
    {
      target: 'design-ecn-eff-edit-btn',
      title: 'Edit effectivity',
      purpose: 'Change the effectivity, disposition and target date without reopening the whole ECN.',
    },
    {
      target: 'design-ecn-eff-save-btn',
      title: 'Save effectivity',
      purpose: 'Saves the effectivity and disposition. A date or serial number is required if you chose those effectivity types.',
    },
    {
      target: 'design-ecn-eff-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards the effectivity changes.',
    },
    {
      target: 'design-ecn-acks',
      title: 'Department acknowledgements',
      purpose: 'After release, each department confirms it has acted on the change (stock, open orders, routings, inspection plans). Use "Acknowledge" on your department\'s row and add remarks.',
      after: 'When every department has acknowledged, the ECN closes automatically.',
      why: 'Releasing a drawing is not enough — the change only really happens when the people who buy, store, make and inspect act on it.',
    },
    {
      target: 'design-ecn-change',
      title: 'Change description and impact',
      purpose: 'What is changing and its effect on production, stock and cost.',
    },
    {
      target: 'design-ecn-details',
      title: 'Details',
      purpose: 'Reason, priority, target date, project, machine, who raised it, approver and every decision with its date.',
    },
    {
      target: 'design-ecn-timeline',
      title: 'Timeline',
      purpose: 'Every action on this ECN, with comments. Type a comment and press Enter or Post to add one.',
    },
  ],
}

export default config
