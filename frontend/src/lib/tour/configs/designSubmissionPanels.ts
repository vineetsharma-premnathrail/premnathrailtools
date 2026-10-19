import { TourConfig } from '../types'

// One tour for the popups on a submission page (Send, Customer response,
// Edit). Only the open popup's steps are found on screen; the rest are skipped.
const config: TourConfig = {
  id: 'design-submission-panels',
  pageTitle: 'Customer Submission — Update',
  steps: [
    {
      target: 'design-sub-send-panel',
      title: 'Send to customer',
      purpose: 'The drawing list is locked once sent. The response due date = sent date + the customer response days in Design Settings.',
    },
    {
      target: 'design-sub-sent-date',
      title: 'Sent date',
      required: true,
      whatToEnter: 'The date the transmittal actually left (email or courier).',
    },
    {
      target: 'design-sub-send-save-btn',
      title: 'Mark as Sent',
      after: 'Status becomes "With customer".',
    },
    {
      target: 'design-sub-response-panel',
      title: 'Customer response',
      purpose: 'Record what the customer said about each drawing still pending.',
    },
    {
      target: 'design-sub-response-lines',
      title: 'Response per drawing',
      options: [
        { value: 'No response yet', meaning: 'Leave it pending.' },
        { value: 'Approved', meaning: 'Accepted — the revision can be released.' },
        { value: 'Approved with comments', meaning: 'Accepted with comments — the comment box becomes required.' },
        { value: 'Rejected', meaning: 'Not accepted — comment required. The revision is frozen; start a new one from the drawing.' },
      ],
    },
    {
      target: 'design-sub-response-date',
      title: 'Response date',
      required: true,
      whatToEnter: 'The date on the customer letter or email.',
      why: 'Used to calculate the customer turnaround time.',
    },
    {
      target: 'design-sub-response-remarks',
      title: 'Remarks',
      whatToEnter: 'Usually the customer letter reference.',
      validExample: 'Letter ref. RDSO/MP/2026/114',
    },
    {
      target: 'design-sub-response-save-btn',
      title: 'Record Response',
      after: 'Approved drawings move to "Ready to release". When every drawing has a response the submission closes.',
    },
    {
      target: 'design-sub-edit-panel',
      title: 'Edit submission',
      purpose: 'Customer (or a typed name if not in the list), contact name and email, project, machine, cover note, and the drawing list (search to add, x to remove). Only possible while a draft.',
    },
    {
      target: 'design-sub-edit-save-btn',
      title: 'Save',
      purpose: 'Saves the changes.',
    },
  ],
}

export default config
