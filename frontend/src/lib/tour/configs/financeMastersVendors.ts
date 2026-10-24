import { TourConfig } from '../types'
import { VENDOR_FORM_STEPS } from './financeMastersVendorForm'

const config: TourConfig = {
  id: 'finance-masters-vendors',
  pageTitle: 'Finance — Vendors',
  steps: [
    {
      target: 'fin-subtab-vendors',
      title: 'Vendors',
      purpose: 'Supplier master for accounts. Vendors are a sub-ledger: their bills post through the Sundry Creditors control account.',
      autoActivate: true,
    },
    {
      target: 'fin-vendors-search',
      title: 'Search',
      purpose: 'Filters by code, name, GSTIN or city as you type.',
      validExample: 'ludhiana',
    },
    {
      target: 'fin-vendors-table',
      title: 'Vendor list',
      purpose: 'Code, name, GST type, GSTIN, city/state, payment days, who referred the vendor, who created it (recorded automatically; a dash for older vendors) and status.',
      options: [
        { value: 'Active', meaning: 'Can be billed and paid.' },
        { value: 'Inactive', meaning: 'Not used any more.' },
        { value: 'Blocked', meaning: 'Barred from new direct bills.' },
        { value: 'Edit / Delete', meaning: 'Delete only works for a vendor with no bills or ledger entries — otherwise set Inactive or Blocked.' },
      ],
    },
    {
      target: 'fin-vendors-new-btn',
      title: '+ New Vendor',
      purpose: 'Adds a supplier.',
      after: 'Opens the vendor form right here — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...VENDOR_FORM_STEPS,
  ],
}

export default config
