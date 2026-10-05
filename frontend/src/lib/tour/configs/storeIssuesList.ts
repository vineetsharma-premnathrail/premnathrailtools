import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-issues-list',
  pageTitle: 'Material Issues',
  steps: [
    {
      target: 'issues-add-btn',
      title: '+ New Issue',
      purpose: 'Records material issued out of a store to a department or project — deducts stock immediately, no separate approval step.',
      after: 'Takes you to a separate Create Issue page — its own guided tour covers every field there.',
    },
    {
      target: 'issues-table',
      title: 'Issue rows',
      purpose: 'Every material issue with its Purchase Requisition (click the PR number to open it), store, department, project, who requested and who issued it. Click anywhere else on a row to open that issue\'s detail page. Shows "No material issues yet" until one is created.',
    },
  ],
}

export default config
