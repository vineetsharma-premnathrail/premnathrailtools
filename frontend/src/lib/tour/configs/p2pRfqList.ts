import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-rfq-list',
  pageTitle: 'R.F.Q',
  steps: [
    {
      target: 'rfq-awaiting-table',
      title: 'Purchase Requests Awaiting RFQ',
      purpose: 'Every approved Purchase Requisition that doesn\'t have an RFQ raised against it yet.',
    },
    {
      target: 'rfq-start-btn',
      title: 'Start RFQ',
      purpose: 'Opens the Raise RFQ form with this Purchase Requisition already selected.',
      after: 'Takes you to a separate Raise RFQ page — its own guided tour covers every field there.',
    },
    {
      target: 'rfq-list-table',
      title: 'RFQ Number / Purchase Requisition Number / Status / Single Quotation / Created',
      purpose: 'Every RFQ raised so far, its linked requisition, whether it\'s still a Draft or Locked, and whether it was based on a single quotation.',
    },
    {
      target: 'rfq-list-view',
      title: 'View',
      purpose: 'Click View — or anywhere on the row — to open this RFQ\'s full detail: vendor quotations, commercial terms, and the PO drafting workflow.',
    },
  ],
}

export default config
