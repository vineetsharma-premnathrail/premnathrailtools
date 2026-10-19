import { TourStep } from '../types'

/** Steps for the shared GST line-items editor (TaxLinesEditor in
 *  components/finance/financeUi.tsx) used by purchase invoices, sales
 *  invoices, debit notes and credit notes. */
export function taxLineSteps(doc: string, defaultLedger: string): TourStep[] {
  return [
    {
      target: 'fin-lines-table',
      title: 'Line items',
      purpose: `One row per item or service on the ${doc}.`,
      whatToEnter:
        'Description (what was supplied), HSN/SAC code, Qty, Unit, Rate (before GST), Discount in ₹ (optional), GST % and, only if needed, a Ledger.',
      required: true,
      options: [
        { value: 'Description', meaning: 'Item or service name as printed on the document. Required.' },
        { value: 'HSN/SAC', meaning: 'HSN code for goods, SAC code for services — needed for GST returns.' },
        { value: 'Qty × Rate − Discount', meaning: 'Gives the taxable value shown at the end of the row.' },
        { value: 'GST %', meaning: 'Pick the rate printed on the document (0, 5, 12, 18, 28 …). The list comes from Masters → GST Rates.' },
        { value: 'Ledger', meaning: `Leave on "Default ledger" (${defaultLedger}) unless this line belongs to a specific account, e.g. Freight Inward or Repairs.` },
      ],
      validExample: 'Hydraulic hose 1/2" · 40091100 · 20 Nos · ₹450 · 18%',
      invalidExample: 'Qty 0 or Rate 0 — the line has no value and the document is rejected.',
      why: 'GST is worked out line by line so items at different rates on the same document are taxed correctly.',
    },
    {
      target: 'fin-lines-add',
      title: '+ Add line',
      purpose: 'Adds another row. The ✕ at the end of a row removes it (only when there is more than one row).',
    },
    {
      target: 'fin-lines-totals',
      title: 'Tax preview',
      purpose:
        'Live totals: taxable value, then CGST + SGST (same state) or IGST (different state), and the document value before round-off.',
      why: 'Same-state supply is split half CGST / half SGST; inter-state supply is charged IGST. The state comes from the party\'s GSTIN and the place of supply.',
      after: 'This is only a preview — the server recalculates on save and its figures are what get stored.',
    },
  ]
}
