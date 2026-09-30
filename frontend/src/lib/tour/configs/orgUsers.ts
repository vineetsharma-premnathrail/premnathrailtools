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
      purpose: 'A read-only view of every portal user, showing their department, branch, role, which modules (P2P, Store, CRM, etc.) they can access, and any approval roles they hold (Design/R&D/Production/Project/Store/Purchase Manager, Director, Finance Manager) — the manager roles drive who a Purchase Order goes to for approval; Purchase Requisition approvers are picked per requisition.',
      why: 'This tab is for reference only. Module access and approval roles are actually granted or changed from Organization > Role & Permissions, not here.',
    },
  ],
}

export default config
