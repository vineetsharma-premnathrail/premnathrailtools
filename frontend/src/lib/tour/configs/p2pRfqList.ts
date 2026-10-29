import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-rfq-list',
  pageTitle: 'Quotation requests (RFQ)',
  steps: [
    {
      target: 'rfq-stats',
      title: 'Counters',
      purpose: 'Small counters under the title: requisitions with RFQ pending, RFQs sent, how many went to one vendor only, and how many are still Draft or already Closed. They follow the search and filters.',
    },
    {
      target: 'rfq-search',
      title: 'Search',
      purpose: 'Type an RFQ number, PR number or project; the list narrows as you type.',
    },
    {
      target: 'rfq-filter-btn',
      title: 'Filters',
      purpose: 'Opens the Filters popup. Choose, then press Apply Filters; the button shows how many filters are on and a Clear button appears next to it.',
      options: [
        { value: 'RFQ status', meaning: 'RFQ pending (requisition waiting for its RFQ), Draft, or Closed - vendor chosen.' },
        { value: 'Vendors', meaning: 'Requests sent: one vendor only, or several vendors.' },
      ],
    },
    {
      target: 'rfq-list-table',
      title: 'RFQ Number / Purchase Requisition Number / Status / Vendors / Created',
      purpose: 'On top, approved requisitions waiting for quotations show as "RFQ pending": click the row or Start RFQ (purchase team only) to open the Raise RFQ form with that requisition selected. Below, every RFQ raised so far, its linked requisition, whether it is still a Draft or Closed (vendor chosen), and whether it went to several vendors or to one vendor only. Click a row to open this RFQ\'s full detail: vendor quotations, commercial terms, and the PO drafting workflow.',
    },
  ],
}

export default config
