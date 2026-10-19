import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-wo-detail',
  pageTitle: 'Work Order',
  steps: [
    {
      target: 'production-wo-detail-header',
      title: 'WO number and status',
      purpose: 'A red "Overdue" badge appears when the planned end date has passed.',
      options: [
        { value: 'Draft', meaning: 'Editable; nothing reserved; not on the shop floor.' },
        { value: 'Released', meaning: 'On the shop floor; material reserved; quantity locked.' },
        { value: 'In Progress', meaning: 'At least one operation started.' },
        { value: 'Completed', meaning: 'Production finished; return unused material, then close.' },
        { value: 'Closed', meaning: 'Locked; costs final.' },
        { value: 'Cancelled', meaning: 'Stopped with a reason.' },
      ],
    },
    {
      target: 'production-wo-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the Work Orders list.',
    },
    {
      target: 'production-wo-release-btn',
      title: 'Release to Shop Floor',
      purpose: 'Draft only. Starts the order.',
      after: 'Its operations appear on the Shop Floor board, free stock is reserved in Store for its components, and the planned quantity locks. Both store locations must be set first.',
    },
    {
      target: 'production-wo-complete-btn',
      title: 'Complete Work Order',
      purpose: 'In Progress only. Declares production finished with the quantity received so far.',
      after: 'Return any unused material afterwards from the Materials tab.',
    },
    {
      target: 'production-wo-close-btn',
      title: 'Close Work Order',
      purpose: 'Completed only. Locks the order and its costs for reporting. Cannot be undone.',
    },
    {
      target: 'production-wo-edit-btn',
      title: 'Edit Details',
      purpose: 'Opens the Edit Work Order popup (dates, priority, supervisor, machine, store locations; quantity only while Draft).',
    },
    {
      target: 'production-wo-job-card-btn',
      title: 'Print Job Card',
      purpose: 'Prints the job card — the paper traveller with material list, operations and instructions that goes with the job on the floor.',
    },
    {
      target: 'production-wo-cancel-btn',
      title: 'Cancel Work Order',
      purpose: 'Stops a released/in-progress order. A reason is required and kept on record.',
    },
    {
      target: 'production-wo-delete-btn',
      title: 'Delete Draft',
      purpose: 'Draft only. Removes the order permanently.',
    },
    {
      target: 'production-wo-info',
      title: 'Order details',
      purpose: 'Product, BOM version, machine/project (or stock build), linked RRV build, priority, planned vs actual dates, store locations, supervisor, scrapped quantity, and an output progress bar (received into Store vs planned).',
    },
    {
      target: 'production-wo-tab-materials',
      title: 'Materials tab',
      autoActivate: true,
      purpose: 'What components the order needs and how much has moved. "(n short)" in the tab means some items cannot be fully covered.',
    },
    {
      target: 'production-wo-materials',
      title: 'Material Requirement',
      purpose: 'Per item: Required, Issued, Returned, Outstanding (still to issue), Reserved for this order and Free stock at the source location.',
    },
    {
      target: 'production-wo-reserve-btn',
      title: 'Top Up Reservation',
      purpose: 'Shown when items are short. After new stock arrives, click to reserve it for this order.',
      why: 'Reservation stops another order or an issue slip from taking stock this order is counting on.',
    },
    {
      target: 'production-wo-return-btn',
      title: 'Return Unused',
      purpose: 'Opens the Return Unused Material popup to send unused material back to Store.',
      after: 'Stock goes back in and the order\'s actual material cost is reduced.',
    },
    {
      target: 'production-wo-issue-btn',
      title: 'Issue from Store',
      autoActivateOnAdvance: true,
      purpose: 'Opens the Issue Materials popup, pre-filled with the outstanding quantity per item (capped at reserved + free). Adjust the quantities, pick the location and click "Post Issue".',
      after: 'Stock moves out of Store to this order and its value counts as actual material cost. If any line is short, the whole issue is rejected and nothing moves.',
    },
    {
      target: 'production-wo-material-location',
      title: 'Issue From / Return Into',
      purpose: 'Store location for this posting. Leave as Default to use the order\'s source location.',
    },
    {
      target: 'production-wo-material-post-btn',
      title: 'Post Issue / Post Return',
      purpose: 'Saves the stock movement.',
    },
    {
      target: 'production-wo-tab-operations',
      title: 'Operations tab',
      autoActivate: true,
      purpose: 'The routing steps of this order; the count shows completed vs total.',
    },
    {
      target: 'production-wo-operations',
      title: 'Routing Operations',
      purpose: 'Each step with workstation, actual vs planned hours, good and scrap quantities, quality gate status and step status (Pending, In Progress, Completed).',
    },
    {
      target: 'production-wo-op-start-btn',
      title: 'Start',
      purpose: 'Marks the step started. The first start moves the order to In Progress.',
    },
    {
      target: 'production-wo-op-log-btn',
      title: 'Log Time',
      purpose: 'Opens the Log Time popup: date, hours (required), operator, good qty, scrap qty and remarks, then "Book Time".',
      why: 'Booked hours × workstation rate is the actual labour cost of the order.',
    },
    {
      target: 'production-wo-op-inspect-btn',
      title: 'Request Inspection',
      purpose: 'For a quality-gate step: asks Quality to inspect. Reads "Re-inspect" after a failure.',
      after: 'Quality is notified; the Quality column shows the inspection number and status.',
    },
    {
      target: 'production-wo-op-complete-btn',
      title: 'Complete',
      purpose: 'Finishes the step. Disabled on a quality-gate step until the inspection is passed.',
    },
    {
      target: 'production-wo-tab-output',
      title: 'Output & Stock tab',
      autoActivate: true,
      purpose: 'Receive finished units and see every Store movement for this order.',
    },
    {
      target: 'production-wo-movements',
      title: 'Store Ledger Movements',
      purpose: 'Every issue, return and receipt posted for this order, with date, item, quantity, location, batch and who did it.',
    },
    {
      target: 'production-wo-receive',
      title: 'Receive Finished Goods',
      purpose: 'In Progress only. Shows how much is still to receive. Every quality-gate operation must be passed first.',
    },
    {
      target: 'production-wo-receive-open-btn',
      title: 'Receive Output',
      autoActivateOnAdvance: true,
      purpose: 'Opens the Receive Finished Goods popup to book built units into the "Receive Output Into" store.',
    },
    {
      target: 'production-wo-receive-qty',
      title: 'Quantity',
      required: true,
      whatToEnter: 'Units built and ready to put into stock — up to the remaining quantity shown in the label.',
      validExample: '2',
    },
    {
      target: 'production-wo-receive-batch',
      title: 'Batch / Serial',
      whatToEnter: 'Batch or serial number for the received units. Defaults to the WO number.',
      why: 'Traceability — a later complaint can be traced back to the exact work order, material and operators.',
    },
    {
      target: 'production-wo-receive-btn',
      title: 'Receive',
      purpose: 'Posts the receipt into Store.',
      after: 'Stock increases, the output progress bar updates and the movement appears in the ledger below.',
    },
    {
      target: 'production-wo-tab-time',
      title: 'Time Logs tab',
      autoActivate: true,
      purpose: 'All time booked on this order.',
    },
    {
      target: 'production-wo-time-logs',
      title: 'Time Logs',
      purpose: 'Each booking with date, operation, workstation, operator, hours and quantities. "Remove" deletes a wrong booking while the operation is still open.',
    },
    {
      target: 'production-wo-tab-costing',
      title: 'Costing tab',
      autoActivate: true,
      purpose: 'Estimated vs actual cost of this order.',
    },
    {
      target: 'production-wo-costing-kpis',
      title: 'Cost summary',
      purpose: 'Estimated cost (BOM standard), Actual cost (material issued net of returns + hours × workstation rate), Variance (red when over estimate) and Cost per Unit with actual vs planned hours.',
      why: 'Variance tells you whether the BOM/routing estimate is realistic and where money is being lost.',
    },
    {
      target: 'production-wo-costing-items',
      title: 'Material Cost by Item',
      purpose: 'Per component: unit cost, required vs consumed quantity, and estimated vs actual value — shows which items caused a material variance.',
    },
  ],
}

export default config
