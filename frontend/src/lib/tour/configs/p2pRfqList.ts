import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-rfq-list',
  pageTitle: 'Quotation requests (RFQ)',
  steps: [
    {
      target: 'rfq-awaiting-table',
      title: 'Purchase requests waiting for quotations',
      purpose: 'Every approved Purchase Requisition that doesn\'t have an RFQ raised against it yet. When none are waiting, the page says so and offers View requisitions; the quotation requests already sent are then shown first.',
    },
    {
      target: 'rfq-start-btn',
      title: 'Start RFQ',
      purpose: 'Opens the Raise RFQ form with this Purchase Requisition already selected.',
      after: 'Takes you to a separate Raise RFQ page — its own guided tour covers every field there.',
    },
    {
      target: 'rfq-list-table',
      title: 'RFQ Number / Purchase Requisition Number / Status / Vendors / Created',
      purpose: 'Every RFQ raised so far, its linked requisition, whether it is still a Draft or Closed (vendor chosen), and whether it went to several vendors or to one vendor only.',
    },
    {
      target: 'rfq-list-view',
      title: 'View',
      purpose: 'Click View — or anywhere on the row — to open this RFQ\'s full detail: vendor quotations, commercial terms, and the PO drafting workflow.',
    },
  ],
}

export default config
