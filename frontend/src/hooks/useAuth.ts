'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'

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

/** Guards a page to admin/super_admin roles only. Redirects non-admins to /dashboard. */
export function useRequireAdmin() {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'

  useEffect(() => {
    if (!isLoading && user && !isAdmin) {
      router.push('/dashboard')
    }
  }, [isLoading, user, isAdmin, router])

  return { user, isLoading, isAuthorized: isAdmin }
}

/** Guards a page to users whose `apps` list includes `appName` (admins always pass,
 * since they implicitly get every module). Redirects everyone else to /dashboard. */
export function useRequireApp(appName: 'erp' | 'rnd' | 'crm') {
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
