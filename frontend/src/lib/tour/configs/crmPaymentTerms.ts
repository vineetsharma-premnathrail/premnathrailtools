import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-payment-terms',
  pageTitle: 'Payment Terms List',
  steps: [
    {
      target: 'pt-add-btn',
      title: '+ Add Payment Term',
      purpose: 'A reusable payment-terms wording you can pick later from any quotation, instead of retyping it every time.',
      after: 'Opens the form below the button.',
    },
    {
      target: 'pt-label',
      title: 'Label',
      required: true,
      purpose: 'Short name shown when picking this term on a quotation.',
      validExample: '50/50 Advance',
    },
    {
      target: 'pt-description',
      title: 'Description / Terms Text',
      required: false,
      purpose: 'The actual wording that gets used on the quotation when this term is picked. If left blank, the Label itself is used as the wording.',
      validExample: '50% advance and 50% before delivery',
    },
    {
      target: 'pt-save',
      title: 'Save',
      purpose: 'Saves this payment term to the shared list.',
      after: 'Immediately available in the Payment Terms picker on the Create Quotation form.',
    },
    {
      target: 'pt-table',
      title: 'Payment Terms table',
      purpose: 'Every saved payment term, with Edit/Delete actions. Shows "No payment terms yet" until at least one is added.',
    },
  ],
}

export default config
