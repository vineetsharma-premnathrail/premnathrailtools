import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-rfq-list',
  pageTitle: 'Quotation requests (RFQ)',
  steps: [
    {
      target: 'rfq-stats',
      title: 'Counters',
      purpose: 'Small counters under the title: RFQs sent, how many went to one vendor only, and how many are still Draft or already Closed. They follow the search and filters.',
    },
    {
      target: 'rfq-new-btn',
      title: '+ New RFQ',
      purpose: 'Opens a popup listing the approved Purchase Requisitions that are waiting for quotations (search by PR number, category or project, or pick a Category). Pick one to open the Raise RFQ form with it already selected. Shown only to the purchase team.',
      after: 'Takes you to a separate Raise RFQ page — its own guided tour covers every field there.',
    },
    {
      target: 'rfq-search',
      title: 'Search',
      purpose: 'Type an RFQ number or PR number; the list narrows as you type.',
    },
    {
      target: 'rfq-filter-btn',
      title: 'Filters',
      purpose: 'Opens the Filters popup. Choose, then press Apply Filters; the button shows how many filters are on and a Clear button appears next to it.',
      options: [
        { value: 'RFQ status', meaning: 'Requests sent: Draft, or Closed - vendor chosen.' },
        { value: 'Vendors', meaning: 'Requests sent: one vendor only, or several vendors.' },
      ],
    },
    {
      target: 'rfq-list-table',
      title: 'RFQ Number / Purchase Requisition Number / Status / Vendors / Created',
      purpose: 'Every RFQ raised so far, its linked requisition, whether it is still a Draft or Closed (vendor chosen), and whether it went to several vendors or to one vendor only. Click a row to open this RFQ\'s full detail: vendor quotations, commercial terms, and the PO drafting workflow.',
    },
  ],
}

export default config
