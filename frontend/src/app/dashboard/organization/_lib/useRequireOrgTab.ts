'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { can, PermissionAction } from '@/lib/permissions'
import { User } from '@/types'

/** Organization tabs in nav order — the registry keys (organization:<tab>:<action>). */
export const ORG_TABS = [
  { key: 'info', href: '/dashboard/organization/info' },
  { key: 'branches', href: '/dashboard/organization/plants' },
  { key: 'department', href: '/dashboard/organization/department' },
  { key: 'users', href: '/dashboard/organization/users' },
  { key: 'roles', href: '/dashboard/organization/roles' },
  { key: 'workflows', href: '/dashboard/organization/workflows' },
  { key: 'delegations', href: '/dashboard/organization/delegations' },
  { key: 'security', href: '/dashboard/organization/security' },
  { key: 'audit_logs', href: '/dashboard/organization/audit-logs' },
  { key: 'access_reviews', href: '/dashboard/organization/access-reviews' },
  { key: 'grc', href: '/dashboard/organization/access-risk' },
  { key: 'monitor', href: '/dashboard/organization/monitor' },
  { key: 'cockpit', href: '/dashboard/organization/cockpit' },
] as const

export type OrgTab = (typeof ORG_TABS)[number]['key']

/** First Organization tab `user` may view, or null when they have none. */
export function firstOrgTabHref(user: User | null | undefined): string | null {
  return ORG_TABS.find((t) => can(user, 'organization', t.key, 'view'))?.href ?? null
}

/**
 * Guards an Organization page by `can(user, 'organization', tab, 'view')`
 * (admins always pass) — replaces the old admin-only useRequireAdmin. A user
 * without the tab is sent to the first Organization tab they can see, or to
 * the dashboard when they have none. Pass `action` for create/edit-only pages
 * (e.g. the plant edit form needs 'edit'), so a viewer never lands on a form
 * the server would refuse to save.
 */
export function useRequireOrgTab(tab: OrgTab, action: PermissionAction = 'view') {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const allowed = can(user, 'organization', tab, action)

  useEffect(() => {
    if (!isLoading && user && !allowed) {
      router.push(firstOrgTabHref(user) ?? '/dashboard')
    }
  }, [isLoading, user, allowed, router])

  return { user, isLoading, isAuthorized: allowed }
}
