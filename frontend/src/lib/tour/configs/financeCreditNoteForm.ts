import { TourConfig, TourStep } from '../types'
import { taxLineSteps } from './financeTaxLinesSteps'

export const CREDIT_NOTE_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-cn-invoice',
    title: 'Against sales invoice',
    required: true,
    purpose: 'The issued invoice this credit note corrects.',
    after: 'Shows "Copy lines from invoice" and the last date GST can still be reduced on it.',
    why: 'GSTR-1 reports every credit note against its original invoice, so it must be linked.',
  },
  {
    target: 'fin-cn-date',
    title: 'Note date',
    required: true,
    purpose: 'Date of the credit note.',
    why: 'GST can be reduced only if the note is dated by 30 November after the invoice\'s financial year ends (CGST Act s.34). After that, issue it at 0% GST — a warning appears.',
  },
  {
    target: 'fin-cn-reason',
    title: 'Reason',
    required: true,
    options: [
      { value: 'Goods returned', meaning: 'Customer sent material back.' },
      { value: 'Rate difference', meaning: 'Invoice was at a higher rate than agreed.' },
      { value: 'Discount', meaning: 'A discount allowed after invoicing.' },
      { value: 'Deficiency / shortage', meaning: 'Short supply or quality claim accepted.' },
      { value: 'Other', meaning: 'Anything else — explain in Narration.' },
    ],
  },
  {
    target: 'fin-cn-round-off',
    title: 'Round-off (₹)',
    whatToEnter: 'Paise adjustment, under ₹1. Usually 0.',
  },
  ...taxLineSteps('credit note', 'Sales'),
  {
    target: 'fin-cn-narration',
    title: 'Narration',
    validExample: '5 pcs returned vide customer challan 1124',
  },
  {
    target: 'fin-cn-save',
    title: 'Save credit note',
    purpose: 'Saves the note as Draft.',
    after: 'Another finance user must Post it. Once posted it reduces the customer balance and output GST and is set off against the invoice.',
  },
  {
    target: 'fin-cn-close',
    title: 'Cancel',
    purpose: 'Leaves the form without saving and returns to the list.',
  },
  {
    target: 'fin-cn-back',
    title: '← Back',
    purpose: 'Leaves the form without saving and returns to the list — same as Cancel.',
  },
]

const config: TourConfig = {
  id: 'finance-credit-note-form',
  pageTitle: 'Finance — Issue credit note',
  steps: [
    {
      target: 'fin-cn-form',
      title: 'Issue credit note',
      purpose: 'A sales return or a reduction of an issued tax invoice.',
    },
    ...CREDIT_NOTE_FORM_STEPS,
  ],
}

export default config
