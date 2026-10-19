import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'sales-order-detail',
  pageTitle: 'Sales Order',
  steps: [
    {
      target: 'sales-detail-actions',
      title: 'Actions',
      purpose: 'Only the actions allowed for this order’s status and your role are shown.',
      options: [
        { value: 'Submit for approval', meaning: 'Checks PO, PO document, full schedule, 100% billing plan, LD and warranty; then routes to the approvers.' },
        { value: 'Approve / Return / Reject', meaning: 'In the Approval panel below the header while the order is pending (or in My Approvals). Return sends it back to draft with your comment; Reject cancels it for good. Who approves, and above which value, is set in Organization › Approval Workflows.' },
        { value: 'Mark OA issued', meaning: 'Records that the order acknowledgement was sent to the customer.' },
        { value: 'Hold / Resume / Cancel / Short-close / Close', meaning: 'Stops or ends the order — always with a reason. Cancel after confirmation, short-close and close are for the Sales Head.' },
      ],
      why: 'Status changes only through these buttons, never by editing a status field — so every change has a who, when and why.',
    },
    {
      target: 'sales-detail-order-project',
      title: 'Order Project',
      purpose: 'Once an order with an RRV line is confirmed, its execution project (OP-YYYY-NNN) is created automatically. Click to open its 360 view of every vehicle.',
    },
    {
      target: 'sales-detail-stepper',
      title: 'Where the order is',
      purpose: 'Draft → Pending approval → Confirmed → In execution → Partially delivered → Delivered → Closed.',
    },
    {
      target: 'sales-detail-tabs',
      title: 'Tabs',
      purpose: 'Overview (terms), Lines, Delivery Schedule (vehicles, builds, LD, DP extensions), Billing Plan, Amendments, Documents (PO and the order acknowledgement), Approvals and Timeline.',
      why: 'After confirmation the contract is frozen: dates, quantities, prices and terms change only through an approved amendment, so the order always matches what the customer agreed in writing.',
    },
  ],
}

export default config
