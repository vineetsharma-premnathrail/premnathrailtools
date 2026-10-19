import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'erp-recycle-bin',
  pageTitle: 'Recycle Bin',
  steps: [
    {
      target: 'erp-nav-trash',
      title: 'Recycle Bin',
      purpose: 'Machines and service requests that were deleted in the Service & Commissioning module.',
    },
    {
      target: 'erp-bin-purge-note',
      title: '10-day rule',
      purpose: 'Anything here is permanently purged 10 days after it was deleted.',
      why: 'A safety net against accidental deletes, without keeping junk forever.',
    },
    {
      target: 'erp-bin-projects',
      title: 'Deleted Projects',
      purpose: 'Deleted machines with model, client and deletion date.',
    },
    {
      target: 'erp-bin-srs',
      title: 'Deleted Service Requests',
      purpose: 'Deleted SRs with how many days are left before purge.',
    },
    {
      target: 'erp-bin-restore-btn',
      title: 'Restore',
      purpose: 'Brings the item back exactly as it was. You need the matching delete permission (Delete Machine or Delete SR) to see this button.',
      after: 'The item disappears from here and reappears in its normal list.',
    },
  ],
}

export default config
