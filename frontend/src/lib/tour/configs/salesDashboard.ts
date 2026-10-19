import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'sales-dashboard',
  pageTitle: 'Sales Dashboard',
  steps: [
    {
      target: 'sales-nav-dashboard',
      title: 'Sales module',
      purpose: 'Sales owns the customer contract — the Sales Order — between CRM (the pursuit) and Production / Finance (execution). The quotation stays in CRM; the tax invoice stays in Finance.',
      why: 'Every ERP keeps Quotation → Customer PO → Sales Order → Invoice as separate documents because each has a different legal meaning. The order is the one place every department reads the contract from.',
    },
    {
      target: 'sales-dash-new',
      title: '+ New Sales Order',
      purpose: 'Starts an order from a customer PO. From a won CRM inquiry or tender, use the deep link (?inquiry= / ?tender=) so the lines and terms are copied in.',
      after: 'Opens the order form, which has its own tour.',
    },
    {
      target: 'sales-dash-tiles',
      title: 'Order book at a glance',
      purpose: 'Open order value, vehicles due this month, overdue vehicles, LD accrued (and forecast from Production’s target dates) and orders waiting for approval.',
      why: 'LD (liquidated damages, typically ½% per week capped at 10%) can wipe out a vehicle’s margin. Seeing it before it happens lets you prioritise a build or ask for a DP extension.',
    },
    {
      target: 'sales-dash-approvals',
      title: 'Approvals waiting for me',
      purpose: 'Orders whose next approval step is yours (Sales Head → Director → Partner, by value and non-standard terms — stages set in Organization › Approval Workflows). You never see orders you submitted yourself — four-eyes rule.',
    },
    {
      target: 'sales-dash-risk',
      title: 'Vehicles at risk or overdue',
      purpose: 'Each row is one vehicle. At risk = the build’s target handover is after the contractual date, or the date is close and the build hasn’t reached Final Inspection. Overdue = the date has passed.',
    },
    {
      target: 'sales-dash-extensions',
      title: 'DP extensions',
      purpose: 'Delivery-period extensions requested from the customer and not yet answered.',
      why: 'A late delivery is not automatically an LD — if the delay was the customer’s fault, the extension is usually granted without LD. Recording it with their letter is the evidence if LD is deducted wrongly.',
    },
  ],
}

export default config
