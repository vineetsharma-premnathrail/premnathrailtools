import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-roles',
  pageTitle: 'Role & Permissions',
  steps: [
    {
      target: 'org-roles-stats',
      title: 'Summary cards',
      purpose: 'Quick counts — Total, Active, Inactive, and Admin users — for the currently filtered list below.',
    },
    {
      target: 'org-roles-status-tabs',
      title: 'All / Active / Inactive Users',
      purpose: 'Filters the table by whether the account is currently active.',
    },
    {
      target: 'org-roles-search',
      title: 'Search',
      purpose: 'Searches by user name or email across the currently selected status tab.',
    },
    {
      target: 'org-roles-sync-btn',
      title: 'Sync from Azure AD',
      purpose: 'Pulls the latest user list, names, and emails from Azure Active Directory so new hires and profile changes show up here without manual entry.',
      why: 'Requires the app to have directory-read permission in Azure AD — a sync failure usually means that permission is missing.',
    },
    {
      target: 'org-roles-table-rows',
      title: 'Users table',
      purpose: 'Every user, with role, module access (Apps), and approval-role badges (Dept Head, Project Head, Plant Head) shown inline.',
    },
    {
      target: 'org-roles-edit-btn',
      title: 'Edit',
      purpose: 'Opens the full editor for this one user — where their role, which modules (P2P, Store, CRM, etc.) they can access, and approval-role flags (Dept Head, Project Head, Plant Head, Purchase Head, Director, MD) are actually granted or changed.',
      after: 'This is the only place those permissions can be changed — the Organization > Users tab only displays them for reference.',
    },
  ],
}

export default config
