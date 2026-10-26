import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'sales-orders-list',
  pageTitle: 'Sales Orders',
  steps: [
    {
      target: 'sales-nav-orders',
      title: 'Sales Orders tab',
      purpose: 'All customer orders. One order per customer PO / LOA — a PO for 4 RRVs is one order with one line (qty 4) and four delivery rows, one per vehicle.',
    },
    {
      target: 'sales-orders-new',
      title: '+ New Sales Order',
      purpose: 'Creates a draft. The SO number (SO/<FY>/<NNNN>) is issued only when the order is confirmed, so the series has no gaps — drafts show as “Draft #id”.',
    },
    {
      target: 'sales-orders-filters',
      title: 'Filters',
      purpose: 'Search by SO / PO / LOA number or customer; filter by status, due month (pick it from the month picker), orders waiting for your approval, or orders with vehicles at risk / overdue (the two toggle buttons). Clear resets all of them. Click a row to open that order.',
    },
    {
      target: 'sales-orders-table',
      title: 'Order list',
      purpose: 'Click a row to open the order.',
      options: [
        { value: 'Draft', meaning: 'Being prepared by the maker. Editable.' },
        { value: 'Pending approval', meaning: 'Submitted; waiting for the next approver shown under the status.' },
        { value: 'Confirmed', meaning: 'Approved. SO number issued, contract frozen — changes only through an amendment.' },
        { value: 'In execution', meaning: 'At least one vehicle’s build has started.' },
        { value: 'On hold / Cancelled / Short-closed', meaning: 'Stopped, with the reason recorded on the order.' },
      ],
    },
  ],
}

export default config
