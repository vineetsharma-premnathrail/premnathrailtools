import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-uoms',
  pageTitle: 'Store Settings — Units of Measure',
  steps: [
    {
      target: 'uom-add-btn',
      title: '+ Add Unit',
      purpose: 'Creates a new unit of measure. Units are shared by Store items and Purchase Request lines.',
      after: 'Opens a small form — the next steps walk through it.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'store-master-field-code',
      title: 'Unit code',
      required: true,
      whatToEnter: 'Short code, auto-uppercased, max 20 characters. Prefer standard GST UQC codes.',
      validExample: 'KGS, NOS, MTR, LTR, SET',
      invalidExample: 'Kilogram (that is the name — put it in Unit name)',
      why: 'The code is what prints on POs, GRNs and invoices; standard codes avoid mismatch with vendor bills and e-invoice data.',
    },
    {
      target: 'store-master-field-label',
      title: 'Unit name',
      whatToEnter: 'Optional full name shown next to the code in dropdowns.',
      validExample: 'Kilogram',
    },
    {
      target: 'store-master-save-btn',
      title: 'Save',
      purpose: 'Saves the unit.',
      after: 'Available at once in the item form and on Purchase Request lines. Renaming a code later also moves every item on it to the new code.',
    },
    {
      target: 'store-master-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the form without saving.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'uom-table',
      title: 'Units list',
      purpose: 'Every unit code and name.',
    },
    {
      target: 'uom-edit-link',
      title: 'Edit',
      purpose: 'Change the code or name of a unit.',
    },
    {
      target: 'uom-delete-link',
      title: 'Delete',
      purpose: 'Permanently removes a unit after you confirm.',
      after: 'Refused with the reason if items still use it.',
    },
  ],
}

export default config
