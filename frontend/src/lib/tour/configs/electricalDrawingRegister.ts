import { TourConfig } from '../types'
import { DRAWING_TYPE_OPTIONS, REVISION_STATUS_OPTIONS } from './electricalJobDrawingsTab'

const config: TourConfig = {
  id: 'electrical-drawing-register',
  pageTitle: 'Electrical Drawing Register',
  steps: [
    {
      target: 'electrical-nav-drawing',
      title: 'Drawings',
      purpose: 'Every electrical drawing across all RRV jobs in one register. Drawings are added and revised from each job\'s Drawings tab; this page is for finding them and seeing what needs approval.',
    },
    {
      target: 'elec-dreg-awaiting-btn',
      title: 'Awaiting approval only',
      purpose: 'One-click filter for drawings whose latest revision is waiting for approval. Click again to clear it.',
      why: 'Approvers use this as their to-do list — nothing should be built from an unapproved drawing.',
    },
    {
      target: 'elec-dreg-search',
      title: 'Search',
      purpose: 'Finds drawings by drawing number, title or job number.',
      validExample: 'PRT-EL-450',
    },
    {
      target: 'elec-dreg-type-filter',
      title: 'Drawing type filter',
      options: DRAWING_TYPE_OPTIONS,
    },
    {
      target: 'elec-dreg-status-filter',
      title: 'Revision status filter',
      purpose: 'Filters on the status of each drawing\'s latest revision.',
      options: REVISION_STATUS_OPTIONS,
    },
    {
      target: 'elec-dreg-as-built-filter',
      title: 'As-built filter',
      options: [
        { value: 'All', meaning: 'Every drawing.' },
        { value: 'Yes', meaning: 'Only drawings marked as-built (the final record of the vehicle as built).' },
        { value: 'No', meaning: 'Only design drawings not marked as-built.' },
      ],
    },
    {
      target: 'elec-dreg-table',
      title: 'Drawing list',
      purpose: 'Drawing no., title, job, type, latest revision with its status, the currently approved revision (green) and as-built flag.',
      after: 'Click any row to open that job on its Drawings tab, where the file, revision history and Approve / Reject buttons are.',
    },
  ],
}

export default config
