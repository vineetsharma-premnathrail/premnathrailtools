'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { User } from '@/types'

/** Granular ERP sub-permission check (project_create, sr_edit, etc.) — admins
 * implicitly hold every permission. Mirrors the server's own
 * `role == admin or perm in erp_permissions` check. */
export function hasErpPermission(user: User | null | undefined, permission: string): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  return !!user.erp_permissions?.includes(permission)
}

export function useAuth() {
  const router = useRouter()
  const { user, token, isLoading, hasChecked, fetchUser, logout } = useAuthStore()

  // Browser sessions live in an httponly cookie (invisible to JS), so the only
  // way to know "am I logged in" is to ask the backend via /auth/me — once,
  // on mount, regardless of whether a Bearer `token` happens to be set.
  useEffect(() => {
    if (!hasChecked && !isLoading) {
      fetchUser()
    }
  }, [hasChecked, isLoading, fetchUser])

  useEffect(() => {
    if (hasChecked && !isLoading && !user) {
      router.push('/login')
    }
  }, [hasChecked, isLoading, user, router])

  return { user, token, isLoading: isLoading || !hasChecked, logout, fetchUser }
}

export function useProtectedPage() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return { isAuthorized: false, isLoading: true, user }
  }

  return { isAuthorized: !!user, isLoading: false, user }
}

/** Guards a page to admin roles only. Redirects non-admins to /dashboard. */
export function useRequireAdmin() {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (!isLoading && user && !isAdmin) {
      router.push('/dashboard')
    }
  }, [isLoading, user, isAdmin, router])

  return { user, isLoading, isAuthorized: isAdmin }
}

/** Guards a page to users whose `apps` list includes `appName` (admins always pass,
 * since they implicitly get every module). Redirects everyone else to /dashboard. */
export function useRequireApp(appName: 'erp' | 'rnd' | 'crm' | 'purchase' | 'p2p') {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const hasAccess = !!user?.apps?.includes(appName)

  useEffect(() => {
    if (!isLoading && user && !hasAccess) {
      router.push('/dashboard')
    }
  }, [isLoading, user, hasAccess, router])

  return { user, isLoading, isAuthorized: hasAccess }
}

/** Guards a page to users who both have `erp` access and hold the given
 * granular sub-permission (e.g. "project_create"). Redirects everyone else
 * back to `fallback`. Use on create/edit routes whose entry points (buttons)
 * are already hidden by the same permission — this is the direct-URL backstop. */
export function useRequireErpPermission(permission: string, fallback = '/dashboard/erp') {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const hasErpApp = !!user?.apps?.includes('erp')
  const isAuthorized = hasErpApp && hasErpPermission(user, permission)

  useEffect(() => {
    if (!isLoading && user && !isAuthorized) {
      router.push(fallback)
    }
  }, [isLoading, user, isAuthorized, router, fallback])

  return { user, isLoading, isAuthorized }
}
