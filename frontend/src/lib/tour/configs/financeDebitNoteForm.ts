import { TourConfig, TourStep } from '../types'
import { taxLineSteps } from './financeTaxLinesSteps'

export const DEBIT_NOTE_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-dn-bill',
    title: 'Against purchase invoice',
    purpose: 'The posted vendor bill this note corrects. Choose "No specific bill" only for a general adjustment with the vendor.',
    after: 'A "Copy lines from invoice" link appears — use it to start from the bill\'s lines and then reduce quantities/rates.',
    why: 'Linking the note to the bill sets it off against that bill automatically and reverses the right input GST.',
  },
  {
    target: 'fin-dn-vendor',
    title: 'Vendor',
    required: true,
    purpose: 'Shown only when no bill is picked — the vendor the adjustment is with.',
  },
  {
    target: 'fin-dn-date',
    title: 'Note date',
    required: true,
    purpose: 'Date of the debit note (normally today).',
  },
  {
    target: 'fin-dn-reason',
    title: 'Reason',
    required: true,
    options: [
      { value: 'Goods returned', meaning: 'Material sent back to the vendor.' },
      { value: 'Rate difference', meaning: 'Vendor billed above the agreed rate.' },
      { value: 'Discount', meaning: 'A discount given after the bill.' },
      { value: 'Deficiency / shortage', meaning: 'Less quantity or poor quality accepted at a reduced value.' },
      { value: 'Other', meaning: 'Any other reduction — explain in Narration.' },
    ],
  },
  {
    target: 'fin-dn-round-off',
    title: 'Round-off (₹)',
    whatToEnter: 'Paise adjustment, less than ₹1 either way. Usually 0.',
  },
  ...taxLineSteps('debit note', 'Purchases'),
  {
    target: 'fin-dn-narration',
    title: 'Narration',
    purpose: 'Optional explanation, e.g. the return challan number.',
    validExample: '12 pcs returned vide our challan RC-0045',
  },
  {
    target: 'fin-dn-save',
    title: 'Save debit note',
    purpose: 'Saves the note as Pending.',
    after: 'A different finance user must Post it. Once posted it reduces what we owe the vendor and reverses the input GST on that value.',
  },
  {
    target: 'fin-dn-close',
    title: 'Cancel',
    purpose: 'Leaves the form without saving and returns to the list.',
  },
  {
    target: 'fin-dn-back',
    title: '← Back',
    purpose: 'Leaves the form without saving and returns to the list — same as Cancel.',
  },
]

const config: TourConfig = {
  id: 'finance-debit-note-form',
  pageTitle: 'Finance — Raise debit note',
  steps: [
    {
      target: 'fin-dn-form',
      title: 'Raise debit note',
      purpose: 'A purchase return or a reduction of a vendor bill.',
    },
    ...DEBIT_NOTE_FORM_STEPS,
  ],
}

export default config
