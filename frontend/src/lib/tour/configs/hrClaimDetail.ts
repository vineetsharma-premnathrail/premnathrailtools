import { TourConfig } from '../types'

// One expense claim — shared by My Expense Claims (/hr/me/claims/:id) and HR's
// view (/hr/travel/claims/:id). Buttons appear only for whoever may use them
// (owner while draft/rejected, approver while submitted, HR once approved).
const config: TourConfig = {
  id: 'hr-claim-detail',
  pageTitle: 'Expense Claim',
  steps: [
    {
      target: 'hr-claim-summary',
      title: 'Claim summary',
      purpose: 'Status, employee and department, claim date, linked trip, approver, when it was submitted / decided / paid, and the total amount with the number of lines.',
      options: [
        { value: 'Draft', meaning: 'Being prepared — lines can be added, edited or deleted.' },
        { value: 'Submitted', meaning: 'With the approver; locked for editing.' },
        { value: 'Approved', meaning: 'Approved; waiting for HR / accounts to pay.' },
        { value: 'Rejected', meaning: 'Sent back with a reason — fix and resubmit.' },
        { value: 'Paid', meaning: 'Reimbursed; payment date and reference are shown.' },
        { value: 'Cancelled', meaning: 'Withdrawn; read-only.' },
      ],
    },
    {
      target: 'hr-claim-line-date',
      title: 'Expense date',
      purpose: 'The day the money was spent (one line per bill).',
      required: true,
      invalidExample: 'A future date',
    },
    {
      target: 'hr-claim-line-category',
      title: 'Category',
      purpose: 'What kind of expense this is.',
      required: true,
      options: [
        { value: 'Travel / tickets', meaning: 'Train, flight or bus tickets.' },
        { value: 'Lodging', meaning: 'Hotel or guest house.' },
        { value: 'Food', meaning: 'Meals while travelling or on company work.' },
        { value: 'Local conveyance', meaning: 'Auto, cab, metro within a city.' },
        { value: 'Fuel', meaning: 'Petrol / diesel for own or hired vehicle used for work.' },
        { value: 'Phone / data', meaning: 'Calls or mobile data used for work.' },
        { value: 'Other', meaning: 'Anything else — explain in Description.' },
      ],
      why: 'Categories let accounts book each rupee to the right expense head and spot unusual spending.',
    },
    {
      target: 'hr-claim-line-description',
      title: 'Description',
      purpose: 'What exactly was paid for.',
      validExample: 'Cab from Kapurthala station to customer works',
    },
    {
      target: 'hr-claim-line-amount',
      title: 'Amount (₹)',
      purpose: 'The amount on the bill.',
      required: true,
      validExample: '450',
      invalidExample: '0',
    },
    {
      target: 'hr-claim-line-receipt',
      title: 'Receipt',
      purpose: 'Photo or PDF of the bill (up to 10 MB).',
      why: 'A receipt is compulsory for any line above the receipt limit shown under the table — the claim cannot be submitted while a required receipt is missing. It is the audit proof that the money was really spent.',
    },
    {
      target: 'hr-claim-add-line-btn',
      title: '+ Add line',
      purpose: 'Saves this expense as a line on the claim (with its receipt, if chosen).',
      after: 'The line is added, the total updates, and a fresh empty line appears for the next bill. Saved lines can be edited, deleted, or have their receipt uploaded / replaced / removed from their own row.',
    },
    {
      target: 'hr-claim-lines',
      title: 'Expense lines',
      purpose: 'All lines on the claim with date, category, description, amount and receipt. "Required" / "Missing" in red marks a line that still needs a receipt.',
    },
    {
      target: 'hr-claim-edit-header-btn',
      title: 'Edit title / trip',
      purpose: 'Change the claim title, date or linked trip while it is a draft or rejected.',
    },
    {
      target: 'hr-claim-submit-btn',
      title: 'Submit for approval',
      purpose: 'Sends the claim to your reporting manager (or HR if you have none).',
      after: 'You confirm first. The claim becomes Submitted and is locked for editing; the approver is notified. If it is rejected you fix it and use "Resubmit for approval".',
    },
    {
      target: 'hr-claim-approve-btn',
      title: 'Approve (approver)',
      purpose: 'Shown only to the approver while the claim is Submitted. Check every line against its receipt first.',
      after: 'The claim becomes Approved (optional remark) and moves to HR / accounts for payment.',
    },
    {
      target: 'hr-claim-reject-btn',
      title: 'Reject (approver)',
      purpose: 'Sends the claim back to the employee. A reason is required — say exactly what to fix (e.g. "Hotel bill missing GST invoice").',
    },
    {
      target: 'hr-claim-paid-btn',
      title: 'Mark paid (HR)',
      purpose: 'Shown to HR once a claim is Approved. Records the payment date and the payment reference (NEFT / UTR / cheque number or ADP batch).',
      why: 'The reference lets the employee trace the money in their bank statement and closes the claim for audit.',
    },
    {
      target: 'hr-claim-cancel-btn',
      title: 'Withdraw / Cancel claim',
      purpose: 'Withdraws a submitted claim, or cancels a draft. A cancelled claim cannot be reopened — make a new one if needed.',
    },
  ],
}

export default config
