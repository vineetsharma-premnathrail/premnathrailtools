import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-wo-list',
  pageTitle: 'Work Orders',
  steps: [
    {
      target: 'production-nav-clipboard',
      title: 'Work Orders tab',
      purpose: 'A work order (WO) is the instruction to build a quantity of one product from its active BOM. It reserves and issues material from Store, puts the routing steps on the shop floor, collects time bookings and finally receives the finished goods into Store.',
    },
    {
      target: 'production-wo-new-btn',
      title: '+ New Work Order',
      purpose: 'Raise a new work order.',
      after: 'Opens the form. The order is saved as a Draft first.',
    },
    {
      target: 'production-wo-status-tabs',
      title: 'Status tabs',
      purpose: 'Filter the list by where orders are in their life.',
      options: [
        { value: 'Open', meaning: 'Draft, Released and In Progress together — everything still to be built.' },
        { value: 'Draft', meaning: 'Created, still editable; nothing reserved, not on the shop floor.' },
        { value: 'Released', meaning: 'Sent to the shop floor and material reserved in Store; quantity locked.' },
        { value: 'In Progress', meaning: 'Work has started on at least one operation.' },
        { value: 'Completed', meaning: 'Production finished; return unused material, then close.' },
        { value: 'Closed', meaning: 'Locked for reporting — costs final.' },
        { value: 'Cancelled', meaning: 'Stopped, with a reason recorded.' },
        { value: 'All', meaning: 'Every work order regardless of status.' },
      ],
    },
    {
      target: 'production-wo-search',
      title: 'Search',
      purpose: 'Find an order by WO number or product.',
    },
    {
      target: 'production-wo-priority-filter',
      title: 'Priority filter',
      options: [
        { value: 'Low', meaning: 'Stock build, no deadline pressure.' },
        { value: 'Normal', meaning: 'Standard order.' },
        { value: 'High', meaning: 'Customer is waiting — schedule ahead of normal work.' },
        { value: 'Urgent', meaning: 'Breakdown or penalty risk — do first.' },
      ],
    },
    {
      target: 'production-wo-overdue-filter',
      title: 'Overdue only',
      purpose: 'Tick to show only open orders past their planned end date.',
    },
    {
      target: 'production-wo-table',
      title: 'Work order list',
      purpose: 'Each order with product, machine/project it is for, quantity, progress (built vs planned), priority, planned end and status. Click a row to open it.',
    },
  ],
}

export default config
