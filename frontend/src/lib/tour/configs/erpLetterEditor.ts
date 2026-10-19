import { TourConfig } from '../types'

// The machine Documents tab's "Create document" dialog (LetterEditorDialog).
// Loaded instead of the machine detail tour whenever the dialog is open.
const config: TourConfig = {
  id: 'erp-letter-editor',
  pageTitle: 'Create Machine Document',
  steps: [
    {
      target: 'erp-letter-types',
      title: 'Pick the document',
      purpose: 'Choose what to create.',
      options: [
        { value: 'Delivery Cover Letter', meaning: 'Goes with the machine and lists the documents handed over (invoice, guarantee, test reports…).' },
        { value: 'Delivery Confirmation', meaning: 'Delivery note listing every delivery challan; the customer signs it as proof of delivery.' },
        { value: 'Guarantee Certificate', meaning: 'Quality guarantee against the LOA — months from commissioning or supply, whichever ends later.' },
      ],
      why: 'Delivery documents are printed in two copies — Original for the recipient and Duplicate that comes back to us signed, as proof of delivery for billing.',
    },
    {
      target: 'erp-letter-back-btn',
      title: 'Change document',
      purpose: 'Goes back to the document-type choice (bottom-left of the popup).',
    },
    {
      target: 'erp-letter-subject',
      title: 'Subject',
      required: true,
      validExample: 'Commissioning of machine PEW-62-2',
    },
    {
      target: 'erp-letter-to',
      title: 'To',
      required: true,
      purpose: 'Recipient block, one line per row — pre-filled from the machine\'s client contact.',
    },
    {
      target: 'erp-letter-body',
      title: 'Letter',
      required: true,
      whatToEnter: 'The body text. Leave a blank line between paragraphs.',
    },
    {
      target: 'erp-letter-loa',
      title: 'LOA / PO reference',
      required: true,
      purpose: 'Customer\'s Letter of Acceptance / PO number and date, plus any amendments. Pre-filled from the machine\'s PO fields.',
      validExample: 'IRCON/3026/MAHSR-T2/520 DATE. 21/08/2024',
    },
    {
      target: 'erp-letter-challans',
      title: 'Delivery challans',
      required: true,
      purpose: 'One line per delivery challan: challan number and what was delivered against it. Use "+ Add challan" for more lines.',
      validExample: 'DC/P1/26-27/0165 — Liquid tank assembly',
    },
    {
      target: 'erp-letter-documents',
      title: 'Documents handed over',
      required: true,
      purpose: 'The list printed on the cover letter. A standard list is pre-filled — edit, remove (×) or add lines.',
    },
    {
      target: 'erp-letter-guarantee-to',
      title: 'To (guarantee)',
      required: true,
      purpose: 'Who the guarantee certificate is addressed to, one line per row.',
    },
    {
      target: 'erp-letter-signatory',
      title: 'Signatory',
      purpose: 'Name and designation printed under the signature. Click a partner\'s name to sign as that partner.',
      why: 'Partners are the company\'s authorised signatories; they are set in Organization → Company Info → Partners.',
    },
    {
      target: 'erp-letter-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the dialog without saving.',
    },
    {
      target: 'erp-letter-save-btn',
      title: 'Save',
      purpose: 'Saves the document and gives it its reference number.',
      after: 'It appears under Documents → Created, where you can open the PDF or edit it later.',
    },
    {
      target: 'erp-letter-save-word-btn',
      title: 'Save & Edit in Word',
      purpose: 'Saves, then opens the generated Word document so you can fine-tune the wording before printing.',
      after: 'Changes made in Word are kept as the document\'s managed copy.',
    },
  ],
}

export default config
