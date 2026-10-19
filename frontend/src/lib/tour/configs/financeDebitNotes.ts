import { TourConfig } from '../types'
import { DEBIT_NOTE_FORM_STEPS } from './financeDebitNoteForm'

const config: TourConfig = {
  id: 'finance-debit-notes',
  pageTitle: 'Finance — Debit Notes',
  steps: [
    {
      target: 'fin-subtab-debit-notes',
      title: 'Debit Notes',
      purpose: 'Purchase returns and reductions of vendor bills.',
      autoActivate: true,
      why: 'A posted bill is never edited — a debit note is the audit-proof way to reduce it.',
    },
    {
      target: 'fin-dn-table',
      title: 'Debit note list',
      purpose: 'Click a note number to see its lines. "Unadjusted" is the part of a posted note not yet set off against a bill.',
      options: [
        { value: 'Pending', meaning: 'Saved, not yet in the books (shows "Draft" as its number).' },
        { value: 'Posted', meaning: 'In the books — reduces the vendor balance and input GST.' },
        { value: 'Cancelled', meaning: 'Cancelled before posting with a reason.' },
        { value: 'Post (row)', meaning: 'Only a different finance user than the one who raised it.' },
        { value: 'Cancel (row)', meaning: 'Cancels a pending note; asks for a reason.' },
      ],
    },
    {
      target: 'fin-dn-new-btn',
      title: '+ Raise debit note',
      purpose: 'Create a new debit note.',
      after: 'Opens the form above the list — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...DEBIT_NOTE_FORM_STEPS,
  ],
}

export default config
