import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'sales-order-projects',
  pageTitle: 'Order Projects',
  steps: [
    {
      target: 'sales-nav-folder',
      title: 'Order Projects tab',
      purpose: 'Every confirmed RRV order becomes an execution project (OP-YYYY-NNN). Design, Purchase, Store, Production, Quality and Dispatch work against the project and its vehicles, not against the sales order.',
      why: 'The sales order is the commercial contract; the project is the execution — like a project in SAP PS.',
    },
    {
      target: 'sales-op-backfill',
      title: 'Create projects for confirmed orders',
      purpose: 'Admins only: creates projects for orders confirmed before Order Projects existed. Orders that already have one are left alone.',
    },
    {
      target: 'sales-op-filters',
      title: 'Search and filter',
      purpose: 'Find a project by OP number, SO number, customer or customer PO, or show one status.',
    },
    {
      target: 'sales-op-table',
      title: 'Projects',
      purpose: 'One row per project: its sales order, vehicles delivered so far, the project manager and the planned end. Click a row to open the 360 view.',
      why: 'A project is created automatically when an order with an RRV line is confirmed; orders for spares from stock or service only get none.',
    },
  ],
}

export default config
