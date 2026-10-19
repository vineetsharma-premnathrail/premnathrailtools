import { TourStep } from '../types'

/** Steps for the e-invoice / e-way bill fields on the Sales page (shared by
 *  the New sales invoice form and the E-invoice dialog). */
export const EINVOICE_FIELD_STEPS: TourStep[] = [
  {
    target: 'fin-einv-irn',
    title: 'IRN',
    purpose: 'Invoice Reference Number generated on the government e-invoice (IRP) portal.',
    whatToEnter: 'Paste the full 64-character IRN. A counter shows how many characters you have.',
    invalidExample: 'A shortened or partly copied IRN (not 64 characters)',
    why: 'E-invoicing is mandatory above ₹5 crore turnover; a B2B invoice without a valid IRN is not a valid tax invoice for the customer.',
  },
  {
    target: 'fin-einv-ack-no',
    title: 'Ack no.',
    purpose: 'The acknowledgement number the IRP returns with the IRN.',
  },
  {
    target: 'fin-einv-ack-date',
    title: 'Ack date',
    purpose: 'Date of that acknowledgement.',
  },
  {
    target: 'fin-einv-ewb',
    title: 'E-way bill no.',
    whatToEnter: 'The 12-digit e-way bill number from the EWB portal (digits only).',
    validExample: '331009876543',
    invalidExample: 'EWB-3310 (letters) or 10 digits',
    why: 'Goods worth over ₹50,000 cannot move by road without an e-way bill.',
  },
  {
    target: 'fin-einv-ewb-date',
    title: 'E-way bill date',
  },
  {
    target: 'fin-einv-vehicle',
    title: 'Vehicle no.',
    whatToEnter: 'Registration number of the truck carrying the goods (saved in capitals).',
    validExample: 'HR55AB1234',
  },
]
