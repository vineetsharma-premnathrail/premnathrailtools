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
      target: 'sales-dash-tiles',
      title: 'Order book at a glance',
      purpose: 'Number of active sales orders, vehicles due this month, overdue vehicles (and how many more are at risk) and orders waiting for approval. Open Sales Orders for the details of each order.',
    },
  ],
}

export default config
