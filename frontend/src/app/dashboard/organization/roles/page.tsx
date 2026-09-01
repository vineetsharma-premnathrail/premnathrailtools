'use client'

import OrganizationNav from '@/components/organization/OrganizationNav'
import UsersRolesPage from '@/app/dashboard/users/page'

// Role & Permissions tab reuses the full editable Users & Roles screen —
// this is where module access, approval-role flags, and ERP/P2P permissions
// actually get granted/changed. The Users tab (organization/users/page.tsx)
// is a separate read-only view of the same data for reference only.
export default function OrganizationRolesPage() {
  return (
    <div>
      <OrganizationNav />
      <UsersRolesPage />
    </div>
  )
}
