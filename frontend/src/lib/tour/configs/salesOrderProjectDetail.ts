import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'sales-order-project-detail',
  pageTitle: 'Order Project',
  steps: [
    {
      target: 'sales-op-summary',
      title: 'Project summary',
      purpose: 'The customer, the sales order (click to open it), the customer PO, the project manager and the planned dates.',
      why: 'Planned dates default from the order: start = confirmation date, end = the latest contractual delivery date.',
    },
    {
      target: 'sales-op-edit',
      title: 'Edit project',
      purpose: 'Assign the project manager and adjust the planned dates. Vehicles and lots are never typed — they follow the sales order and its amendments.',
    },
    {
      target: 'sales-op-actions',
      title: 'Hold / resume',
      purpose: 'Put the project on hold so no department links new work to it, and resume it later. Delivered, closed and cancelled follow the deliveries and the sales order.',
    },
    {
      target: 'sales-op-360',
      title: '360 view',
      purpose: 'One row per vehicle (each delivery row of an RRV line) and per spares lot, with where it stands in each department. “—” means nothing is linked yet; Dispatch and Delivered come from the delivery records.',
      why: 'A vehicle removed by an amendment stays here as Cancelled, so links other departments already made remain traceable.',
    },
  ],
}

export default config
