import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-asset-detail',
  pageTitle: 'Asset',
  steps: [
    {
      target: 'maint-assetd-status',
      title: 'Asset & status',
      purpose: 'Asset code, name and current status. A red banner below appears when the asset is down, showing since when, how many work orders are open, and whether its Production workstation is blocked.',
      options: [
        { value: 'Operational', meaning: 'Running normally.' },
        { value: 'Breakdown', meaning: 'Stopped by a fault (set automatically).' },
        { value: 'Under Maintenance', meaning: 'Stopped for maintenance work (set automatically by an open work order).' },
        { value: 'Standby', meaning: 'Working but kept as backup.' },
        { value: 'Decommissioned', meaning: 'Out of service for good — no new requests, work orders or PM plans.' },
      ],
    },
    {
      target: 'maint-assetd-report-btn',
      title: 'Report Breakdown',
      purpose: 'Raise a request for this asset — the asset is already filled in.',
    },
    {
      target: 'maint-assetd-new-wo-btn',
      title: 'New Work Order',
      purpose: 'Create a maintenance job directly on this asset (planned work, improvement, inspection).',
    },
    {
      target: 'maint-assetd-label-btn',
      title: 'QR Label',
      purpose: 'Print this asset\'s QR label to stick on the machine.',
      why: 'Scanning it opens this asset on a phone so anyone can report a problem in seconds.',
    },
    {
      target: 'maint-assetd-edit-btn',
      title: 'Edit',
      purpose: 'Change the asset\'s details, location, purchase/warranty data or status.',
    },
    {
      target: 'maint-assetd-delete-btn',
      title: 'Delete',
      purpose: 'Removes the asset from the register (asks to confirm). Its request and work order history stays on record.',
      why: 'For a machine that is scrapped or sold, prefer Edit → Status = Decommissioned — it keeps the asset visible with its history.',
    },
    {
      target: 'maint-assetd-back',
      title: '← Back',
      purpose: 'Returns to the Asset Register.',
    },
    {
      target: 'maint-asset-tab-overview',
      title: 'Overview tab',
      purpose: 'All the asset\'s master data.',
      autoActivate: true,
    },
    {
      target: 'maint-assetd-details',
      title: 'Details',
      purpose: 'Category, criticality (A = line stops, B = important, C = low impact), plant, department, location, parent machine, linked Production workstation (with its current status), and number of open work orders.',
    },
    {
      target: 'maint-assetd-make',
      title: 'Make, Purchase & Warranty',
      purpose: 'Make, model, serial number, year, supplier, purchase date and cost, commissioning date, warranty and AMC expiry, and the current meter reading.',
    },
    {
      target: 'maint-asset-tab-history',
      title: 'History tab',
      purpose: 'Every request and work order ever raised on this asset.',
      autoActivate: true,
    },
    {
      target: 'maint-assetd-history',
      title: 'Maintenance history',
      purpose: 'Date, number, title, status, downtime and cost of each request/work order, newest first. Click a row to open it.',
      why: 'The machine\'s "medical record" — repeated failures of the same kind show up here and point to a root cause or a PM gap.',
    },
    {
      target: 'maint-asset-tab-pm',
      title: 'PM Plans tab',
      purpose: 'Preventive maintenance plans set up for this asset.',
      autoActivate: true,
    },
    {
      target: 'maint-assetd-pm',
      title: 'Preventive maintenance plans',
      purpose: 'Plan code, title, how often (every N days/weeks/months/years), basis, next due date (red if overdue), last done date and state.',
      options: [
        { value: 'Overdue', meaning: 'Past the due date and not done.' },
        { value: 'Due soon', meaning: 'Coming up within the plan\'s lead time — the job is (or is about to be) raised.' },
        { value: 'Scheduled', meaning: 'Active, next due date is further away.' },
        { value: 'Inactive', meaning: 'Plan switched off — no jobs are raised.' },
      ],
    },
    {
      target: 'maint-assetd-new-pm-btn',
      title: '+ New PM Plan',
      purpose: 'Create a preventive maintenance plan for this asset (asset already filled in).',
      why: 'Every A-criticality machine should have at least one PM plan.',
    },
    {
      target: 'maint-asset-tab-spares',
      title: 'Spares tab',
      purpose: 'The Bill of Spares — Store items this asset uses.',
      autoActivate: true,
    },
    {
      target: 'maint-assetd-spares',
      title: 'Bill of Spares',
      purpose: 'Each spare with quantity used per replacement, whether it is critical, on-hand stock across all stores, minimum/reorder level and a stock badge.',
      options: [
        { value: 'OK', meaning: 'Stock is above the minimum.' },
        { value: 'At reorder', meaning: 'Stock has reached the reorder level — time to buy.' },
        { value: 'Below min', meaning: 'Stock is below the minimum — a breakdown now could wait for parts.' },
        { value: 'No min set', meaning: 'No minimum stock set in Store for this item.' },
      ],
      why: 'Marking a spare critical puts it on the dashboard alert when stock drops below minimum.',
    },
    {
      target: 'maint-bos-stock-btn',
      title: 'Spares stock',
      purpose: 'Opens the Spares page with stock of all maintenance spares.',
    },
    {
      target: 'maint-bos-edit-btn',
      title: 'Edit / + Add spares',
      purpose: 'Switches the list into edit mode to add, change or remove spares.',
      after: 'Search Store items, set quantity per replacement and the critical tick, then Save. Start the tour again while editing for a guide to that screen.',
    },
    {
      target: 'maint-asset-tab-documents',
      title: 'Documents tab',
      purpose: 'Manuals, drawings, certificates and photos for this asset.',
      autoActivate: true,
    },
    {
      target: 'maint-assetd-documents',
      title: 'Manuals, drawings & photos',
      purpose: 'All files attached to the asset. Click a name to open it.',
      why: 'Having the OEM manual and wiring drawing on the phone at the machine saves time during a breakdown.',
    },
    {
      target: 'maint-attach-upload',
      title: 'Upload',
      purpose: 'Pick the document type (Manual by default), choose files and click Upload.',
    },
  ],
}

export default config
