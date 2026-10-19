import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-submission-detail',
  pageTitle: 'Customer Submission',
  steps: [
    {
      target: 'design-sub-header',
      title: 'Submission number, customer and status',
      purpose: 'Below: number of drawings, sent date, response due date and days waiting. A red "Overdue" badge means the customer is late replying.',
      options: [
        { value: 'Draft', meaning: 'Being prepared. Drawings can be added or removed.' },
        { value: 'With customer', meaning: 'Sent; the drawing list is locked. Waiting for the response.' },
        { value: 'Closed', meaning: 'The customer responded on every drawing.' },
        { value: 'Cancelled', meaning: 'Withdrawn, with a reason.' },
      ],
    },
    {
      target: 'design-sub-back-btn',
      title: 'Back',
      purpose: 'Return to Reviews & Approvals.',
    },
    {
      target: 'design-sub-actions',
      title: 'Actions',
      purpose: 'Only the actions allowed at the current status are shown.',
    },
    {
      target: 'design-sub-send-btn',
      title: 'Send to Customer',
      purpose: 'Record the date you sent the transmittal. Opens a small panel.',
      after: 'Status becomes "With customer" and the response due date is calculated from Design Settings.',
    },
    {
      target: 'design-sub-response-btn',
      title: 'Record Customer Response',
      purpose: 'Enter the customer decision for each drawing. Opens the response panel.',
    },
    {
      target: 'design-sub-edit-btn',
      title: 'Edit',
      purpose: 'Change customer, contact, project, cover note or the drawing list — only while a draft.',
    },
    {
      target: 'design-sub-cancel-btn',
      title: 'Cancel Submission',
      purpose: 'Withdraw it with a reason. It stays on record.',
    },
    {
      target: 'design-sub-delete-btn',
      title: 'Delete Draft',
      purpose: 'Delete a draft that was never sent.',
    },
    {
      target: 'design-sub-drawings',
      title: 'Drawings',
      purpose: 'Each drawing revision on this submission, its internal status and the customer response. Click to open the drawing.',
      options: [
        { value: 'Pending', meaning: 'No answer from the customer yet.' },
        { value: 'Approved', meaning: 'Accepted as is — the revision can be released.' },
        { value: 'Approved with comments', meaning: 'Accepted, but comments must be actioned (log them below).' },
        { value: 'Rejected', meaning: 'Not accepted. The revision is frozen — start a new revision from the drawing.' },
      ],
    },
    {
      target: 'design-sub-comments',
      title: 'Customer comment actions',
      purpose: 'Turn each customer comment into an action assigned to a designer, then close it with a resolution.',
      why: 'Customers check that every comment was addressed on the next revision. Logging them as actions means nothing is forgotten.',
    },
    {
      target: 'design-sub-add-action-btn',
      title: '+ Add action',
      purpose: 'Log a new customer comment — opens a popup with the comment, drawing and assignee. Available to the Design team once the submission is sent.',
    },
    {
      target: 'design-sub-action-drawing',
      title: 'Drawing',
      purpose: 'Which drawing the comment is about, or "Whole submission".',
    },
    {
      target: 'design-sub-action-assignee',
      title: 'Assigned to',
      purpose: 'The designer who must resolve it. They see it in My Work.',
    },
    {
      target: 'design-sub-action-comment',
      title: 'Customer comment',
      required: true,
      whatToEnter: 'The comment as the customer wrote it.',
      validExample: 'Show weld symbol on section B-B',
    },
    {
      target: 'design-sub-action-save-btn',
      title: 'Add Action',
      after: 'The action appears as Open. The assignee closes it with a resolution using "Close".',
    },
    {
      target: 'design-sub-details',
      title: 'Details',
      purpose: 'Customer, contact, project, machine, cover note, who prepared it, sent date, response due, response date with turnaround days, and remarks.',
    },
    {
      target: 'design-sub-letter',
      title: 'Customer letter',
      purpose: 'Attach the customer approval or comment letter (PDF, Word, image, email). Open or download it here.',
      why: 'The letter is the formal evidence of customer approval — auditors and the customer may ask for it later.',
    },
    {
      target: 'design-sub-timeline',
      title: 'Timeline',
      purpose: 'Every action on the submission in order.',
    },
  ],
}

export default config
