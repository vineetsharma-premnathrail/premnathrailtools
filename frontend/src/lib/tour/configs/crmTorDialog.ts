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
      after: 'Ticked files are shared with R&D with the request (links in the email and in R&D › Requirements). No separate Technical Offer document is made.',
    },
    {
      target: 'tor-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the dialog without sending anything.',
    },
    {
      target: 'tor-send-btn',
      title: 'Send',
      purpose: 'Sends the requirement to the whole R&D team with your due date, remarks and the ticked documents. R&D sees the full requirement under R&D › Requirements; no Word or PDF document is made.',
      after: 'The Info tab shows the new request card with status "Awaiting R&D", and an "Email Sent" entry is added to the Timeline. The Send button stays disabled until the requirement is edited again, so the same version is not sent twice.',
    },
  ],
}

export default config
