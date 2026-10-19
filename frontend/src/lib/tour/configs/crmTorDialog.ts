import { TourConfig } from '../types'

// Steps for the "Send Technical Requirement to R&D" picker dialog, shared by
// the Inquiry and Tender detail tours. The tour never opens this dialog itself
// (opening it is the first half of a real send to R&D, so the user decides),
// so these steps only show when the user has opened it; otherwise the tour
// skips them as "not applicable right now".
const config: TourConfig = {
  id: 'crm-tor-dialog',
  pageTitle: 'Send Technical Requirement to R&D',
  steps: [
    {
      target: 'tor-due-date',
      title: 'Response Due Date',
      required: true,
      purpose: 'The date by which R&D must send back its technical reply.',
      whatToEnter: 'Today or a later date. Leave enough time to meet the customer\'s own deadline.',
      validExample: 'A date 5 working days before the tender submission date',
      invalidExample: 'Yesterday\'s date (rejected: the due date cannot be in the past)',
      why: 'If R&D replies after this date, they must enter a reason for the delay. That builds an honest record of R&D turnaround time.',
    },
    {
      target: 'tor-remarks',
      title: 'Remarks to R&D',
      required: false,
      purpose: 'Tell R&D exactly what you need back from them.',
      validExample: 'Need feasibility + GA drawing; customer asks for 20 T capacity instead of 15 T',
      invalidExample: 'Please check (too vague: R&D has to guess what you want)',
    },
    {
      target: 'tor-doc-picker',
      title: 'Reference client documents',
      required: false,
      purpose: 'Tick any Client Documents (customer RFQ, drawings, specifications) that R&D should receive with the request. Only files uploaded to this record\'s Documents tab under Client Documents are listed.',
      after: 'Ticked files are attached alongside the generated Technical Offer Request PDF.',
    },
    {
      target: 'tor-word-doc',
      title: 'Technical Offer document (step 1: create)',
      required: true,
      purpose: 'Create Word builds the Technical Offer from this record. Edit in Word opens it in Word Online so you can change wording, add tables or notes before R&D sees it.',
      why: 'R&D receives exactly the document you reviewed, not just the raw form fields. Send stays disabled until the document exists.',
      after: 'On Send, the PDF of this Word file is emailed to R&D, stored on SharePoint and listed under Documents › Internal Documents. Each re-send needs a new document for that send ("Create Word for current revision").',
    },
    {
      target: 'tor-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the dialog without sending anything.',
    },
    {
      target: 'tor-send-btn',
      title: 'Send (step 2)',
      purpose: 'Enabled once the Word document is created. Makes the PDF of that Word file, saves it to SharePoint and Internal Documents, and sends it to the whole R&D team with your due date, remarks and the ticked documents.',
      after: 'The Info tab shows the new request card with status "Awaiting R&D", and an "Email Sent" entry is added to the Timeline. The Send button stays disabled until the requirement is edited again, so the same version is not sent twice.',
    },
  ],
}

export default config
