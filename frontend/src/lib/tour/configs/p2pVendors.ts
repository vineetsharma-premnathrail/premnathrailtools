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
    { target: 'vendors-stats', title: 'Counters', purpose: 'Vendors shown, and how many of them are Active, Inactive or Blocked. They follow the search and the Filters.' },
    { target: 'vendors-search', title: 'Search', purpose: 'Type a name, code, GSTIN, city or contact — the list narrows as you type.' },
    { target: 'vendors-filter-btn', title: 'Filters', purpose: 'Opens the Filters popup. Status: Active (the default), Inactive, Blocked or All statuses. Press Apply Filters to use it; Clear goes back to Active vendors.', required: false },
    { target: 'vendors-table', title: 'Vendor list', purpose: 'Code, company, contact, city, GSTIN, who referred and added the vendor, catalog item count and status. Click a row to open the vendor page. Long names are cut with "…" — hover for the full text.' },
    { target: 'vendors-add-btn', title: '+ Add Vendor', purpose: 'Company name, contact person and number, address, GST and the vendor\'s own terms. A code (V-0001…) is given automatically. "Referred by" is required — pick the employee, External (type the name) or Direct. "Created by" is recorded automatically and shown in the list and on the vendor page.' },
    { target: 'vendors-import-btn', title: 'Import', purpose: 'Add many vendors from a CSV / Excel sheet. A vendor already in the master (same name or GSTIN) is left unchanged.' },
    { target: 'vendors-export-btn', title: 'Export', purpose: 'Download vendors to Excel — All (optionally by date added) or Selective.' },
  ],
}

export default config
