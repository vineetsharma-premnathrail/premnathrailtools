import { TourConfig } from '../types'
import { CREDIT_NOTE_FORM_STEPS } from './financeCreditNoteForm'

const config: TourConfig = {
  id: 'finance-credit-notes',
  pageTitle: 'Finance — Credit Notes',
  steps: [
    {
      target: 'fin-subtab-credit-notes',
      title: 'Credit Notes',
      purpose: 'Sales returns and reductions of issued invoices.',
      autoActivate: true,
      why: 'An issued tax invoice is never edited — a credit note is the legal way to reduce it.',
    },
    {
      target: 'fin-cn-table',
      title: 'Credit note list',
      purpose: 'Click a note number to see its lines. "Unadjusted" is the part of a posted note not yet set off against an invoice.',
      options: [
        { value: 'Draft', meaning: 'Saved, not yet in the books.' },
        { value: 'Posted', meaning: 'In the books — reduces the customer balance and output GST.' },
        { value: 'Cancelled', meaning: 'Cancelled before posting with a reason.' },
        { value: 'Post (row)', meaning: 'Only a finance user other than the one who raised it (maker-checker).' },
        { value: 'Cancel (row)', meaning: 'Cancels a draft note; asks for a reason.' },
      ],
    },
    {
      target: 'fin-cn-new-btn',
      title: '+ Issue credit note',
      purpose: 'Create a new credit note.',
      after: 'Opens the form above the list — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...CREDIT_NOTE_FORM_STEPS,
  ],
}

export default config
