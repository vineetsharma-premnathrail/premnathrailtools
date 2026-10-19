import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-grn-form',
  pageTitle: 'Record Goods Receipt',
  steps: [
    {
      target: 'store-grn-form-back-btn',
      title: '← Back',
      purpose: 'Returns to the Goods Receipts list without saving.',
    },
    {
      target: 'store-grn-form-po',
      title: 'Purchase Order',
      required: true,
      purpose: 'The approved Purchase Order these goods were delivered against.',
      whatToEnter: 'Search by PO number or vendor name. Only POs that still have quantity pending from the vendor are listed.',
      validExample: 'PO-2026-0142 — Shree Steels (PR-0098)',
      invalidExample: 'A PO still awaiting approval — it will not appear; get it approved in P2P first.',
      why: 'Every receipt must trace back to a PO so price, quantity and vendor are already agreed — no "free" material enters stock.',
      after: 'The Line Items table appears below with every item on that PO.',
    },
    {
      target: 'store-grn-form-location',
      title: 'Store Location',
      purpose: 'Which store/warehouse the goods physically went into.',
      whatToEnter: 'Pick the store where the material is kept. Leave "-- None --" only if the item\'s default store should be used.',
      validExample: 'Main Store — Unit 1',
      why: 'Stock balances are kept per store, so the right store is needed for the item to show up where the store keeper will look for it.',
    },
    {
      target: 'store-grn-form-date',
      title: 'Received Date',
      required: true,
      whatToEnter: 'The date the truck/parcel actually arrived (defaults to today).',
      validExample: 'Today, or yesterday if you are booking a late-evening delivery the next morning.',
      invalidExample: 'A future date.',
      why: 'Used for the vendor on-time delivery rating and as the stock ledger date.',
    },
    {
      target: 'store-grn-form-lines',
      title: 'Line Items',
      required: true,
      purpose: 'One row per PO item: Ordered Qty, Already Received on earlier GRNs, and Pending from the vendor.',
      whatToEnter: 'Blind receipt: in "Invoice Qty" copy what the vendor\'s bill / challan says; in "Received Now" type what you physically counted (it is never pre-filled). The variance between the two is shown. Pick the bin the goods are put into; serial-numbered items need one serial per unit. At least one line needs a quantity.',
      validExample: 'Ordered 100, Already Received 40, Pending 60 → Received Now 60 (or 25 if only 25 came).',
      invalidExample: 'Received Now 70 when only 60 is pending — shown in red; any extra must go on a new PO.',
      after: 'A short receipt is allowed: the balance stays pending on the PO and Purchase is notified of the shortfall due from the vendor.',
    },
    {
      target: 'store-grn-form-fill-btn',
      title: 'Invoice qty = pending',
      purpose: 'Shortcut that fills the Invoice Qty column with each line\'s pending quantity (when the bill covers the full balance). The received quantity is still counted and entered by the store.',
    },
    {
      target: 'store-grn-form-remarks',
      title: 'Remarks',
      whatToEnter: 'Optional: condition on arrival. The vendor invoice / challan / e-way bill / vehicle go in the Gate Entry & Vendor Documents section.',
      validExample: '2 boxes damaged, seal intact',
    },
    {
      target: 'store-grn-form-save-btn',
      title: 'Save Goods Receipt',
      purpose: 'Records the receipt. Enabled once a PO is selected.',
      after: 'A GRN number is generated and you land on its detail page with status "Pending Inspection". Stock is not added yet — the quality inspection on that page accepts or rejects the quantity first.',
    },
    {
      target: 'store-grn-form-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards this receipt and goes back to the GRN list.',
    },
  ],
}

export default config
