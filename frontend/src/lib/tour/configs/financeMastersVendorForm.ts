import { TourConfig, TourStep } from '../types'

export const VENDOR_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-vendors-code',
    title: 'Code',
    required: true,
    whatToEnter: 'A short unique vendor code.',
    validExample: 'V-0042',
  },
  {
    target: 'fin-vendors-name',
    title: 'Name',
    required: true,
    whatToEnter: 'Legal name exactly as on the vendor\'s GST registration / invoice.',
    validExample: 'Shree Ganesh Steel Traders',
    why: 'Bills against a PO are matched to this vendor by name when the PO has no vendor link, so spell it the same way Purchase does.',
  },
  {
    target: 'fin-vendors-gst-type',
    title: 'GST registration',
    options: [
      { value: 'Regular', meaning: 'Normal GST-registered supplier — their GST is claimable as input credit. GSTIN required.' },
      { value: 'Composition', meaning: 'Small taxpayer paying flat tax; cannot charge GST, so no input credit. GSTIN required.' },
      { value: 'Unregistered', meaning: 'No GSTIN — no input credit (some supplies fall under reverse charge).' },
      { value: 'Overseas (import)', meaning: 'Foreign supplier; GST is paid at customs (IGST on import).' },
      { value: 'SEZ', meaning: 'Supplier in a Special Economic Zone. GSTIN required.' },
    ],
    why: 'Decides whether the GST on their bills can be taken as input credit — which directly reduces the GST we pay each month.',
  },
  {
    target: 'fin-vendors-gstin',
    title: 'GSTIN',
    whatToEnter: '15-character GST number. Format and check digit are verified; PAN is filled from it automatically. Required for Regular, Composition and SEZ.',
    validExample: '06AABCS1429B1ZB',
    invalidExample: '06AABCS1429B1Z (14 characters) or a wrong last check character',
  },
  {
    target: 'fin-vendors-pan',
    title: 'PAN',
    whatToEnter: '10-character PAN — 5 letters, 4 digits, 1 letter. Auto-filled from the GSTIN.',
    validExample: 'AABCS1429B',
  },
  {
    target: 'fin-vendors-status',
    title: 'Status',
    options: [
      { value: 'Active', meaning: 'Can be billed and paid.' },
      { value: 'Inactive', meaning: 'No longer used; history kept.' },
      { value: 'Blocked', meaning: 'Barred — cannot be picked on new direct bills (e.g. quality or compliance issue).' },
    ],
  },
  {
    target: 'fin-vendors-address',
    title: 'Address',
    whatToEnter: 'Street address of the vendor.',
  },
  {
    target: 'fin-vendors-city',
    title: 'City',
    validExample: 'Ludhiana',
  },
  {
    target: 'fin-vendors-state',
    title: 'State (place of supply)',
    purpose: 'Used to decide CGST + SGST (same state as us) or IGST (other state) when the vendor has no GSTIN.',
  },
  {
    target: 'fin-vendors-pin',
    title: 'PIN',
    whatToEnter: '6-digit PIN code.',
    validExample: '121003',
  },
  {
    target: 'fin-vendors-contact-name',
    title: 'Contact name',
    whatToEnter: 'Person at the vendor for accounts queries.',
  },
  {
    target: 'fin-vendors-contact-phone',
    title: 'Contact phone',
    validExample: '9876543210',
  },
  {
    target: 'fin-vendors-contact-email',
    title: 'Contact email',
    validExample: 'accounts@vendor.com',
  },
  {
    target: 'fin-vendors-bank-name',
    title: 'Bank name',
    purpose: 'Vendor\'s bank — used when making NEFT/RTGS payments.',
  },
  {
    target: 'fin-vendors-bank-account',
    title: 'Bank account no.',
    whatToEnter: 'Vendor\'s account number from their cancelled cheque / bank letter.',
  },
  {
    target: 'fin-vendors-ifsc',
    title: 'IFSC',
    validExample: 'SBIN0001234',
  },
  {
    target: 'fin-vendors-holder',
    title: 'Account holder',
    whatToEnter: 'Name on the vendor\'s bank account.',
  },
  {
    target: 'fin-vendors-credit-limit',
    title: 'Credit limit (₹)',
    whatToEnter: 'Optional — the maximum outstanding the vendor allows us.',
    validExample: '500000',
  },
  {
    target: 'fin-vendors-payment-days',
    title: 'Payment days',
    whatToEnter: 'Agreed credit period in days.',
    validExample: '45',
    after: 'A bill\'s due date defaults to bill date + these days, which drives payables ageing and payment planning.',
  },
  {
    target: 'fin-vendors-expense-ledger',
    title: 'Default expense ledger',
    purpose: 'Optional ledger used on this vendor\'s direct bills when a line has no ledger — e.g. "Electricity" for the power company.',
  },
  {
    target: 'fin-masters-form-save',
    title: 'Create Vendor / Save Changes',
    purpose: 'Saves the vendor. Code and name are required.',
    after: 'The vendor becomes available on purchase invoices, debit notes and payments.',
  },
  {
    target: 'fin-masters-form-cancel',
    title: 'Cancel',
    purpose: 'Closes the form without saving.',
  },
]

const config: TourConfig = {
  id: 'finance-masters-vendor-form',
  pageTitle: 'Finance — Vendor form',
  steps: [
    {
      target: 'fin-subtab-vendors',
      title: 'Vendors',
      purpose: 'You are adding or editing a vendor.',
    },
    ...VENDOR_FORM_STEPS,
  ],
}

export default config
