import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-issue-detail',
  pageTitle: 'Material Issue Detail',
  steps: [
    {
      target: 'issue-detail-print-slip-btn',
      title: 'Print Slip',
      purpose: 'Downloads this issue as the Store Requisition Slip (format F/STR/04) in Excel, in the same layout as the printed paper format: every item line with quantity required, quantity issued, unit and the store / bin it came from.',
      after: 'Print it and get it signed by the department head and the authorised signatory.',
    },
    {
      target: 'issue-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the Material Issues list.',
    },
    {
      target: 'issue-detail-summary',
      title: 'Issue Summary',
      purpose: 'Store, department, project/work order, dates, and who requested/issued it. A Material Issue is final once created — there\'s no edit here; use a Material Return to reverse part of it.',
    },
    {
      target: 'issue-detail-items',
      title: 'Items',
      purpose: 'Every item and quantity issued on this document. Each line already deducted stock at the time this issue was created.',
    },
  ],
}

export default config
