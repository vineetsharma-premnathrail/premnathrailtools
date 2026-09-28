import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-users',
  pageTitle: 'Organization Users',
  steps: [
    {
      target: 'org-users-search',
      title: 'Search',
      purpose: 'Searches by user name or email.',
    },
    {
      target: 'org-users-table-rows',
      title: 'Users table',
      purpose: 'A read-only view of every portal user, showing their department, branch, role, which modules (P2P, Store, CRM, etc.) they can access, and any approval roles they hold (Dept Head, Project Head, Plant Head, Purchase Head, Director, MD) — these approval roles drive who is asked to sign off on requests as they move through workflows.',
      why: 'This tab is for reference only. Module access and approval roles are actually granted or changed from Organization > Role & Permissions, not here.',
    },
  ],
}

export default config
