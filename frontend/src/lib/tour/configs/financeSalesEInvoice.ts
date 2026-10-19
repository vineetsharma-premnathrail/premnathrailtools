import { TourConfig } from '../types'
import { EINVOICE_FIELD_STEPS } from './financeEInvoiceSteps'

const config: TourConfig = {
  id: 'finance-sales-einvoice',
  pageTitle: 'Finance — E-invoice / e-way bill',
  steps: [
    {
      target: 'fin-einv-dialog',
      title: 'E-invoice / e-way bill',
      purpose: 'Record the IRN (from the IRP e-invoice portal) and the e-way bill (from the EWB portal) against this invoice.',
      why: 'These are generated on the government portals; the portal only stores them so the invoice print and records are complete. No amount changes.',
    },
    ...EINVOICE_FIELD_STEPS,
    {
      target: 'fin-einv-save',
      title: 'Save details',
      purpose: 'Saves the numbers.',
      after: 'The dialog closes and IRN / EWB badges appear on the invoice row.',
    },
    {
      target: 'fin-einv-close',
      title: 'Close',
      purpose: 'Closes without saving (Esc works too).',
    },
  ],
}

export default config
