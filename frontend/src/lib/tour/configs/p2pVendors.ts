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
    { target: 'vendors-filter-btn', title: 'Filter', purpose: 'Opens the Filter panel. Status: Active (the default), Inactive, Blocked or All statuses. It applies at once; "Clear filters" goes back to Active vendors.', required: false },
    { target: 'vendors-table', title: 'Vendor list', purpose: 'Code, company, contact, city, GSTIN, who referred and added the vendor, catalog item count and status. Click a row to open the vendor page. Long names are cut with "…" — hover for the full text.' },
    { target: 'vendors-add-btn', title: '+ Add Vendor', purpose: 'Company name, contact person and number, address, GST and the vendor\'s own terms. A code (V-0001…) is given automatically. "Referred by" is required — pick the employee, External (type the name) or Direct. "Created by" is recorded automatically and shown in the list and on the vendor page.' },
    { target: 'vendors-duplicates-btn', title: 'Find duplicates', purpose: 'One click checks every vendor and lists groups that look like the same company: Same GSTIN (one GSTIN belongs to one vendor), Same name (ignoring case, punctuation, Pvt / Ltd / M/s), Similar name (a typo or a word apart) and Same PAN (one company in several states — usually fine). Click a count to see only that kind; Open ↗ opens the vendor in a new tab so you can block or correct the extra one. The POs column shows which vendor has the purchase history to keep. Nothing is changed by this check.' },
    { target: 'vendors-import-btn', title: 'Import', purpose: 'Add many vendors from a CSV / Excel sheet. A vendor already in the master (same name or GSTIN) is left unchanged.' },
    { target: 'vendors-export-btn', title: 'Export', purpose: 'Download vendors to Excel — All (optionally by date added) or Selective.' },
  ],
}

export default config
