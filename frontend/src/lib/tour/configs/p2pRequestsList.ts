import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-requests-list',
  pageTitle: 'Purchase Requisitions',
  steps: [
    {
      target: 'p2p-nav-file',
      title: 'Purchase Requisitions tab',
      purpose: 'Your own Purchase Requisitions (PRs) — the request to buy something. Every purchase in the company starts here.',
      why: 'A PR is the formal "I need this" before money is committed. It is approved by the right heads first, so nobody buys without sanction and every purchase can be traced back to who asked and why.',
    },
    {
      target: 'p2p-nav-users',
      title: 'Vendors tab',
      purpose: 'The vendor master (shared with Finance): company, contact, GST, documents, catalog of items and prices, and the vendor\'s terms. RFQs pick their vendors from here.',
    },
    {
      target: 'p2p-nav-send',
      title: 'R.F.Q tab',
      purpose: 'Request for Quotation — the purchase team asks several vendors for prices against an approved PR and compares them. Purchase team only.',
      why: 'Getting more than one quote before ordering is basic purchase control: it proves the price was competitive and protects against favouritism.',
    },
    {
      target: 'p2p-nav-clipboard',
      title: 'Purchase Orders tab',
      purpose: 'Create the PO for a requisition whose RFQ is done, approve it (PO approvers, then any one Partner) and track its delivery — all in one tab.',
    },
    {
      target: 'p2p-nav-chart',
      title: 'M.I.S Report tab',
      purpose: 'Management summary of PRs and POs for a period — counts, trends, and who is sitting on pending approvals. Exportable to Excel.',
    },
    {
      target: 'p2p-nav-settings',
      title: 'Settings (gear)',
      purpose: 'Who approves PRs and POs (a preview — set in Organization › Approval Workflows), the company\'s standard terms & conditions, and which events notify whom.',
    },
    {
      target: 'p2p-view-approvals',
      title: 'Approvals',
      purpose: 'Requisitions waiting for your approval — open one and Approve or Reject it. Shown to PR approvers and admins.',
    },
    {
      target: 'p2p-export-btn',
      title: 'Export',
      purpose: 'Downloads requisitions to Excel (one row per item): All, optionally between two request dates, or Selective.',
    },
    {
      target: 'p2p-import-btn',
      title: 'Import',
      purpose: 'Raise several requisitions from one CSV / Excel sheet — rows with the same PR Ref become one requisition.',
    },
    {
      target: 'p2p-nav-bell',
      title: 'Notifications',
      purpose: 'Bell alerts for approvals you need to give and for changes on your requisitions.',
    },
    {
      target: 'p2p-new-btn',
      title: '+ New Purchase Requisition',
      purpose: 'Opens the form to raise a brand-new Purchase Requisition (PR).',
      after: 'Takes you to a separate New Purchase Requisition page — its own guided tour covers every field there.',
    },
    {
      target: 'p2p-list-filters',
      title: 'Category / Buyer Filters',
      purpose: 'Narrow the list to one Purchase Requisition category, or to the requisitions handled by one buyer (or those with no buyer assigned yet). "Clear filters" appears once a filter is set.',
      required: false,
      options: [
        { value: 'All categories', meaning: 'No category filter — every PR is shown.' },
        { value: 'A category (e.g. Raw Material)', meaning: 'Only PRs raised under that purchase category.' },
        { value: 'All buyers', meaning: 'No buyer filter.' },
        { value: 'A buyer name', meaning: 'Only PRs the purchase team has assigned to that buyer to handle.' },
        { value: 'No buyer assigned', meaning: 'PRs the purchase team has not picked up yet — useful to spot requests nobody is working on.' },
      ],
    },
    {
      target: 'p2p-list-table',
      title: 'Purchase Requisition Number / Category / Project / Required Date / Priority / Status',
      purpose: 'Every PR you have raised, with its category, linked project, required date, priority, and current status at a glance.',
    },
    {
      target: 'p2p-list-status',
      title: 'Status badge',
      purpose: 'Where the PR is in its life cycle.',
      options: [
        { value: 'Submitted', meaning: 'Raised and waiting for the assigned heads to approve. Nobody has signed yet.' },
        { value: 'Partially Approved', meaning: 'Some of the assigned approvers have signed, others are still pending.' },
        { value: 'Approved', meaning: 'All approvers have signed. The purchase team can now get quotes (RFQ) and raise a PO.' },
        { value: 'PO Raised', meaning: 'A Purchase Order has been created for this PR and is waiting for PO approval.' },
        { value: 'PO Approved', meaning: 'The PO is approved and can be sent to the vendor.' },
        { value: 'Partially Received', meaning: 'Some of the material has arrived at the store (GRN done for part of the quantity).' },
        { value: 'Received', meaning: 'All material has arrived at the store.' },
        { value: 'Closed', meaning: 'Finished — nothing more will happen on this PR.' },
        { value: 'Rejected', meaning: 'An approver turned it down. Open it to see the reason; raise a fresh PR if still needed.' },
        { value: 'Cancelled', meaning: 'Withdrawn — no longer needed.' },
      ],
    },
    {
      target: 'p2p-list-view',
      title: 'View',
      purpose: 'Click View — or anywhere else on the row — to open that PR\'s full detail page: approval status, item list, linked RFQ/PO, and any attachments.',
    },
    {
      target: 'p2p-list-approve',
      title: 'Approve (PO)',
      purpose: 'Shown only to PO approvers on a PR whose Purchase Order is waiting for their signature — approve the PO straight from the list.',
    },
    {
      target: 'p2p-list-reject',
      title: 'Reject (PO)',
      purpose: 'Rejects the waiting Purchase Order. You can type a reason so the buyer knows what to fix.',
    },
  ],
}

export default config
