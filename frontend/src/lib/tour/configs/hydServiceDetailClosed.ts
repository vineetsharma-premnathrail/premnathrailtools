import { TourConfig } from '../types'
import { hydDocumentsSteps } from './hydraulicDocumentsSteps'

const config: TourConfig = {
  id: 'hyd-service-detail-closed',
  pageTitle: 'Service Job (closed)',
  steps: [
    {
      target: 'hyd-svcd-summary',
      title: 'Job summary',
      purpose: 'Status, the system and plan (click to open them), service and completion dates, cost split into spares, labour, other and total, and downtime.',
    },
    {
      target: 'hyd-svcd-status',
      title: 'Status',
      purpose: 'Completed = work done and locked as history. Cancelled = called off; the reason is shown under Job Details.',
    },
    {
      target: 'hyd-svcd-delete-btn',
      title: 'Delete',
      purpose: 'Shown only for cancelled jobs. Completed jobs cannot be deleted — they are part of the system\'s history.',
    },
    {
      target: 'hyd-svcd-back-btn',
      title: '← Back',
      purpose: 'Returns to the service list.',
    },
    {
      target: 'hyd-svcd-job-details',
      title: 'Job Details',
      purpose: 'Read-only record of the job — type, who did it, running hours, fluid added, oil condition, next service date, who completed it, the problem, root cause, work done, checklist and remarks.',
    },
    {
      target: 'hyd-svcd-parts',
      title: 'Spare Parts Used',
      purpose: 'Each spare with quantity, cost and the Store location it was issued from ("Not issued" / "Not in Store" when no stock was moved). Click a line to open the spare. Cost totals below.',
    },
    ...hydDocumentsSteps('photos and service reports'),
  ],
}

export default config
