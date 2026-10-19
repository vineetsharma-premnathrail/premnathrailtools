import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-vendors',
  pageTitle: 'Vendors',
  steps: [
    {
      target: 'p2p-nav-users',
      title: 'Vendors',
      purpose: 'One vendor master for Procurement and Finance. RFQ vendor slots are picked from here and the PO links to the vendor, so the vendor\'s invoice matches the PO in Finance.',
    },
    { target: 'vendors-add-btn', title: '+ Add Vendor', purpose: 'Company name, contact person and number, address, GST and the vendor\'s own terms. A code (V-0001…) is given automatically.' },
    { target: 'vendors-import-btn', title: 'Import', purpose: 'Add many vendors from a CSV / Excel sheet. A vendor already in the master (same name or GSTIN) is left unchanged.' },
    { target: 'vendors-export-btn', title: 'Export', purpose: 'Download vendors to Excel — All (optionally by date added) or Selective.' },
  ],
}

export default config
